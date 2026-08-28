/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0964: fleet.apply — cross-site wave orchestration command. Runs a kernel
    command or pipeline across fleet sites with canary-first waves, bounded
    concurrency, stop-threshold, and journal-backed crash-safe resume.
    Uses journal I/O primitives (appendRecord, readJournal, findIncompleteOperation)
    with a custom execution loop — runOperation is not used (it's linear/sequential,
    no concurrency support).
  </purpose>
  <non-goals>
    <item>Do not re-implement per-site pipeline logic — delegate via executeKernelCommand/executeKernelPipeline.</item>
    <item>Do not block concurrent fleet.apply runs — each has its own journal; operators avoid overlapping destructive ops.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0964: initial fleet.apply implementation — wave orchestration, concurrency, stop-threshold, journal, report.</item>
</CHANGE_SUMMARY>
*/

import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "../kernel/types.ts";
import { executeKernelCommand } from "../kernel/runtime/execute-command.ts";
import { executeKernelPipeline } from "../kernel/runtime/execute-pipeline.ts";
import { getOrBuildWorkspaceRegistry } from "../kernel/runtime/registry-cache.ts";
import {
  discoverSystems,
  resolveCacheClonePath,
  readSystemState,
} from "../sternsystem/registry-io.ts";
import { appendRecord, readJournal } from "../journal/jsonl.ts";
import type { FleetSiteRecord } from "./fleet-sites-generate.ts";

const FLEET_SITES_FILE = "fleet/fleet.sites.yaml";
const FLEET_OPERATIONS_DIR = "fleet/operations";
const FLEET_REPORTS_DIR = "fleet/reports";
const STALENESS_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

export type WaveName = "canary" | "rest";
export type SiteStatus = "ok" | "failed" | "skipped(precondition)" | "skipped(stop-threshold)";

export interface FleetApplyReportEntry {
  site: string;
  wave: WaveName;
  status: SiteStatus;
  exitCode: number | null;
  durationMs: number;
  error?: string;
}

export interface FleetApplyResult {
  opId: string;
  command: string;
  wave: string;
  totalSites: number;
  entries: FleetApplyReportEntry[];
  ok: number;
  failed: number;
  skipped: number;
  exitCode: number;
}

interface FleetSitesFile {
  sites: FleetSiteRecord[];
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

function flagInt(input: KernelCommandInput, key: string, def: number): number {
  const v = input.flags[key];
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return isNaN(n) ? def : n;
  }
  return def;
}

async function loadFleetSites(workspaceRoot: string): Promise<FleetSiteRecord[]> {
  const filePath = join(workspaceRoot, FLEET_SITES_FILE);
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf8");
  // Strip GENERATED header
  const markerIdx = raw.indexOf("\n---\n");
  const body = markerIdx >= 0 ? raw.slice(markerIdx + 5) : raw;
  const { parse: parseYaml } = await import("yaml");
  const yamlParsed = parseYaml(body) as FleetSitesFile;
  return yamlParsed.sites ?? [];
}

function isRegistryStale(workspaceRoot: string, systems: { id: string }[]): boolean {
  const fleetPath = join(workspaceRoot, FLEET_SITES_FILE);
  if (!existsSync(fleetPath)) return true;
  const fleetMtime = statSync(fleetPath).mtimeMs;
  const now = Date.now();
  if (now - fleetMtime > STALENESS_THRESHOLD_MS) return true;
  for (const sys of systems) {
    const configPath = join(resolveCacheClonePath(workspaceRoot, sys.id), "system-config.yaml");
    if (existsSync(configPath)) {
      const configMtime = statSync(configPath).mtimeMs;
      if (configMtime > fleetMtime) return true;
    }
  }
  return false;
}

async function regenerateRegistry(
  workspaceRoot: string,
  logger: KernelRuntimeContext["logger"],
): Promise<FleetSiteRecord[]> {
  logger.info("[fleet.apply] Registry stale or missing — regenerating via fleet.sites.generate");
  const { runFleetSitesGenerate } = await import("./fleet-sites-generate.ts");
  const result = await runFleetSitesGenerate({ flags: {}, argv: [] }, {
    workspaceRoot,
    logger,
  } as KernelRuntimeContext);
  const data = result.data as { sites: FleetSiteRecord[] };
  return data.sites;
}

