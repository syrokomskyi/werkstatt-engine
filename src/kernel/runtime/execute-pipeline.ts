/*
<MODULE_CONTRACT>
<purpose>
Pipeline execution: run an ordered list of pipeline steps (app-scoped or workspace-scoped)
through executeRegisteredCommand, recording per-step timing/telemetry (RFC-0270) and
producing a KernelPipelineReport with a timing summary (slowest steps, timeout count).
</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0303: split out of runtime.ts (Phase 3 file-size split, hot-path file 8/8).</item>
  <item>RFC-0326: pass fileIntents from createDefaultIO() to step contexts; aggregate filesModified across step reports into KernelPipelineReport.</item>
  <item>Add stderr progress lines for every pipeline step (start + finish + duration) so operators see live progress even in --json mode.</item>
  <item>RFC-0390: integrate command-result cache — skip re-execution on cache hit, store only ok:true results, respect --force and --dry-run.</item>
  <item>RFC-0637: moduleHashCache key includes modulePaths; computeModuleHash receives command.modulePaths for granular per-command hashing.</item>
  <item>RFC-0686: refactor executePipelineForSite and executePipelineForWorkspace to use pipeline-scheduler for dependency-aware parallel execution; add telemetry mutex; add summedDurationMs to timing summary; --concurrency 1 activates full sequential mode.</item>
  <item>RFC-0687: add transitive cache skip for validator chains — shouldTransitiveSkip checks validatesOutputs against cacheHitCommands; cross-pipeline persistence via .cache/pipeline-cache-hits.json with 30-minute TTL.</item>
  <item>ADR-0022: workspace registry now uses process-lifetime cache via getOrBuildWorkspaceRegistry.</item>
  <item>ADR-0023: reuse CacheLayer SQLite connection across pipeline steps; batch telemetry writes to a single append at pipeline completion; close cache after pipeline run.</item>
  <item>RFC-0809: add collect-errors mode — aggregate all independent step failures instead of stopping at first failure. Extract aggregateCollectErrors pure function for testability.</item>
  <item>RFC-1028: replace hardcoded moduleSrcDir with dynamic per-command resolution from command.modulePath via deriveModuleBasePath. Fixes stale cache keys caused by deleted packages/os/site-kernel-checks path.</item>
</CHANGE_SUMMARY>
*/

import { performance } from "node:perf_hooks";
import process from "node:process";
import os from "node:os";
import { join, relative, sep } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createKernelLogger } from "../logger.ts";
import { deriveModuleBasePath } from "./registry.ts";
import type { KernelRegistry } from "../registry.ts";
import {
  batchAppendStepTelemetry,
  loadPipelineBudgets,
  lookupExpectedDurationMs,
  type StepTelemetryRecord,
} from "../pipeline-budgets.ts";
import { createDefaultIO } from "../workspace-io.ts";
import { createCacheLayer } from "../cache/cache-layer.ts";
import {
  COMMAND_RESULT_CACHE_SCHEMA_VERSION,
  computeInputsHash,
  computeModuleHash,
  getCachedCommandResult,
  setCachedCommandResult,
  type CommandResultCacheKey,
  type InputsMetadataEntry,
} from "../cache/command-result-cache.ts";
import type { CacheLayer } from "../cache/cache-layer.ts";
import { buildWorkspaceTreeIndex, filterTreeIndex } from "../cache/workspace-tree-index.ts";
import type { WorkspaceTreeIndex } from "../cache/workspace-tree-index.ts";
import { stableJsonHash } from "@warpgogol/werkstatt-engine/fingerprint";
import type {
  DiscoveredSiteWorkspace,
  ExecuteKernelPipelineOptions,
  KernelExecutionReport,
  KernelPipelineReport,
  KernelPipelineStep,
  KernelPipelineTimingSummary,
  KernelCommandDefinition,
  KernelRuntimeContext,
  PipelineStepTiming,
} from "../types.ts";
import { executeRegisteredCommand, computeOwnershipMap } from "./execute-command.ts";
import { assertKnownOptionKeys, summarizeLogs } from "./shared.ts";
import { ensureTargetSites, loadAppRuntime } from "./registry.ts";
import { getOrBuildWorkspaceRegistry } from "./registry-cache.ts";
import {
  buildSchedule,
  executeScheduledSteps,
  type ScheduledStep,
  type StepExecutionResult,
} from "./pipeline-scheduler.ts";

const PIPELINE_TIMING_SUMMARY_THRESHOLD_MS = 30_000;

/**
 * RFC-0809: Pure function for collect-errors post-processing.
 *
 * When `collectErrors` is true and there are failed steps (excluding
 * dependency-skipped ones), returns an object with `failedSteps` (command
 * names), `exitCode` (from the first failure), and `ok: false`.
 *
 * When `collectErrors` is false, or when there are no failures, returns
 * `undefined` — the caller falls through to existing fail-fast or success
 * logic.
 */
export function aggregateCollectErrors(
  sortedResults: StepExecutionResult[],
  collectErrors: boolean,
): { failedSteps: string[]; exitCode: number; ok: false } | undefined {
  if (!collectErrors) return undefined;
  const failedResults = sortedResults.filter((r) => !r.report.ok && !r.dependencySkipped);
  if (failedResults.length === 0) return undefined;
  return {
    failedSteps: failedResults.map((r) => r.report.commandName),
    exitCode: failedResults[0]!.report.exitCode,
    ok: false,
  };
}

/**
 * RFC-0809: Build a KernelPipelineReport for collect-errors mode.
 * Shared between executePipelineForSite and executePipelineForWorkspace
 * to avoid duplicated post-processing logic.
 */
