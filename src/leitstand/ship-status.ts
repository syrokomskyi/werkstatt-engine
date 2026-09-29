/*
<MODULE_CONTRACT>
  <purpose>leitstand.ship.status — read-only renderer for ship operation journals (RFC-1168): parses ship-<mission>.jsonl into a step table, emits --json result or --follow tailing.</purpose>
  <non-goals>
    <item>Do not write to journals — this command is read-only.</item>
    <item>Do not change the journal schema — tolerate unknown record kinds.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1168: initial ship journal reader — tolerant line parser (corrupt/truncated lines skipped+counted), resolveShipJournal over systems-cache siblings, buildShipStatus step table with resume-reset semantics, leitstand.ship.status with --follow mtime polling.</item>
  <item>RFC-1168: ship stderr progress + leitstand.ship.status reader</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import type { JournalRecord } from "../journal/index.ts";
import { resolveCacheClonePath } from "../sternsystem/registry-io.ts";
import { flagSite } from "./deploy-helpers.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

const SHIP_JOURNAL_RE = /^ship-(.+)\.jsonl$/;
const FOLLOW_POLL_MS = 1000;

export interface ShipStepState {
  seq: number;
  name: string;
  state: "pending" | "running" | "done" | "failed" | "skipped";
  startedAt?: string;
  durationMs?: number;
}

export interface ShipStatusResult {
  command: "leitstand.ship.status";
  mission: string;
  release?: string;
  opId?: string;
  running: boolean;
  steps: ShipStepState[];
  skippedLines: number;
}

/** Tolerant parse — corrupt lines and a torn trailing line are skipped+counted. */
export function parseShipJournal(content: string): {
  records: JournalRecord[];
  skipped: number;
} {
  const records: JournalRecord[] = [];
  let skipped = 0;
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    try {
      records.push(JSON.parse(line) as JournalRecord);
    } catch {
      skipped++;
    }
  }
  return { records, skipped };
}

/**
 * Latest record per (opId, seq) wins; the table resets at each op-started so
 * a --resume run renders only the current attempt.
 */
export function buildShipStatus(
  records: JournalRecord[],
  fallbackMission: string,
): ShipStatusResult {
  let opId: string | undefined;
  let mission = fallbackMission;
  let release: string | undefined;
  let running = false;
  let stepSeqs: number[] = [];
  const stepState = new Map<number, ShipStepState>();
  const stepStartedAt = new Map<number, string>();

  for (const r of records) {
    if (r.kind === "op-started") {
      opId = r.opId;
      mission = r.missionId || mission;
      release = undefined;
      running = true;
      stepSeqs = [];
      stepState.clear();
      stepStartedAt.clear();
      continue;
    }
    if (r.opId !== opId) continue;
    // Resumed ops can emit done/failed/skipped without a fresh step-started
    // for the same seq — register the seq in every step-* branch.
    switch (r.kind) {
      case "step-started":
        stepStartedAt.set(r.seq, r.at);
        if (!stepSeqs.includes(r.seq)) stepSeqs.push(r.seq);
        stepState.set(r.seq, {
          seq: r.seq,
          name: r.step,
          state: "running",
          startedAt: r.at,
        });
        break;
      case "step-done": {
        if (!stepSeqs.includes(r.seq)) stepSeqs.push(r.seq);
        const started = stepStartedAt.get(r.seq);
        stepState.set(r.seq, {
          seq: r.seq,
          name: r.step,
          state: "done",
          startedAt: started,
          durationMs: started ? Date.parse(r.at) - Date.parse(started) : undefined,
        });
        if (r.step === "release-prepare" && r.meta?.releaseId) {
          release = r.meta.releaseId as string;
        }
        break;
      }
      case "step-failed": {
        if (!stepSeqs.includes(r.seq)) stepSeqs.push(r.seq);
        const started = stepStartedAt.get(r.seq);
        stepState.set(r.seq, {
          seq: r.seq,
          name: r.step,
          state: "failed",
          startedAt: started,
          durationMs: started ? Date.parse(r.at) - Date.parse(started) : undefined,
        });
        break;
      }
      case "step-skipped":
        if (!stepSeqs.includes(r.seq)) stepSeqs.push(r.seq);
        stepState.set(r.seq, { seq: r.seq, name: r.step, state: "skipped" });
        break;
      case "op-done":
      case "op-abandoned":
        running = false;
        break;
      default:
        break; // unknown kinds tolerated
    }
  }

  stepSeqs.sort((a, b) => a - b);
  return {
    command: "leitstand.ship.status",
    mission,
    release,
    opId,
    running,
    steps: stepSeqs.map((seq) => stepState.get(seq)!),
    skippedLines: 0,
  };
}

/**
 * Resolves `systems-cache/<site>/operations/ship-<mission>.jsonl`. Without
 * --mission, picks the newest ship-*.jsonl for the site; without --site,
 * scans every systems-cache dir for ship-<mission>.jsonl.
 */
