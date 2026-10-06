/*
<MODULE_CONTRACT>
<purpose>
RFC-1210: remediation.signal.ingest — the closed-loop remediation intake.
Normalizes an external signal (alert, probe result, validator finding,
operator submission) into a RemediationSignal, enforces the site's
remediation.signalSources trust boundary, applies per-(site,class) dedup and
per-day rate caps, then routes:

- autoFixable class + autonomy: bounded → internal openRemediationMission step
  (composes mission.open — NOT a registered command) + remediation-mission
  bordbuch bookkeeping entry + signal evidence file in the mission dir.
- everything else → action-pack route (existing RFC-0850/DNA-81 path).
- autonomy: off (default) → suppressed-autonomy-off.

The dedup ledger lives at systems-cache/<id>/operations/remediation-signals.jsonl
(swept to mirrors by commitCacheCloneIfDirty). The loop closes at mission OPEN —
reconcile/validate/close stay inside the normal mission lifecycle (DNA-46).
</purpose>
<non-goals>
  <item>Does not mutate deployed production or the cache clone content — only the operations ledger, bordbuch, and missions/ (all through the mission pipeline).</item>
  <item>Does not close or reconcile missions — v1 terminates at mission open.</item>
  <item>Does not accept ad-hoc classes or undeclared sources.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1210: initial ingest — trust boundary, dedup window, daily rate cap, route decision, bounded mission open via executeKernelCommand, remediation-mission bordbuch entry, JSONL signal ledger.</item>
  <item>RFC-1210: closed-loop signal ingest to bounded missions (RFC-1210)</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
  WorkspaceIO,
} from "@warpgogol/werkstatt-shared/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import {
  lookupRemediationClass,
  remediationSignalSchema,
  DEFAULT_REMEDIATION_SIGNAL_SOURCES,
  type RemediationSignal,
  type RemediationAutonomyConfig,
} from "@warpgogol/werkstatt-shared/remediation/classes";
import { resolveCacheClonePath, readSystemState } from "../sternsystem/registry-io.ts";
import { readMissionManifest } from "../mission/mission-io.ts";
import { appendBordbuchEntry } from "../bordbuch/bordbuch-io.ts";
import { diagnosticsResult } from "@warpgogol/werkstatt-shared/checks/result-helpers";

const COMMAND = "remediation.signal.ingest";
const LEDGER_REL = "operations/remediation-signals.jsonl";
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

type IngestRoute =
  "auto-mission" | "action-pack" | "suppressed-autonomy-off" | "deduped" | "rate-capped";

interface LedgerRecord {
  signal: RemediationSignal;
  route: IngestRoute;
  missionId?: string;
  ingestedAt: string;
}

export interface SignalIngestData {
  route: IngestRoute;
  class: string;
  missionId?: string;
  deduped: boolean;
  signal: RemediationSignal;
}

/** Injectable for tests — defaults to the real kernel mission.open call. */
export interface IngestDeps {
  openMission?: (
    workspaceRoot: string,
    systemId: string,
    brief: string,
    actor: string,
  ) => Promise<{ exitCode: number; missionId?: string; summary?: string }>;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function fail(
  ruleId: string,
  message: string,
  nextStep: string,
): KernelCommandResult<SignalIngestData> {
  return diagnosticsResult(
    COMMAND,
    [{ ruleId, severity: "error", message }],
    [{ action: nextStep, kind: "required" }],
  ) as unknown as KernelCommandResult<SignalIngestData>;
}

async function readLedger(
  workspaceRoot: string,
  systemId: string,
  io: WorkspaceIO,
): Promise<LedgerRecord[]> {
  const filePath = path.join(resolveCacheClonePath(workspaceRoot, systemId), LEDGER_REL);
  if (!(await io.exists(filePath))) return [];
  const raw = await io.readFile(filePath);
  const records: LedgerRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as LedgerRecord);
    } catch {
      // tolerate a torn tail line — ledger is append-only best-effort
    }
  }
  return records;
}

async function appendLedger(
  workspaceRoot: string,
  systemId: string,
  record: LedgerRecord,
  io: WorkspaceIO,
): Promise<void> {
  const filePath = path.join(resolveCacheClonePath(workspaceRoot, systemId), LEDGER_REL);
  await io.mkdir(path.dirname(filePath));
  const existing = (await io.exists(filePath)) ? await io.readFile(filePath) : "";
  const next = existing.endsWith("\n") || existing === "" ? existing : `${existing}\n`;
  await io.writeFile(filePath, `${next}${JSON.stringify(record)}\n`);
}