function buildCollectErrorsReport(
  collected: { failedSteps: string[]; exitCode: number; ok: false },
  reports: KernelExecutionReport[],
  pipelineName: string,
  timing: KernelPipelineTimingSummary,
  prefix: string,
  siteName?: string,
): KernelPipelineReport {
  for (const name of collected.failedSteps) {
    const failedReport = reports.find((r) => r.commandName === name);
    progressLine(`  [FAIL] ${name}: ${failedReport?.summary ?? "failed"}`);
  }
  progressLine(
    `${prefix} pipeline ${pipelineName} — FAILED (${collected.failedSteps.length} step(s) failed, ${formatDuration(timing.totalDurationMs)})`,
  );
  return {
    ...(siteName ? { siteName } : {}),
    pipelineName,
    exitCode: collected.exitCode,
    ok: false,
    steps: reports,
    timing,
    filesModified: aggregateFilesModified(reports),
    failedSteps: collected.failedSteps,
  };
}

// RFC-0732: convert pipeline-level flags record to CLI args for step execution.
function pipelineFlagsToArgs(flags: Record<string, unknown> | undefined): string[] {
  if (!flags) return [];
  const args: string[] = [];
  for (const [key, value] of Object.entries(flags)) {
    if (value === true) {
      args.push(`--${key}`);
    } else if (value === false || value === null || value === undefined) {
      // Skip false/null/undefined flags
    } else {
      args.push(`--${key}`, String(value));
    }
  }
  return args;
}

function progressLine(message: string): void {
  process.stderr.write(`${message}\n`);
}

function stepStatusLabel(report: KernelExecutionReport): string {
  if (report.cached) return "SKIP (cached)";
  if (report.exitCode === 0 && report.summary?.startsWith("Skipped:")) return "SKIP";
  if (report.timing.exceededTimeout) return "TIMEOUT";
  if (!report.ok) return "FAIL";
  if ((report.logSummary?.warning ?? 0) > 0) return "WARN";
  return "OK";
}

function stepStatus(report: KernelExecutionReport): PipelineStepTiming["status"] {
  if (report.cached) return "skipped";
  if (report.exitCode === 0 && report.summary?.startsWith("Skipped:")) return "skipped";
  if (report.timing.exceededTimeout) return "timeout";
  if (!report.ok) return "fail";
  if ((report.logSummary?.warning ?? 0) > 0) return "warn";
  return "pass";
}

/**
 * RFC-0687: Check whether a report was skipped by transitive cache skip.
 * Used to exclude transitive-cache-skip reports from telemetry.
 */
function isTransitiveSkip(report: KernelExecutionReport): boolean {
  return report.summary?.startsWith("Skipped: transitive-cache-skip") ?? false;
}

function skippedExecutionReport(
  command: KernelCommandDefinition,
  context: KernelRuntimeContext,
  reason?: string,
): KernelExecutionReport {
  return {
    siteName: context.site?.name,
    commandName: command.name,
    exitCode: 0,
    ok: true,
    summary: `Skipped: ${reason ?? "pipeline step marked skip"}`,
    metadata: command,
    logs: context.logger.getEvents(),
    logSummary: summarizeLogs(context.logger.getEvents()),
    timing: {
      durationMs: 0,
      exceededTimeout: false,
    },
    filesModified: [],
  };
}