async function resolveMissionForSite(
  workspaceRoot: string,
  siteId: string,
): Promise<string | null> {
  try {
    const state = await readSystemState(workspaceRoot, siteId);
    return state.currentMission;
  } catch {
    return null;
  }
}

async function commandRequiresMission(
  workspaceRoot: string,
  commandName: string,
): Promise<boolean> {
  const registry = await getOrBuildWorkspaceRegistry(workspaceRoot);
  if (!registry) return false;
  const def = registry.commands.get(commandName);
  if (!def) return false;
  return !!(def.flags && def.flags.mission);
}

async function runOneSite(
  workspaceRoot: string,
  logger: KernelRuntimeContext["logger"],
  runSpec: string,
  siteId: string,
): Promise<{ exitCode: number; error?: string }> {
  const isPipeline = runSpec.startsWith("pipeline ");
  const target = isPipeline ? runSpec.slice("pipeline ".length) : runSpec;

  const baseFlags: Record<string, unknown> = {};

  if (!isPipeline) {
    const requiresMission = await commandRequiresMission(workspaceRoot, target);
    if (requiresMission) {
      const missionId = await resolveMissionForSite(workspaceRoot, siteId);
      if (!missionId) {
        return { exitCode: -1, error: "skipped(precondition): no active mission" };
      }
      baseFlags.mission = missionId;
    }
  }

  try {
    if (isPipeline) {
      const result = await executeKernelPipeline({
        workspaceRoot,
        pipelineName: target,
        siteName: siteId,
        flags: baseFlags,
      });
      const exitCode = Array.isArray(result) ? (result[0]?.exitCode ?? 0) : result.exitCode;
      return { exitCode };
    } else {
      const result = await executeKernelCommand({
        workspaceRoot,
        commandName: target,
        siteName: siteId,
        argv: [],
      });
      const exitCode = Array.isArray(result) ? (result[0]?.exitCode ?? 0) : result.exitCode;
      return { exitCode };
    }
  } catch (err) {
    return { exitCode: 1, error: err instanceof Error ? err.message : String(err) };
  }
}

async function runWave(
  workspaceRoot: string,
  logger: KernelRuntimeContext["logger"],
  runSpec: string,
  waveName: WaveName,
  sites: FleetSiteRecord[],
  concurrency: number,
  stopAfterFailures: number,
  completedSites: Set<string>,
  journalPath: string,
  opId: string,
  failureCount: number,
): Promise<{ entries: FleetApplyReportEntry[]; failureCount: number; stop: boolean }> {
  const entries: FleetApplyReportEntry[] = [];
  let failures = failureCount;
  let stop = false;

  // Simple bounded concurrency using chunking
  const remaining = sites.filter((s) => !completedSites.has(s.id));

  for (let i = 0; i < remaining.length; i += concurrency) {
    if (stop) break;
    const chunk = remaining.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map(async (site) => {
        const start = Date.now();
        const stepName = `${waveName}:${site.id}`;

        // Journal: step-started
        await appendRecord(journalPath, {
          kind: "step-started",
          opId,
          step: stepName,
          seq: 0,
          at: new Date().toISOString(),
        });

        const result = await runOneSite(workspaceRoot, logger, runSpec, site.id);
        const durationMs = Date.now() - start;

        let status: SiteStatus;
        if (result.error?.startsWith("skipped(precondition)")) {
          status = "skipped(precondition)";
        } else if (result.exitCode !== 0) {
          status = "failed";
          failures++;
        } else {
          status = "ok";
        }

        // Journal: step-done (ok) or step-failed
        if (status === "ok") {
          await appendRecord(journalPath, {
            kind: "step-done",
            opId,
            step: stepName,
            seq: 0,
            at: new Date().toISOString(),
            meta: { durationMs },
          });
        } else if (status === "failed") {
          await appendRecord(journalPath, {
            kind: "step-failed",
            opId,
            step: stepName,
            seq: 0,
            at: new Date().toISOString(),
            error: result.error ?? "failed",
          });
        } else {
          // skipped(precondition)
          await appendRecord(journalPath, {
            kind: "step-skipped",
            opId,
            step: stepName,
            seq: 0,
            at: new Date().toISOString(),
            reason: "already-satisfied",
          });
        }

        return {
          site: site.id,
          wave: waveName,
          status,
          exitCode: result.exitCode,
          durationMs,
          error: result.error,
        } as FleetApplyReportEntry;
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        entries.push(r.value);
        if (r.value.status === "ok") {
          completedSites.add(r.value.site);
        }
        if (r.value.status === "skipped(precondition)") {
          completedSites.add(r.value.site);
        }
      } else {
        // Promise rejected — shouldn't happen but handle it
        entries.push({
          site: "unknown",
          wave: waveName,
          status: "failed",
          exitCode: 1,
          durationMs: 0,
          error: String(r.reason),
        });
        failures++;
      }
    }

    if (failures >= stopAfterFailures) {
      stop = true;
      // Mark remaining sites as skipped(stop-threshold)
      for (let j = i + concurrency; j < remaining.length; j++) {
        entries.push({
          site: remaining[j].id,
          wave: waveName,
          status: "skipped(stop-threshold)",
          exitCode: null,
          durationMs: 0,
        });
      }
    }
  }

  return { entries, failureCount: failures, stop };
}