export async function resolveShipJournal(
  workspaceRoot: string,
  io: KernelRuntimeContext["io"],
  site: string | undefined,
  mission: string | undefined,
): Promise<{ path: string; site: string; mission: string } | null> {
  // resolveCacheClonePath is the canonical resolver — derive the shared
  // systems-cache root from it so test mocks apply here too.
  const cacheRoot = path.dirname(resolveCacheClonePath(workspaceRoot, "__"));
  const candidateOpsDirs = async (): Promise<{ site: string; dir: string }[]> => {
    if (site)
      return [{ site, dir: path.join(resolveCacheClonePath(workspaceRoot, site), "operations") }];
    try {
      const entries = await io.readdir(cacheRoot);
      return entries
        .filter((e) => e.isDirectory)
        .map((e) => ({
          site: e.name,
          dir: path.join(resolveCacheClonePath(workspaceRoot, e.name), "operations"),
        }));
    } catch {
      return [];
    }
  };

  const candidates: { path: string; site: string; mission: string; mtimeMs: number }[] = [];
  for (const { site: siteId, dir } of await candidateOpsDirs()) {
    const wanted = mission !== undefined ? [`ship-${mission}.jsonl`] : [];
    let names: string[] = [];
    try {
      names = (await io.readdir(dir)).filter((e) => e.isFile).map((e) => e.name);
    } catch {
      continue; // operations dir may not exist yet
    }
    for (const name of wanted.length > 0 ? wanted : names) {
      const m = SHIP_JOURNAL_RE.exec(name);
      if (!m || !names.includes(name)) continue;
      const p = path.join(dir, name);
      let mtimeMs = 0;
      try {
        mtimeMs = (await io.stat(p)).mtimeMs;
      } catch {
        continue;
      }
      candidates.push({ path: p, site: siteId, mission: m[1], mtimeMs });
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const best = candidates[0];
  return best ? { path: best.path, site: best.site, mission: best.mission } : null;
}

function formatStepLine(s: ShipStepState, total: number): string {
  const dur = s.durationMs !== undefined ? ` (${Math.round(s.durationMs / 1000)}s)` : "";
  return `[ship] step ${s.seq + 1}/${total}: ${s.name} — ${s.state}${dur}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runLeitstandShipStatus(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ShipStatusResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagSite(input);
  const missionFlag = flagString(input, "mission");
  const follow = input.flags["follow"] === true;

  if (!systemId && !missionFlag) {
    throw new Error("[leitstand.ship.status] --site or --mission is required");
  }

  const resolved = await resolveShipJournal(workspaceRoot, context.io, systemId, missionFlag);

  if (!resolved) {
    // Absence is informational (RFC-1168 failure modes) — exit 0.
    return {
      data: {
        command: "leitstand.ship.status",
        mission: missionFlag ?? "",
        running: false,
        steps: [],
        skippedLines: 0,
      },
      summary: "[leitstand.ship.status] no ship journal found",
      exitCode: 0,
    };
  }

  const emit = (line: string): void => {
    try {
      process.stderr.write(`${line}\n`);
    } catch {
      // Closed stderr must not break the command.
    }
  };

  const readAndRender = async (): Promise<ShipStatusResult> => {
    const content = await context.io.readFile(resolved.path);
    const { records, skipped } = parseShipJournal(content);
    const status = buildShipStatus(records, resolved.mission);
    status.skippedLines = skipped;
    return status;
  };

  let status = await readAndRender();

  if (follow && status.running) {
    logger.info(`  [ship.status] following ${resolved.path} (Ctrl-C to stop)`);
    // Emit (seq,state) pairs not yet seen — idempotent across polls.
    const seen = new Set(status.steps.map((s) => `${s.seq}:${s.state}`));
    while (status.running) {
      await sleep(FOLLOW_POLL_MS);
      if (!(await context.io.exists(resolved.path))) {
        emit(`[ship.status] journal ${resolved.path} gone — stopping`);
        break;
      }
      status = await readAndRender();
      const total = status.steps.length;
      for (const s of status.steps) {
        const key = `${s.seq}:${s.state}`;
        if (seen.has(key)) continue;
        seen.add(key);
        emit(
          s.state === "running"
            ? `[ship] step ${s.seq + 1}/${total}: ${s.name} — running`
            : formatStepLine(s, total),
        );
      }
    }
    if (!status.running) emit(`[ship.status] finished — mission ${status.mission}`);
  }

  const total = status.steps.length;
  const rendered = status.steps.map((s) => formatStepLine(s, total));
  for (const line of rendered) logger.info(`  ${line}`);
  logger.info(
    `  [ship.status] mission=${status.mission} running=${status.running}` +
      (status.release ? ` release=${status.release}` : "") +
      (status.skippedLines > 0 ? ` skippedLines=${status.skippedLines}` : ""),
  );

  return {
    data: status,
    summary: `[leitstand.ship.status] ${status.mission}: ${total} step(s), running=${status.running}${status.release ? `, release=${status.release}` : ""}`,
    exitCode: 0,
  };
}