function pipelineTimingSummary(
  pipelineName: string,
  reports: KernelExecutionReport[],
  stepTimings: PipelineStepTiming[],
  siteName?: string,
): KernelPipelineTimingSummary {
  const summedDurationMs = stepTimings.reduce((sum, step) => sum + step.durationMs, 0);
  // RFC-0686: wall-clock total = min(startedAt) to max(endedAt) across all steps.
  const minStart =
    stepTimings.length > 0 ? Math.min(...stepTimings.map((s) => s.startedAtMonotonicMs)) : 0;
  const maxEnd =
    stepTimings.length > 0 ? Math.max(...stepTimings.map((s) => s.endedAtMonotonicMs)) : 0;
  const totalDurationMs =
    stepTimings.length > 0 ? Math.max(0, maxEnd - minStart) : summedDurationMs;
  const failed = reports.find((report) => !report.ok);
  return {
    pipeline: pipelineName,
    ...(siteName ? { site: siteName } : {}),
    totalDurationMs,
    summedDurationMs,
    stepCount: stepTimings.length,
    slowestSteps: [...stepTimings].sort((a, b) => b.durationMs - a.durationMs).slice(0, 6),
    timeoutCount: stepTimings.filter((step) => step.exceededTimeout).length,
    warningCount: reports.reduce((sum, report) => sum + (report.logSummary?.warning ?? 0), 0),
    ...(failed ? { failedStep: failed.commandName } : {}),
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function printPipelineTimingSummary(
  logger: KernelRuntimeContext["logger"],
  summary: KernelPipelineTimingSummary,
): void {
  if (
    summary.totalDurationMs < PIPELINE_TIMING_SUMMARY_THRESHOLD_MS &&
    summary.timeoutCount === 0
  ) {
    return;
  }

  const target = summary.app
    ? `${summary.app}: ${summary.pipeline}`
    : `workspace: ${summary.pipeline}`;
  logger.section(`${target} timing`);
  logger.info(
    `[OK] wall-clock ${formatDuration(summary.totalDurationMs)}, summed ${formatDuration(summary.summedDurationMs ?? summary.totalDurationMs)}, ${summary.stepCount} step(s), ${summary.timeoutCount} timeout(s)`,
  );
  if (summary.slowestSteps.length > 0) {
    logger.info("slowest:");
    summary.slowestSteps.forEach((step, index) => {
      logger.info(`  ${index + 1}. ${step.command} ${formatDuration(step.durationMs)}`);
    });
  }
}

/**
 * RFC-0326: deduplicate and aggregate filesModified across all step reports.
 */
function aggregateFilesModified(reports: KernelExecutionReport[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const report of reports) {
    for (const path of report.filesModified ?? []) {
      if (!seen.has(path)) {
        seen.add(path);
        result.push(path);
      }
    }
  }
  return result;
}

/**
 * RFC-0686: Resolve concurrency from options or default to min(availableParallelism, 8).
 */
function resolveConcurrency(options: ExecuteKernelPipelineOptions): number {
  if (options.concurrency !== undefined) return options.concurrency;
  const available = os.availableParallelism?.() ?? 4;
  return Math.min(available, 8);
}

/**
 * RFC-0390: Determine whether a command is eligible for caching.
 * A command is cacheable when `cacheable !== false` AND it has non-empty `reads`.
 * Commands with `cacheable: false` or without `reads` are always executed.
 */
function isCommandCacheable(command: KernelCommandDefinition): boolean {
  if (command.cacheable === false) return false;
  const reads = command.reads ?? [];
  return reads.length > 0;
}

// ---------------------------------------------------------------------------
// RFC-0687: Transitive cache skip for validator chains
// ---------------------------------------------------------------------------

/**
 * RFC-0687: Tracks which commands were cache hits during a pipeline run, plus the
 * pipeline name for cross-pipeline persistence.
 */
export interface PipelineRunState {
  cacheHitCommands: Set<string>;
  pipelineName: string;
}

/**
 * RFC-0687: Determine whether a command should be transitively skipped.
 *
 * The algorithm has 3 steps:
 * 1. If the command is `cacheable: false`, never skip — it must always run.
 * 2. If the command has no `validatesOutputs`, never skip — it is not a
 *    validator that checks another command's output.
 * 3. If all entries in `validatesOutputs` are in `cacheHitCommands`, skip —
 *    the validator's upstream generators were all cache hits, so their
 *    outputs are unchanged.
 *
 * No `reads[]` hash computation is performed — the skip is based solely on
 * the upstream cache-hit status. The safety net is `cacheable: false`
 * validators (e.g. `generated.drift.validate`) which always run and catch
 * manual edits to generated files.
 */
export function shouldTransitiveSkip(
  command: KernelCommandDefinition,
  runState: PipelineRunState,
): boolean {
  if (command.cacheable === false) return false;
  const validatesOutputs = command.validatesOutputs;
  if (!validatesOutputs || validatesOutputs.length === 0) return false;
  return validatesOutputs.every((cmd) => runState.cacheHitCommands.has(cmd));
}

const PIPELINE_CACHE_HITS_DIR = ".cache";
const PIPELINE_CACHE_HITS_FILENAME = "pipeline-cache-hits.json";
const PIPELINE_CACHE_HITS_STALENESS_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Shape of the persisted cache-hit file. Each pipeline name maps to an
 * array of command names that were cache hits, plus a timestamp.
 */
interface PipelineCacheHitsFile {
  pipelines: Record<string, { commands: string[]; writtenAt: number }>;
}

/**
 * RFC-0687: Load cache-hit commands from other pipeline runs.
 *
 * Reads `.cache/pipeline-cache-hits.json` and merges entries from pipelines
 * other than `currentPipelineName` that are within the 30-minute TTL.
 *
 * Handles missing, corrupt, or stale files gracefully — returns an empty
 * set on any error.
 */
export async function loadImportedCacheHits(
  workspaceRoot: string,
  currentPipelineName: string,
): Promise<Set<string>> {
  const filePath = join(workspaceRoot, PIPELINE_CACHE_HITS_DIR, PIPELINE_CACHE_HITS_FILENAME);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return new Set();
  }
  let data: PipelineCacheHitsFile;
  try {
    data = JSON.parse(raw) as PipelineCacheHitsFile;
  } catch {
    return new Set();
  }
  if (!data.pipelines || typeof data.pipelines !== "object") return new Set();

  const now = Date.now();
  const merged = new Set<string>();
  for (const [pipelineName, entry] of Object.entries(data.pipelines)) {
    if (pipelineName === currentPipelineName) continue;
    if (!entry || !Array.isArray(entry.commands)) continue;
    if (now - (entry.writtenAt ?? 0) > PIPELINE_CACHE_HITS_STALENESS_MS) continue;
    for (const cmd of entry.commands) {
      merged.add(cmd);
    }
  }
  return merged;
}

/**
 * RFC-0687: Persist cache-hit commands for the current pipeline run.
 *
 * Writes `cacheHitCommands` under `pipelineName` in
 * `.cache/pipeline-cache-hits.json`, replacing any previous entry for that
 * pipeline. Preserves entries for other pipelines.
 */
export async function persistCacheHits(
  workspaceRoot: string,
  pipelineName: string,
  cacheHitCommands: Set<string>,
): Promise<void> {
  const dir = join(workspaceRoot, PIPELINE_CACHE_HITS_DIR);
  const filePath = join(dir, PIPELINE_CACHE_HITS_FILENAME);

  let existing: PipelineCacheHitsFile = { pipelines: {} };
  try {
    const raw = await readFile(filePath, "utf8");
    existing = JSON.parse(raw) as PipelineCacheHitsFile;
    if (!existing.pipelines || typeof existing.pipelines !== "object") {
      existing = { pipelines: {} };
    }
  } catch {
    // File missing or corrupt — start fresh.
  }

  existing.pipelines[pipelineName] = {
    commands: [...cacheHitCommands].sort(),
    writtenAt: Date.now(),
  };

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, JSON.stringify(existing, null, 2) + "\n", "utf8");
  } catch {
    // Non-fatal — persistence is best-effort.
  }
}

/**
 * RFC-0687: Clear the pipeline cache-hits file. Called when `--force` is set.
 */