/** true when a prior auto-mission for (site,class) is still open. */
async function openAutoMissionExists(
  workspaceRoot: string,
  systemId: string,
  className: string,
  ledger: LedgerRecord[],
  io: WorkspaceIO,
): Promise<string | null> {
  const candidates = ledger.filter(
    (r) =>
      r.signal.siteId === systemId &&
      r.signal.class === className &&
      r.route === "auto-mission" &&
      r.missionId,
  );
  for (const rec of candidates.reverse()) {
    try {
      const manifest = await readMissionManifest(workspaceRoot, rec.missionId!, io);
      if (manifest.state === "open") return rec.missionId!;
    } catch {
      // mission dir gone or unreadable → treat as resolved, keep scanning
    }
  }
  return null;
}

async function defaultOpenMission(
  workspaceRoot: string,
  systemId: string,
  brief: string,
  actor: string,
): Promise<{ exitCode: number; missionId?: string; summary?: string }> {
  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
  const result = (await executeKernelCommand({
    workspaceRoot,
    commandName: "mission.open",
    argv: [`--system=${systemId}`, `--brief=${brief}`, `--actor=${actor}`],
  })) as {
    exitCode?: number;
    data?: { missionId?: string };
    summary?: string;
  };
  return {
    exitCode: result.exitCode ?? 1,
    missionId: result.data?.missionId,
    summary: result.summary,
  };
}