export async function runFleetApply(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const { workspaceRoot, logger } = context;
  const runSpec = flagString(input, "run");
  if (!runSpec) {
    return {
      exitCode: 1,
      summary: "fleet.apply: --run flag is required",
      data: { error: "missing --run flag" },
    };
  }

  const allSites = flagBool(input, "all-sites");
  const sitesFlag = flagString(input, "sites");
  const waveFilter = flagString(input, "wave") ?? "all";
  const concurrency = flagInt(input, "concurrency", 1);
  const stopAfterFailures = flagInt(input, "stop-after-failures", 1);
  const resumeOpId = flagString(input, "resume");

  // Resolve site set
  let sites: FleetSiteRecord[];
  const { systems } = await discoverSystems(workspaceRoot);

  if (isRegistryStale(workspaceRoot, systems)) {
    sites = await regenerateRegistry(workspaceRoot, logger);
  } else {
    sites = await loadFleetSites(workspaceRoot);
    if (sites.length === 0 && systems.length > 0) {
      sites = await regenerateRegistry(workspaceRoot, logger);
    }
  }

  // Filter by --sites
  if (sitesFlag) {
    const requested = new Set(sitesFlag.split(",").map((s) => s.trim()));
    sites = sites.filter((s) => requested.has(s.id));
  } else if (!allSites) {
    return {
      exitCode: 1,
      summary: "fleet.apply: must specify --all-sites or --sites <list>",
      data: { error: "no site selection" },
    };
  }

  // Empty fleet
  if (sites.length === 0) {
    const opId = resumeOpId ?? randomUUID();
    const result: FleetApplyResult = {
      opId,
      command: runSpec,
      wave: waveFilter,
      totalSites: 0,
      entries: [],
      ok: 0,
      failed: 0,
      skipped: 0,
      exitCode: 0,
    };
    return {
      exitCode: 0,
      summary: "fleet.apply: 0 sites",
      data: result,
    };
  }

  // Partition into waves
  const canarySites = sites.filter((s) => s.canary);
  const restSites = sites.filter((s) => !s.canary);

  // Wave filter
  let canaryWave: FleetSiteRecord[] = [];
  let restWave: FleetSiteRecord[] = [];
  if (waveFilter === "canary") {
    canaryWave = canarySites;
  } else if (waveFilter === "rest") {
    restWave = restSites;
  } else {
    canaryWave = canarySites;
    restWave = restSites;
  }

  // Empty canary wave
  if (waveFilter === "canary" && canaryWave.length === 0) {
    const opId = resumeOpId ?? randomUUID();
    const result: FleetApplyResult = {
      opId,
      command: runSpec,
      wave: waveFilter,
      totalSites: 0,
      entries: [],
      ok: 0,
      failed: 0,
      skipped: 0,
      exitCode: 0,
    };
    return {
      exitCode: 0,
      summary: "fleet.apply: 0 canary sites",
      data: result,
    };
  }

  // Journal setup
  const opId = resumeOpId ?? randomUUID();
  const journalPath = join(workspaceRoot, FLEET_OPERATIONS_DIR, `${opId}.jsonl`);
  await mkdir(dirname(journalPath), { recursive: true });

  // Resume: load completed sites from journal
  const completedSites = new Set<string>();
  if (resumeOpId && existsSync(journalPath)) {
    const records = await readJournal(journalPath);
    for (const rec of records) {
      if (rec.kind === "step-done") {
        const siteId = rec.step.split(":")[1];
        if (siteId) completedSites.add(siteId);
      }
    }
    logger.info(
      `[fleet.apply] Resuming op ${opId}, ${completedSites.size} site(s) already completed`,
    );
  }

  // Journal: op-started
  await appendRecord(journalPath, {
    kind: "op-started",
    opId,
    op: "fleet.apply",
    missionId: "",
    at: new Date().toISOString(),
    platformVersion: "",
  });

  // Preflight: Cloudflare worker count
  try {
    const servicesPath = join(workspaceRoot, "services", "registry.yaml");
    if (existsSync(servicesPath)) {
      const { parse: parseYaml } = await import("yaml");
      const raw = await readFile(servicesPath, "utf8");
      const parsed = parseYaml(raw) as { services?: unknown[] };
      const workerCount = parsed.services?.length ?? 0;
      const totalWorkers = workerCount + sites.length;
      if (totalWorkers > 450) {
        logger.warn(
          `[fleet.apply] Preflight: ${totalWorkers} Cloudflare workers projected (services: ${workerCount} + sites: ${sites.length}). Account ceiling is 500.`,
        );
      }
    }
  } catch {
    // Non-fatal preflight
  }

  // Execute waves
  const allEntries: FleetApplyReportEntry[] = [];
  let failureCount = 0;
  let stop = false;

  // Canary wave
  if (canaryWave.length > 0) {
    logger.info(`[fleet.apply] Starting canary wave: ${canaryWave.length} site(s)`);
    const canaryResult = await runWave(
      workspaceRoot,
      logger,
      runSpec,
      "canary",
      canaryWave,
      concurrency,
      stopAfterFailures,
      completedSites,
      journalPath,
      opId,
      failureCount,
    );
    allEntries.push(...canaryResult.entries);
    failureCount = canaryResult.failureCount;
    stop = canaryResult.stop;

    // Canary wave failure → rest wave never starts (hard rule)
    if (canaryResult.failureCount > 0) {
      stop = true;
      logger.warn(
        `[fleet.apply] Canary wave had ${canaryResult.failureCount} failure(s) — rest wave skipped`,
      );
    }
  }

  // Rest wave
  if (restWave.length > 0 && !stop) {
    logger.info(`[fleet.apply] Starting rest wave: ${restWave.length} site(s)`);
    const restResult = await runWave(
      workspaceRoot,
      logger,
      runSpec,
      "rest",
      restWave,
      concurrency,
      stopAfterFailures,
      completedSites,
      journalPath,
      opId,
      failureCount,
    );
    allEntries.push(...restResult.entries);
    failureCount = restResult.failureCount;
  }

  // Journal: op-done
  await appendRecord(journalPath, {
    kind: "op-done",
    opId,
    at: new Date().toISOString(),
  });

  // Build result
  const ok = allEntries.filter((e) => e.status === "ok").length;
  const failed = allEntries.filter((e) => e.status === "failed").length;
  const skipped = allEntries.filter((e) => e.status.startsWith("skipped")).length;

  const result: FleetApplyResult = {
    opId,
    command: runSpec,
    wave: waveFilter,
    totalSites: sites.length,
    entries: allEntries,
    ok,
    failed,
    skipped,
    exitCode: failed > 0 ? 1 : 0,
  };

  // Persist report
  const reportPath = join(workspaceRoot, FLEET_REPORTS_DIR, `${opId}.json`);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(result, null, 2), "utf8");

  return {
    exitCode: result.exitCode,
    summary: `fleet.apply: ${ok} ok, ${failed} failed, ${skipped} skipped (opId: ${opId})`,
    data: result,
  };
}