export async function clearPipelineCacheHits(workspaceRoot: string): Promise<void> {
  const dir = join(workspaceRoot, PIPELINE_CACHE_HITS_DIR);
  const filePath = join(dir, PIPELINE_CACHE_HITS_FILENAME);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, JSON.stringify({ pipelines: {} }, null, 2) + "\n", "utf8");
  } catch {
    // Non-fatal — clear is best-effort.
  }
}

/**
 * RFC-0637: Resolve the module hash from the per-pipeline-run cache, computing
 * it on miss. The cache key includes `command.modulePaths` so commands with
 * different `modulePaths` get independent cache entries.
 */
async function getOrComputeModuleHash(
  moduleSrcDir: string,
  command: KernelCommandDefinition,
  moduleHashCache: Map<string, string>,
): Promise<string> {
  const moduleHashCacheKey = `${moduleSrcDir}:${command.modulePaths?.join(",") ?? ""}`;
  let moduleHash = moduleHashCache.get(moduleHashCacheKey);
  if (!moduleHash) {
    moduleHash = await computeModuleHash(moduleSrcDir, command.modulePaths);
    moduleHashCache.set(moduleHashCacheKey, moduleHash);
  }
  return moduleHash;
}

/**
 * RFC-0390 + RFC-0685: Attempt to read a cached result for the given command.
 * Returns the cached report (with `cached: true`) or null on miss.
 * Skips cache when `dryRun` or `force` is set, or when cache is unavailable.
 *
 * RFC-0685: when the cached entry has `inputsMetadata` and `inputsHash`, and
 * the tree index is available, compares current file metadata against stored
 * metadata. If identical, reuses the stored `inputsHash` without fingerprinting.
 */
async function tryCacheRead(
  cache: CacheLayer,
  command: KernelCommandDefinition,
  baseDir: string,
  workspaceRoot: string,
  siteName: string | null,
  moduleSrcDir: string,
  moduleHashCache: Map<string, string>,
  force: boolean,
  dryRun: boolean,
  treeIndex?: WorkspaceTreeIndex,
): Promise<KernelExecutionReport | null> {
  if (dryRun || force) return null;
  if (!isCommandCacheable(command)) return null;
  if (!cache.available) return null;

  const reads = command.reads ?? [];

  // RFC-0685: mtime fast path — first try to read cache entry with a preliminary
  // key using a placeholder hash, then check if metadata matches.
  // The fast path requires a tree index to get current metadata without fingerprinting.
  if (treeIndex) {
    const fastPathResult = await tryMtimeFastPath(
      cache,
      command,
      reads,
      baseDir,
      workspaceRoot,
      siteName,
      moduleSrcDir,
      moduleHashCache,
      treeIndex,
    );
    if (fastPathResult) return fastPathResult;
  }

  // Full path: compute inputs hash (with tree index for glob expansion).
  const { hash: inputsHash } = await computeInputsHash(reads, baseDir, workspaceRoot, treeIndex);

  const moduleHash = await getOrComputeModuleHash(moduleSrcDir, command, moduleHashCache);

  const key: CommandResultCacheKey = {
    schemaVersion: COMMAND_RESULT_CACHE_SCHEMA_VERSION,
    commandName: command.name,
    siteName,
    inputsHash,
    moduleHash,
  };

  const entry = await getCachedCommandResult(cache, key);
  return entry?.report ?? null;
}

/**
 * RFC-0685: mtime fast path. Reads the cache entry using the stored inputsHash
 * from a previous run. If the entry has inputsMetadata, compares current file
 * metadata (from tree index) against stored metadata. If identical, returns
 * the cached report without fingerprinting.
 *
 * This function scans the cache namespace for entries matching the command name
 * and site name, then checks metadata. Since the CacheLayer interface doesn't
 * support prefix scans, we use a two-step approach: compute current metadata
 * from the tree index, then try to find a matching cached entry by iterating
 * known inputsHash values. In practice, the fast path works by first computing
 * current metadata, then looking up the cache entry that was stored with that
 * metadata's hash.
 *
 * Simplified approach: compute metadata from tree index, compute hash from
 * metadata, look up cache entry. If found and metadata matches, return it.
 */
async function tryMtimeFastPath(
  cache: CacheLayer,
  command: KernelCommandDefinition,
  reads: string[],
  baseDir: string,
  workspaceRoot: string,
  siteName: string | null,
  moduleSrcDir: string,
  moduleHashCache: Map<string, string>,
  treeIndex: WorkspaceTreeIndex,
): Promise<KernelExecutionReport | null> {
  // Expand globs using tree index to get current file list with metadata.
  const files = filterTreeIndex(treeIndex, reads, baseDir, workspaceRoot);
  if (files.length === 0) return null;

  // Build current metadata from tree index.
  const currentMetadata: InputsMetadataEntry[] = [];
  for (const abs of files) {
    const rel = relative(workspaceRoot, abs).split(sep).join("/");
    const entry = treeIndex.get(rel);
    if (!entry) return null; // file not in index — can't use fast path
    currentMetadata.push({ path: rel, mtimeMs: entry.mtimeMs, size: entry.size });
  }
  currentMetadata.sort((a, b) => a.path.localeCompare(b.path));

  // Compute a hash from the metadata to use as a lookup key.
  const metadataHash = stableJsonHash({ metadata: currentMetadata });

  // Look up the metadata-to-inputsHash mapping.
  const metaKey = `meta:${command.name}:${siteName ?? ""}:${metadataHash}`;
  const metaEntry = await cache.get("command_results_meta", metaKey);
  if (!metaEntry) return null;

  const storedInputsHash = metaEntry.data as string;
  if (typeof storedInputsHash !== "string") return null;

  const moduleHash = await getOrComputeModuleHash(moduleSrcDir, command, moduleHashCache);

  const key: CommandResultCacheKey = {
    schemaVersion: COMMAND_RESULT_CACHE_SCHEMA_VERSION,
    commandName: command.name,
    siteName,
    inputsHash: storedInputsHash,
    moduleHash,
  };

  const entry = await getCachedCommandResult(cache, key);
  return entry?.report ?? null;
}