export async function runRemediationSignalIngest(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
  deps: IngestDeps = {},
): Promise<KernelCommandResult<SignalIngestData>> {
  const { workspaceRoot } = context;
  const io = context.io ?? createDefaultIO().io;
  const siteId = flagString(input, "site") ?? flagString(input, "system");
  const className = flagString(input, "class");
  const source = flagString(input, "source");
  const detectedBy = flagString(input, "detected-by") ?? "manual";
  const evidenceFlag = flagString(input, "evidence");

  if (!siteId) {
    return fail("SIG-00", "--site is required", "Pass --site <sternsystem-id>.");
  }
  if (!className) {
    return fail("SIG-00", "--class is required", "Pass --class <remediation-class>.");
  }
  if (!source) {
    return fail("SIG-00", "--source is required", "Pass --source <invoker-id>.");
  }

  // AUDIT-RFC-1210-01: trust boundary FIRST — the declared --source must be in
  // the site's remediation.signalSources allowlist before anything else runs.
  let autonomy: RemediationAutonomyConfig;
  try {
    const state = await readSystemState(workspaceRoot, siteId, io);
    autonomy = state.remediation ?? {
      autonomy: "off",
      signalSources: [...DEFAULT_REMEDIATION_SIGNAL_SOURCES],
    };
  } catch (err) {
    return fail(
      "SIG-04",
      `cannot read system-state.yaml for '${siteId}': ${err instanceof Error ? err.message : String(err)}`,
      `Verify the site id and that systems-cache/${siteId}/system-state.yaml parses.`,
    );
  }
  if (!autonomy.signalSources.includes(source)) {
    return fail(
      "SIG-02",
      `source '${source}' is not in ${siteId}'s remediation.signalSources allowlist — undeclared invokers cannot trigger any route`,
      `Add '${source}' to remediation.signalSources in system-state.yaml, or submit the signal through a declared source.`,
    );
  }

  const classEntry = lookupRemediationClass(className);
  if (!classEntry) {
    return fail(
      "SIG-01",
      `unknown remediation class '${className}' — the catalog is closed; new classes require a follow-up RFC`,
      "Choose a class from REMEDIATION_CLASSES in werkstatt-shared/remediation/classes, or route the finding manually.",
    );
  }

  // Normalize the signal (evidence flag may be a JSON array or a path/uri).
  let evidenceRefs: string[] = [];
  if (evidenceFlag) {
    const trimmed = evidenceFlag.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) evidenceRefs = parsed.map(String);
      } catch {
        return fail(
          "SIG-03",
          "--evidence is not valid JSON array or plain reference",
          "Pass --evidence '<path-or-uri>' or a JSON array string.",
        );
      }
    } else {
      evidenceRefs = [trimmed];
    }
  }
  const signalParse = remediationSignalSchema.safeParse({
    schema: "gogol.remediation-signal/1",
    siteId,
    class: className,
    source,
    detectedBy,
    evidenceRefs,
    detectedAt: new Date().toISOString(),
  });
  if (!signalParse.success) {
    return fail(
      "SIG-03",
      `signal failed schema: ${signalParse.error.issues.map((i) => i.message).join("; ")}`,
      "Fix the flag values to match the RemediationSignal contract.",
    );
  }
  const signal = signalParse.data;
  const ingestedAt = signal.detectedAt;
  const ledger = await readLedger(workspaceRoot, siteId, io);

  const record = async (route: IngestRoute, missionId?: string) => {
    const rec: LedgerRecord = { signal, route, ingestedAt };
    if (missionId) rec.missionId = missionId;
    await appendLedger(workspaceRoot, siteId, rec, io);
  };
  const ok = (
    data: Omit<SignalIngestData, "signal" | "class">,
  ): KernelCommandResult<SignalIngestData> => ({
    data: { ...data, class: className, signal },
    exitCode: 0,
    summary: `[${COMMAND}] route=${data.route} class=${className}${data.missionId ? ` mission=${data.missionId}` : ""}`,
  });

  // autonomy: off — ingest still records the signal, never opens missions.
  if (autonomy.autonomy !== "bounded") {
    await record("suppressed-autonomy-off");
    return ok({ route: "suppressed-autonomy-off", deduped: false });
  }

  if (!classEntry.autoFixable) {
    await record("action-pack");
    return ok({ route: "action-pack", deduped: false });
  }

  // Dedup: one open auto-mission per (siteId, class).
  const openMissionId = await openAutoMissionExists(workspaceRoot, siteId, className, ledger, io);
  if (openMissionId) {
    await record("deduped", openMissionId);
    return ok({ route: "deduped", missionId: openMissionId, deduped: true });
  }

  // Rate cap: maxAutoMissionsPerDay per rolling day — degrades to action-pack,
  // never silently drops (RFC-1210 failure modes).
  const windowStart = Date.now() - DEDUP_WINDOW_MS;
  const recentAuto = ledger.filter(
    (r) =>
      r.signal.siteId === siteId &&
      r.signal.class === className &&
      r.route === "auto-mission" &&
      Date.parse(r.ingestedAt) >= windowStart,
  ).length;
  if (recentAuto >= classEntry.maxAutoMissionsPerDay) {
    await record("rate-capped");
    const res = ok({ route: "rate-capped", deduped: false });
    res.nextSteps = [
      {
        action: `Rate cap reached for class '${className}' (${classEntry.maxAutoMissionsPerDay}/day) — signal degrades to action-pack; escalate to the operator alert path.`,
        kind: "optional",
      },
    ];
    return res;
  }

  // Route: auto-mission — internal openRemediationMission composition step.
  const fixCommand = classEntry.fixCommand!;
  const brief =
    `remediation(${className}): signal-triggered bounded mission (RFC-1210). ` +
    `Deterministic fix: run '${fixCommand}' in the mission workpiece, then mission.validate. ` +
    `Source: ${source}; detectedBy: ${signal.detectedBy}; ` +
    `evidence: ${evidenceRefs.join(", ") || "(none)"}.`;
  const openMission = deps.openMission ?? defaultOpenMission;
  const opened = await openMission(workspaceRoot, siteId, brief, `remediation:${source}`);
  if (opened.exitCode !== 0 || !opened.missionId) {
    return fail(
      "SIG-05",
      `mission.open failed for auto-mission (exit ${opened.exitCode}): ${opened.summary ?? "no summary"}`,
      "Open the remediation mission manually via mission.open, or resolve the reported blocker.",
    );
  }

  // Signal evidence lives inside the mission dir — bounded scope artifact.
  const missionId = opened.missionId;
  const evidencePath = path.join(workspaceRoot, "missions", missionId, "remediation-signal.json");
  try {
    await io.writeFile(evidencePath, `${JSON.stringify(signal, null, 2)}\n`);
  } catch {
    // evidence write is best-effort — the bordbuch entry below carries the refs
  }

  await appendBordbuchEntry(
    workspaceRoot,
    siteId,
    "remediation-mission",
    `remediation signal '${className}' opened bounded mission ${missionId} (source: ${source}, fix: ${fixCommand})`,
    `remediation:${source}`,
    {
      missionId,
      metadata: {
        signalClass: className,
        source,
        detectedBy: signal.detectedBy,
        evidenceRefs: signal.evidenceRefs,
        fixCommand,
      },
    },
    io,
  );

  await record("auto-mission", missionId);
  return ok({ route: "auto-mission", missionId, deduped: false });
}