/**
 * RFC-0390 + RFC-0685: Store a successful command result in the cache.
 * Only stores when `ok: true`, not `dryRun`, and the command is cacheable.
 * On `--force`, still stores (refreshing entries).
 *
 * RFC-0685: also stores inputsMetadata sidecar and a metadata-to-inputsHash
 * mapping for the mtime fast path.
 */
async function tryCacheWrite(
  cache: CacheLayer,
  command: KernelCommandDefinition,
  report: KernelExecutionReport,
  baseDir: string,
  workspaceRoot: string,
  siteName: string | null,
  moduleSrcDir: string,
  moduleHashCache: Map<string, string>,
  dryRun: boolean,
  treeIndex?: WorkspaceTreeIndex,
): Promise<void> {
  if (dryRun) return;
  if (!report.ok) return;
  if (!isCommandCacheable(command)) return;
  if (!cache.available) return;

  const reads = command.reads ?? [];
  const { hash: inputsHash, metadata } = await computeInputsHash(
    reads,
    baseDir,
    workspaceRoot,
    treeIndex,
  );

  const moduleHash = await getOrComputeModuleHash(moduleSrcDir, command, moduleHashCache);

  const key: CommandResultCacheKey = {
    schemaVersion: COMMAND_RESULT_CACHE_SCHEMA_VERSION,
    commandName: command.name,
    siteName,
    inputsHash,
    moduleHash,
  };

  await setCachedCommandResult(cache, key, report, metadata);

  // RFC-0685: store metadata-to-inputsHash mapping for mtime fast path.
  if (metadata.length > 0) {
    const metadataHash = stableJsonHash({ metadata });
    const metaKey = `meta:${command.name}:${siteName ?? ""}:${metadataHash}`;
    await cache.set("command_results_meta", metaKey, inputsHash, Date.now(), inputsHash);
  }
}

async function executePipelineForSite(
  site: DiscoveredSiteWorkspace,
  registry: KernelRegistry,
  options: ExecuteKernelPipelineOptions,
  steps: KernelPipelineStep[],
): Promise<KernelPipelineReport> {
  // RFC-0270: a generated budget entry, when present, wins over the inline
  // expectedDurationMs — the inline value stays as the cold-start fallback.
  const budgets = await loadPipelineBudgets(options.workspaceRoot);
  const totalSteps = steps.length;
  // RFC-0390: create cache layer and module hash cache for this pipeline run.
  const cache = await createCacheLayer(options.workspaceRoot);
  const moduleHashCache = new Map<string, string>();
  // RFC-0685: build workspace tree index once per pipeline run.
  let treeIndex: WorkspaceTreeIndex | undefined;
  try {
    treeIndex = await buildWorkspaceTreeIndex(options.workspaceRoot);
  } catch {
    treeIndex = undefined;
  }
  const concurrency = resolveConcurrency(options);
  // ADR-0023: batch telemetry records in-memory; write once at pipeline completion.
  const telemetryBatch: StepTelemetryRecord[] = [];
  progressLine(
    `[${site.name}] pipeline ${options.pipelineName} — ${totalSteps} step(s), concurrency ${concurrency}`,
  );

  // RFC-0687: load cross-pipeline cache hits and set up run state.
  if (options.force ?? false) {
    await clearPipelineCacheHits(options.workspaceRoot);
  }
  const importedHits = await loadImportedCacheHits(options.workspaceRoot, options.pipelineName);
  const runState: PipelineRunState = {
    cacheHitCommands: importedHits,
    pipelineName: options.pipelineName,
  };

  const scheduled = buildSchedule(steps);

  const stepTimings: Map<number, PipelineStepTiming> = new Map();

  try {
    const results = await executeScheduledSteps(
      scheduled,
      concurrency,
      async (sStep: ScheduledStep) => {
        const { step, stepIndex } = sStep;
        const command = registry.getCommand(step.command);
        if (!command) {
          throw new Error(
            `Kernel pipeline step \`${step.command}\` is not registered for site \`${site.name}\`.`,
          );
        }

        // RFC-1028: resolve moduleSrcDir dynamically from command.modulePath.
        // Falls back to a constant hash when modulePath is absent (legacy modules).
        const moduleSrcDir = command.modulePath
          ? join(options.workspaceRoot, deriveModuleBasePath(command.modulePath) ?? "")
          : join(options.workspaceRoot, "packages", "werkstatt-site", "src");

        const logger = createKernelLogger(options.outputFormat ?? "pretty");
        const { io, intents } = createDefaultIO();
        const ownershipMap = await computeOwnershipMap(registry);
        const context: KernelRuntimeContext = {
          workspaceRoot: options.workspaceRoot,
          site,
          siteExplicit: false,
          logger,
          dryRun: options.dryRun ?? false,
          outputFormat: options.outputFormat ?? "pretty",
          io,
          fileIntents: intents,
          registry,
          ownershipMap,
        };

        const stepLabel = `[${stepIndex + 1}/${totalSteps}]`;
        if (options.outputFormat !== "json") {
          logger.section(`${site.name}: ${options.pipelineName} -> ${step.command}`);
        }
        progressLine(`${stepLabel} ${step.command} …`);

        const budgetedExpectedDurationMs = lookupExpectedDurationMs(
          budgets,
          options.pipelineName,
          step.command,
          site.name,
        );
        const startedAtMonotonicMs = Math.round(performance.now());
        let report: KernelExecutionReport;
        if (step.skip) {
          report = skippedExecutionReport(command, context, step.skipReason);
        } else if (shouldTransitiveSkip(command, runState)) {
          // RFC-0687: transitive cache skip — all upstream commands were cache hits.
          report = skippedExecutionReport(command, context, "transitive-cache-skip");
        } else {
          // RFC-0390: try cache read before executing.
          const cached = await tryCacheRead(
            cache,
            command,
            site.directory,
            options.workspaceRoot,
            site.name,
            moduleSrcDir,
            moduleHashCache,
            options.force ?? false,
            options.dryRun ?? false,
            treeIndex,
          );
          if (cached) {
            report = cached;
          } else {
            // Inject --site for workspace-scoped commands so they receive the site
            // name from the pipeline context (mirrors executeKernelCommand logic).
            const stepArgs = [...(step.args ?? []), ...pipelineFlagsToArgs(options.flags)];
            if (
              command.scope === "workspace" &&
              !stepArgs.some((a) => a === "--site" || a.startsWith("--site=")) &&
              site.name
            ) {
              stepArgs.push("--site", site.name);
            }
            // RFC-0814: Auto-inject --system for workspace-scoped commands that accept it.
            // The system ID is the same as the site name (RFC-0790 1:1 convention).
            // RFC-0817: Use pattern matching to detect both --system and --system=value formats.
            if (
              command.scope === "workspace" &&
              !stepArgs.some((a) => a === "--system" || a.startsWith("--system=")) &&
              site.name
            ) {
              const acceptsSystem =
                !command.flags ||
                ("system" in command.flags && command.flags.system.kind === "string");
              if (acceptsSystem) {
                stepArgs.push("--system", site.name);
              }
            }
            report = await executeRegisteredCommand(command, context, stepArgs, {
              timeoutMs: step.timeoutMs,
              expectedDurationMs: budgetedExpectedDurationMs ?? step.expectedDurationMs,
            });
            // RFC-0390: store successful results in cache.
            await tryCacheWrite(
              cache,
              command,
              report,
              site.directory,
              options.workspaceRoot,
              site.name,
              moduleSrcDir,
              moduleHashCache,
              options.dryRun ?? false,
              treeIndex,
            );
          }
        }
        const endedAtMonotonicMs = Math.round(performance.now());
        progressLine(
          `${stepLabel} ${step.command} — ${stepStatusLabel(report)} ${formatDuration(report.timing.durationMs)}`,
        );
        // ADR-0023: collect telemetry in-memory; batch write at pipeline completion.
        if (!step.skip && !report.cached && !isTransitiveSkip(report)) {
          telemetryBatch.push({
            pipeline: options.pipelineName,
            command: step.command,
            app: site.name,
            durationMs: report.timing.durationMs,
            timedOut: report.timing.exceededTimeout,
            recordedAt: new Date().toISOString(),
          });
        }
        stepTimings.set(stepIndex, {
          pipeline: options.pipelineName,
          command: step.command,
          app: site.name,
          packageName: site.packageName,
          status: stepStatus(report),
          startedAtMonotonicMs,
          endedAtMonotonicMs,
          durationMs: report.timing.durationMs,
          ...(report.timing.timeoutMs !== undefined ? { timeoutMs: report.timing.timeoutMs } : {}),
          ...(report.timing.expectedDurationMs !== undefined
            ? { expectedDurationMs: report.timing.expectedDurationMs }
            : {}),
          exceededTimeout: report.timing.exceededTimeout,
        });

        return report;
      },
    );

    // Sort results by stepIndex (declaration order).
    const sortedResults = [...results].sort((a, b) => a.stepIndex - b.stepIndex);
    const reports = sortedResults.map((r) => r.report);
    const orderedStepTimings = scheduled.map((s) => stepTimings.get(s.stepIndex)!).filter(Boolean);

    const failed = reports.find((report) => !report.ok);
    const timing = pipelineTimingSummary(
      options.pipelineName,
      reports,
      orderedStepTimings,
      site.name,
    );

    // ADR-0023: batch write all telemetry records in a single I/O operation.
    await batchAppendStepTelemetry(options.workspaceRoot, telemetryBatch);

    // RFC-0687: persist cache hits for cross-pipeline transitive skip.
    await persistCacheHits(options.workspaceRoot, options.pipelineName, runState.cacheHitCommands);

    if (options.outputFormat !== "json") {
      const logger = createKernelLogger(options.outputFormat ?? "pretty");
      printPipelineTimingSummary(logger, timing);
    }

    // RFC-0809: collect-errors mode — aggregate all independent failures.
    const collected = aggregateCollectErrors(sortedResults, options.collectErrors ?? false);
    if (collected) {
      return buildCollectErrorsReport(
        collected,
        reports,
        options.pipelineName,
        timing,
        `[${site.name}]`,
        site.name,
      );
    }

    if (failed) {
      progressLine(
        `[${site.name}] pipeline ${options.pipelineName} — FAILED at step ${failed.commandName} (${formatDuration(timing.totalDurationMs)})`,
      );
      return {
        siteName: site.name,
        pipelineName: options.pipelineName,
        exitCode: failed.exitCode,
        ok: false,
        steps: reports,
        timing,
        filesModified: aggregateFilesModified(reports),
      };
    }

    progressLine(
      `[${site.name}] pipeline ${options.pipelineName} — DONE ${formatDuration(timing.totalDurationMs)} (${timing.stepCount} step(s), ${timing.timeoutCount} timeout(s))`,
    );

    return {
      siteName: site.name,
      pipelineName: options.pipelineName,
      exitCode: 0,
      ok: true,
      steps: reports,
      timing,
      filesModified: aggregateFilesModified(reports),
    };
  } finally {
    // ADR-0023: close the shared CacheLayer SQLite connection after pipeline completion.
    await cache.close();
  }
}

async function executePipelineForWorkspace(
  registry: KernelRegistry,
  options: ExecuteKernelPipelineOptions,
  steps: KernelPipelineStep[],
): Promise<KernelPipelineReport> {
  // RFC-0270: a generated budget entry, when present, wins over the inline
  // expectedDurationMs — the inline value stays as the cold-start fallback.
  const budgets = await loadPipelineBudgets(options.workspaceRoot);
  const totalSteps = steps.length;
  // RFC-0390: create cache layer and module hash cache for this pipeline run.
  const cache = await createCacheLayer(options.workspaceRoot);
  const moduleHashCache = new Map<string, string>();
  // RFC-0685: build workspace tree index once per pipeline run.
  let treeIndex: WorkspaceTreeIndex | undefined;
  try {
    treeIndex = await buildWorkspaceTreeIndex(options.workspaceRoot);
  } catch {
    treeIndex = undefined;
  }
  const concurrency = resolveConcurrency(options);
  // ADR-0023: batch telemetry records in-memory; write once at pipeline completion.
  const telemetryBatch: StepTelemetryRecord[] = [];
  progressLine(
    `[workspace] pipeline ${options.pipelineName} — ${totalSteps} step(s), concurrency ${concurrency}`,
  );

  // RFC-0687: load cross-pipeline cache hits and set up run state.
  if (options.force ?? false) {
    await clearPipelineCacheHits(options.workspaceRoot);
  }
  const importedHits = await loadImportedCacheHits(options.workspaceRoot, options.pipelineName);
  const runState: PipelineRunState = {
    cacheHitCommands: importedHits,
    pipelineName: options.pipelineName,
  };

  const scheduled = buildSchedule(steps);

  const stepTimings: Map<number, PipelineStepTiming> = new Map();

  try {
    const results = await executeScheduledSteps(
      scheduled,
      concurrency,
      async (sStep: ScheduledStep) => {
        const { step, stepIndex } = sStep;
        const command = registry.getCommand(step.command);
        if (!command) {
          throw new Error(
            `Kernel pipeline step \`${step.command}\` is not registered for workspace pipeline \`${options.pipelineName}\`.`,
          );
        }
        if (command.scope !== "workspace") {
          throw new Error(
            `Workspace pipeline \`${options.pipelineName}\` cannot execute app-scoped step \`${step.command}\` without an app target.`,
          );
        }

        // RFC-1028: resolve moduleSrcDir dynamically from command.modulePath.
        // Falls back to a constant hash when modulePath is absent (legacy modules).
        const moduleSrcDir = command.modulePath
          ? join(options.workspaceRoot, deriveModuleBasePath(command.modulePath) ?? "")
          : join(options.workspaceRoot, "packages", "werkstatt-site", "src");

        const logger = createKernelLogger(options.outputFormat ?? "pretty");
        const { io, intents } = createDefaultIO();
        const ownershipMap = await computeOwnershipMap(registry);
        const context: KernelRuntimeContext = {
          workspaceRoot: options.workspaceRoot,
          site: undefined,
          siteExplicit: false,
          logger,
          dryRun: options.dryRun ?? false,
          outputFormat: options.outputFormat ?? "pretty",
          io,
          fileIntents: intents,
          registry,
          ownershipMap,
        };

        const stepLabel = `[${stepIndex + 1}/${totalSteps}]`;
        if (options.outputFormat !== "json") {
          logger.section(`workspace: ${options.pipelineName} -> ${step.command}`);
        }
        progressLine(`${stepLabel} ${step.command} …`);

        const budgetedExpectedDurationMs = lookupExpectedDurationMs(
          budgets,
          options.pipelineName,
          step.command,
          null,
        );
        const startedAtMonotonicMs = Math.round(performance.now());
        let report: KernelExecutionReport;
        if (step.skip) {
          report = skippedExecutionReport(command, context, step.skipReason);
        } else if (shouldTransitiveSkip(command, runState)) {
          // RFC-0687: transitive cache skip — all upstream commands were cache hits.
          report = skippedExecutionReport(command, context, "transitive-cache-skip");
        } else {
          // RFC-0390: try cache read before executing.
          const cached = await tryCacheRead(
            cache,
            command,
            options.workspaceRoot,
            options.workspaceRoot,
            null,
            moduleSrcDir,
            moduleHashCache,
            options.force ?? false,
            options.dryRun ?? false,
            treeIndex,
          );
          if (cached) {
            report = cached;
            // RFC-0687: track cache hits for transitive skip.
            runState.cacheHitCommands.add(step.command);
          } else {
            report = await executeRegisteredCommand(
              command,
              context,
              [...(step.args ?? []), ...pipelineFlagsToArgs(options.flags)],
              {
                timeoutMs: step.timeoutMs,
                expectedDurationMs: budgetedExpectedDurationMs ?? step.expectedDurationMs,
              },
            );
            // RFC-0390: store successful results in cache.
            await tryCacheWrite(
              cache,
              command,
              report,
              options.workspaceRoot,
              options.workspaceRoot,
              null,
              moduleSrcDir,
              moduleHashCache,
              options.dryRun ?? false,
              treeIndex,
            );
          }
        }
        const endedAtMonotonicMs = Math.round(performance.now());
        progressLine(
          `${stepLabel} ${step.command} — ${stepStatusLabel(report)} ${formatDuration(report.timing.durationMs)}`,
        );
        // ADR-0023: collect telemetry in-memory; batch write at pipeline completion.
        if (!step.skip && !report.cached && !isTransitiveSkip(report)) {
          telemetryBatch.push({
            pipeline: options.pipelineName,
            command: step.command,
            app: null,
            durationMs: report.timing.durationMs,
            timedOut: report.timing.exceededTimeout,
            recordedAt: new Date().toISOString(),
          });
        }
        stepTimings.set(stepIndex, {
          pipeline: options.pipelineName,
          command: step.command,
          status: stepStatus(report),
          startedAtMonotonicMs,
          endedAtMonotonicMs,
          durationMs: report.timing.durationMs,
          ...(report.timing.timeoutMs !== undefined ? { timeoutMs: report.timing.timeoutMs } : {}),
          ...(report.timing.expectedDurationMs !== undefined
            ? { expectedDurationMs: report.timing.expectedDurationMs }
            : {}),
          exceededTimeout: report.timing.exceededTimeout,
        });

        return report;
      },
    );

    // Sort results by stepIndex (declaration order).
    const sortedResults = [...results].sort((a, b) => a.stepIndex - b.stepIndex);
    const reports = sortedResults.map((r) => r.report);
    const orderedStepTimings = scheduled.map((s) => stepTimings.get(s.stepIndex)!).filter(Boolean);

    const failed = reports.find((report) => !report.ok);
    const timing = pipelineTimingSummary(options.pipelineName, reports, orderedStepTimings);

    // ADR-0023: batch write all telemetry records in a single I/O operation.
    await batchAppendStepTelemetry(options.workspaceRoot, telemetryBatch);

    // RFC-0687: persist cache hits for cross-pipeline transitive skip.
    await persistCacheHits(options.workspaceRoot, options.pipelineName, runState.cacheHitCommands);

    if (options.outputFormat !== "json") {
      const logger = createKernelLogger(options.outputFormat ?? "pretty");
      printPipelineTimingSummary(logger, timing);
    }

    // RFC-0809: collect-errors mode — aggregate all independent failures.
    const collected = aggregateCollectErrors(sortedResults, options.collectErrors ?? false);
    if (collected) {
      return buildCollectErrorsReport(
        collected,
        reports,
        options.pipelineName,
        timing,
        `[workspace]`,
      );
    }

    if (failed) {
      progressLine(
        `[workspace] pipeline ${options.pipelineName} — FAILED at step ${failed.commandName} (${formatDuration(timing.totalDurationMs)})`,
      );
      return {
        pipelineName: options.pipelineName,
        exitCode: failed.exitCode,
        ok: false,
        steps: reports,
        timing,
        filesModified: aggregateFilesModified(reports),
      };
    }

    progressLine(
      `[workspace] pipeline ${options.pipelineName} — DONE ${formatDuration(timing.totalDurationMs)} (${timing.stepCount} step(s), ${timing.timeoutCount} timeout(s))`,
    );

    return {
      pipelineName: options.pipelineName,
      exitCode: 0,
      ok: true,
      steps: reports,
      timing,
      filesModified: aggregateFilesModified(reports),
    };
  } finally {
    // ADR-0023: close the shared CacheLayer SQLite connection after pipeline completion.
    await cache.close();
  }
}

const EXECUTE_KERNEL_PIPELINE_OPTION_KEYS = [
  "workspaceRoot",
  "pipelineName",
  "siteName",
  "allSites",
  "dryRun",
  "force",
  "outputFormat",
  "siteWorkspace",
  "concurrency",
  "flags",
  "collectErrors",
];

export async function executeKernelPipeline(
  options: ExecuteKernelPipelineOptions,
): Promise<KernelPipelineReport | KernelPipelineReport[]> {
  assertKnownOptionKeys(
    options,
    EXECUTE_KERNEL_PIPELINE_OPTION_KEYS,
    "executeKernelPipeline options",
  );
  progressLine(`pipeline ${options.pipelineName} — resolving target …`);

  // Pre-resolved site workspace bypasses discovery (e.g. closed-mission workpieces
  // where registry.currentMission is null and discovery can't find the workpiece).
  if (options.siteWorkspace) {
    const site = options.siteWorkspace;
    progressLine(`pipeline ${options.pipelineName} — 1 site(s): ${site.name}`);
    progressLine(`[${site.name}] loading app runtime …`);
    const { registry } = await loadAppRuntime(options.workspaceRoot, site);
    progressLine(`[${site.name}] app runtime ready`);
    const steps = registry.getPipeline(options.pipelineName);
    if (!steps) {
      throw new Error(
        `Kernel pipeline \`${options.pipelineName}\` is not registered for site \`${site.name}\`.`,
      );
    }
    return executePipelineForSite(site, registry, options, steps);
  }

  if (!options.siteName && !(options.allSites ?? false)) {
    const wsRegistry = await getOrBuildWorkspaceRegistry(options.workspaceRoot);
    if (wsRegistry) {
      progressLine(`pipeline ${options.pipelineName} — loading workspace registry …`);
      const wsSteps = wsRegistry.getPipeline(options.pipelineName);
      if (wsSteps) {
        progressLine(`pipeline ${options.pipelineName} — workspace registry ready`);
        return executePipelineForWorkspace(wsRegistry, options, wsSteps);
      }
    }
  }

  const targetSites = await ensureTargetSites(
    options.workspaceRoot,
    options.allSites ?? false,
    options.siteName,
  );

  if (targetSites.length === 0) {
    throw new Error("No target site with a kernel config could be resolved.");
  }

  progressLine(
    `pipeline ${options.pipelineName} — ${targetSites.length} site(s): ${targetSites.map((s) => s.name).join(", ")}`,
  );

  const reports: KernelPipelineReport[] = [];

  for (const site of targetSites) {
    progressLine(`[${site.name}] loading app runtime …`);
    const { registry } = await loadAppRuntime(options.workspaceRoot, site);
    progressLine(`[${site.name}] app runtime ready`);
    const steps = registry.getPipeline(options.pipelineName);
    if (!steps) {
      throw new Error(
        `Kernel pipeline \`${options.pipelineName}\` is not registered for site \`${site.name}\`.`,
      );
    }

    reports.push(await executePipelineForSite(site, registry, options, steps));
  }

  return options.allSites ? reports : reports[0]!;
}
