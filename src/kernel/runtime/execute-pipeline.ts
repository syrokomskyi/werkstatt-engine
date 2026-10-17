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
<KEY_DECISIONS>
  <item>Pipeline steps run in order — a failing step halts the pipeline unless marked non-blocking.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1138: pipeline hygiene — module-scoped exempt entries, archive gitignore guard, dns upsert to deploy phases, promote auto-sync, rfc.create claim protocol, siteHasRuntime filter</item>
  <item>RFC-1144: run read-only steps to completion in collect-errors pipeline mode

Scheduler: collectErrors option on executeScheduledSteps — read-only steps (ScheduledStep.readOnly, executor-resolved from mutatesState === false) run after dependency failures with ranAfterFailedDependency annotation; ranTainted set propagates taint transitively so mutating dependents still skip. Executor: mergeCollectErrorsOption OR-merges PipelineDeclaration.collectErrors with the CLI flag at registry resolution; readOnly annotated post-buildSchedule; taint flag copied to step reports; tainted failures marked in pretty output. Contracts: PipelineDeclaration.collectErrors, KernelExecutionReport.ranAfterFailedDependency, pipelines maps store full declarations. Declarations: collectErrors on validation-gate registrations (build.post, check, build.check, compass, integrity.release in the workpiece template; packages.check in checks module). Tests: 10 new cases covering AC-1..AC-6 plus transitive taint.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
  <item>RFC-1231: allSites context carrier on pipeline contexts

Both pipeline context-construction sites (site fan-out and workspace) populate KernelRuntimeContext.allSites from options.allSites so the executor's flags.all injection sees the consumed --all selector for steps declaring it.</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
  <history>ADR-0022, ADR-0023, ADR-0087, RFC-0303, RFC-0326, RFC-0390, RFC-0637, RFC-0686, RFC-0687, RFC-0809, RFC-1028, RFC-1097, RFC-1126, RFC-1130, RFC-1133</history>
</CHANGE_SUMMARY>
*/

import { performance } from "node:perf_hooks";
import process from "node:process";
import os from "node:os";
import { join } from "node:path";
import { createKernelLogger } from "../logger.ts";
import type { ActualState, PipelineDeclaration } from "@warpgogol/werkstatt-shared/kernel";
import {
  batchAppendStepTelemetry,
  loadPipelineBudgets,
  lookupExpectedDurationMs,
  type StepTelemetryRecord,
} from "../pipeline-budgets.ts";
import {
  createDefaultIO,
  EMPTY_WORKPIECE_ENV,
  loadWorkpieceEnv,
  type WorkspaceIO,
} from "@warpgogol/werkstatt-shared/kernel";
import { createCacheLayer } from "../cache/cache-layer.ts";
import { buildWorkspaceTreeIndex } from "../cache/workspace-tree-index.ts";
import type { WorkspaceTreeIndex } from "../cache/workspace-tree-index.ts";
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
} from "@warpgogol/werkstatt-shared/kernel";
import { executeRegisteredCommand, computeOwnershipMap } from "./execute-command.ts";
import { assertKnownOptionKeys, skippedExecutionReport } from "./shared.ts";
import {
  collectGitignoredPaths,
  isClosedWorkpiece,
  mutatingStepRunsOnClosedWorkpiece,
  writePatternToCheckPath,
} from "./closed-workpiece.ts";
import { ensureTargetSites, loadAppRuntime } from "./registry.ts";
import { getOrBuildWorkspaceRegistry } from "./registry-cache.ts";
import {
  buildSchedule,
  executeScheduledSteps,
  type ScheduledStep,
  type StepExecutionResult,
} from "./pipeline-scheduler.ts";

// @ai-invariant: Pipeline steps execute in declared order — a failing step halts the pipeline unless non-blocking or collectErrors read-only continuation applies.

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
  const collected: { failedSteps: string[]; exitCode: number; ok: false } = {
    failedSteps: failedResults.map((r) => r.report.commandName),
    exitCode: failedResults[0]!.report.exitCode,
    ok: false,
  };
  return collected;
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
  quiet?: boolean,
): KernelPipelineReport {
  for (const name of collected.failedSteps) {
    const failedReport = reports.find((r) => r.commandName === name);
    progressLine(`  [FAIL] ${name}: ${failedReport?.summary ?? "failed"}`, quiet);
  }
  progressLine(
    `${prefix} pipeline ${pipelineName} — FAILED (${collected.failedSteps.length} step(s) failed, ${formatDuration(timing.totalDurationMs)})`,
    quiet,
  );
  const report: KernelPipelineReport = {
    ...(siteName ? { siteName } : {}),
    pipelineName,
    exitCode: collected.exitCode,
    ok: false,
    steps: reports,
    timing,
    filesModified: aggregateFilesModified(reports),
    failedSteps: collected.failedSteps,
  };
  return report;
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

function progressLine(message: string, quiet?: boolean): void {
  // RFC-1309: --quiet suppresses pipeline progress preamble; step diagnostics
  // (logger.warn/error inside commands) are unaffected.
  if (quiet) return;
  process.stderr.write(`${message}\n`);
}

function stepStatusLabel(report: KernelExecutionReport): string {
  if (report.cached) return "SKIP (cached)";
  if (report.exitCode === 0 && report.summary?.startsWith("Skipped:")) return "SKIP";
  if (report.warned) return "WARN (warn-only)";
  if (report.timing.exceededTimeout) return "TIMEOUT";
  if (!report.ok) return "FAIL";
  if ((report.logSummary?.warning ?? 0) > 0) return "WARN";
  return "OK";
}

function stepStatus(report: KernelExecutionReport): PipelineStepTiming["status"] {
  if (report.cached) return "skipped";
  if (report.exitCode === 0 && report.summary?.startsWith("Skipped:")) return "skipped";
  if (report.warned) return "warn";
  if (report.timing.exceededTimeout) return "timeout";
  if (!report.ok) return "fail";
  if ((report.logSummary?.warning ?? 0) > 0) return "warn";
  return "pass";
}

/**
 * RFC-1184: warn-only rollout mode — when a step declares `warnOnly: true`
 * and its report failed, the failure is preserved on the report (exitCode,
 * summary, `warned: true`) but `ok` is flipped so the scheduler treats the
 * step as completed: the pipeline continues, dependents are not skipped or
 * tainted, and `aggregateCollectErrors` never lists it among failedSteps.
 * Blocking stays the default — warnOnly is explicit per-step opt-in for
 * staged rollout of newly blocking gates (RFC-1179/1180 precedent).
 */
export function applyWarnOnly(report: KernelExecutionReport, step: KernelPipelineStep): void {
  if (step.warnOnly === true && !report.ok) {
    report.ok = true;
    report.warned = true;
    report.summary = `[warn-only] ${report.summary ?? `${step.command} failed`}`;
  }
}

/**
 * RFC-0687: Check whether a report was skipped by transitive cache skip.
 * Used to exclude transitive-cache-skip reports from telemetry.
 */
function isTransitiveSkip(report: KernelExecutionReport): boolean {
  return report.summary?.startsWith("Skipped: transitive-cache-skip") ?? false;
}

function isClosedMissionSkip(report: KernelExecutionReport): boolean {
  return report.summary?.startsWith("Skipped: closed-mission") ?? false;
}

// ---------------------------------------------------------------------------
// ADR-0085/0087: closed-mission workpiece helpers live in ./closed-workpiece.ts
// (leaf module shared with execute-command.ts — the executor-level guard).
// ---------------------------------------------------------------------------

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
  io: WorkspaceIO = createDefaultIO().io,
): Promise<Set<string>> {
  const filePath = join(workspaceRoot, PIPELINE_CACHE_HITS_DIR, PIPELINE_CACHE_HITS_FILENAME);
  let raw: string;
  try {
    raw = await io.readFile(filePath);
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
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const dir = join(workspaceRoot, PIPELINE_CACHE_HITS_DIR);
  const filePath = join(dir, PIPELINE_CACHE_HITS_FILENAME);

  let existing: PipelineCacheHitsFile = { pipelines: {} };
  try {
    const raw = await io.readFile(filePath);
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
    await io.mkdir(dir);
    await io.writeFile(filePath, JSON.stringify(existing, null, 2) + "\n");
  } catch {
    // Non-fatal — persistence is best-effort.
  }
}

/**
 * RFC-0687: Clear the pipeline cache-hits file. Called when `--force` is set.
 */
export async function clearPipelineCacheHits(
  workspaceRoot: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const dir = join(workspaceRoot, PIPELINE_CACHE_HITS_DIR);
  const filePath = join(dir, PIPELINE_CACHE_HITS_FILENAME);
  try {
    await io.mkdir(dir);
    await io.writeFile(filePath, JSON.stringify({ pipelines: {} }, null, 2) + "\n");
  } catch {
    // Non-fatal — clear is best-effort.
  }
}

async function executePipelineForSite(
  site: DiscoveredSiteWorkspace,
  registry: ActualState,
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
    options.quiet,
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

  // RFC-1144: pre-resolve read-only classification.
  annotateReadOnlySteps(scheduled, registry);

  // ADR-0085: closed-mission workpiece — mutating steps become no-ops unless
  // every declared write is confined to gitignored paths (dist/, .cache/, …).
  const workpieceClosed = await isClosedWorkpiece(site.directory, createDefaultIO().io);
  const closedIgnoredPaths = workpieceClosed
    ? await collectGitignoredPaths(
        site.directory,
        steps.flatMap((s) => {
          const cmd = registry.commands.get(s.command);
          if (!cmd || cmd.mutatesState === false) return [];
          return (cmd.writes ?? [])
            .map((w) => writePatternToCheckPath(w, site.name))
            .filter((p): p is string => p !== null);
        }),
        createDefaultIO().io,
      )
    : null;
  if (workpieceClosed) {
    progressLine(
      `[${site.name}] workpiece is closed (ADR-0085) — mutating steps run only when all writes are gitignored`,
      options.quiet,
    );
  }

  const stepTimings: Map<number, PipelineStepTiming> = new Map();

  try {
    const results = await executeScheduledSteps(
      scheduled,
      concurrency,
      async (sStep: ScheduledStep) => {
        const { step, stepIndex } = sStep;
        const command = registry.commands.get(step.command);
        if (!command) {
          throw new Error(
            `Kernel pipeline step \`${step.command}\` is not registered for site \`${site.name}\`.`,
          );
        }

        const logger = createKernelLogger(options.outputFormat ?? "pretty");
        const { io, intents } = createDefaultIO();
        const ownershipMap = await computeOwnershipMap(registry);
        const context: KernelRuntimeContext = {
          workspaceRoot: options.workspaceRoot,
          site,
          siteExplicit: false,
          logger,
          dryRun: options.dryRun ?? false,
          allSites: options.allSites ?? false,
          outputFormat: options.outputFormat ?? "pretty",
          io,
          fileIntents: intents,
          actualState: registry,
          ownershipMap,
          workpieceEnv: await loadWorkpieceEnv(site.directory),
          // RFC-1133: the executor-level cache block inside
          // executeRegisteredCommand consumes this carrier — the pipeline no
          // longer calls the cache helpers itself.
          resultCache: { layer: cache, treeIndex, moduleHashCache },
        };

        const stepLabel = `[${stepIndex + 1}/${totalSteps}]`;
        if (options.outputFormat !== "json") {
          logger.section(`${site.name}: ${options.pipelineName} -> ${step.command}`);
        }
        progressLine(`${stepLabel} ${step.command} …`, options.quiet);

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
        } else if (
          workpieceClosed &&
          command.mutatesState !== false &&
          !mutatingStepRunsOnClosedWorkpiece(command, site.name, closedIgnoredPaths)
        ) {
          // ADR-0085: closed workpiece — a mutating step with tracked or
          // undeclared writes would produce uncommittable churn.
          report = skippedExecutionReport(command, context, "closed-mission");
        } else if (shouldTransitiveSkip(command, runState)) {
          // RFC-0687: transitive cache skip — all upstream commands were cache hits.
          report = skippedExecutionReport(command, context, "transitive-cache-skip");
        } else {
          // RFC-1133: the cache read/write lives inside executeRegisteredCommand
          // (single choke point). The pipeline only supplies argv and the
          // resultCache carrier on the context.
          const stepArgs = [...(step.args ?? []), ...pipelineFlagsToArgs(options.flags)];
          // Inject --site for workspace-scoped commands so they receive the site
          // name from the pipeline context (mirrors executeKernelCommand logic).
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
        }
        // RFC-1184: warn-only steps record the failure but do not block.
        applyWarnOnly(report, step);
        // RFC-0687 + RFC-1133: a cached report feeds the transitive-skip set —
        // on both executors now (the app-scoped path previously missed this).
        if (report.cached === true) {
          runState.cacheHitCommands.add(step.command);
        }
        const endedAtMonotonicMs = Math.round(performance.now());
        // RFC-1144: mark possibly-cascaded failures so operators can discount them.
        const taintedNote =
          sStep.ranAfterFailedDependency === true && !report.ok
            ? " (ran after failed dependency — may be cascaded)"
            : "";
        progressLine(
          `${stepLabel} ${step.command} — ${stepStatusLabel(report)} ${formatDuration(report.timing.durationMs)}${taintedNote}`,
          options.quiet,
        );
        // ADR-0023: collect telemetry in-memory; batch write at pipeline completion.
        // ADR-0085: closed-mission skips are excluded — a 0ms skip would
        // corrupt the expectedDurationMs budgets derived from telemetry.
        if (
          !step.skip &&
          !report.cached &&
          !isTransitiveSkip(report) &&
          !isClosedMissionSkip(report)
        ) {
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

        // RFC-1144: copy the scheduler's taint annotation onto the report.
        if (sStep.ranAfterFailedDependency === true) {
          report.ranAfterFailedDependency = true;
        }

        return report;
      },
      { collectErrors: options.collectErrors === true },
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
        options.quiet,
      );
    }

    if (failed) {
      progressLine(
        `[${site.name}] pipeline ${options.pipelineName} — FAILED at step ${failed.commandName} (${formatDuration(timing.totalDurationMs)})`,
        options.quiet,
      );
      const failedReport: KernelPipelineReport = {
        siteName: site.name,
        pipelineName: options.pipelineName,
        exitCode: failed.exitCode,
        ok: false,
        steps: reports,
        timing,
        filesModified: aggregateFilesModified(reports),
      };
      return failedReport;
    }

    progressLine(
      `[${site.name}] pipeline ${options.pipelineName} — DONE ${formatDuration(timing.totalDurationMs)} (${timing.stepCount} step(s), ${timing.timeoutCount} timeout(s))`,
      options.quiet,
    );

    const doneReport: KernelPipelineReport = {
      siteName: site.name,
      pipelineName: options.pipelineName,
      exitCode: 0,
      ok: true,
      steps: reports,
      timing,
      filesModified: aggregateFilesModified(reports),
    };
    return doneReport;
  } finally {
    // ADR-0023: close the shared CacheLayer SQLite connection after pipeline completion.
    await cache.close();
  }
}

async function executePipelineForWorkspace(
  registry: ActualState,
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
    options.quiet,
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

  // RFC-1144: pre-resolve read-only classification.
  annotateReadOnlySteps(scheduled, registry);

  const stepTimings: Map<number, PipelineStepTiming> = new Map();

  try {
    const results = await executeScheduledSteps(
      scheduled,
      concurrency,
      async (sStep: ScheduledStep) => {
        const { step, stepIndex } = sStep;
        const command = registry.commands.get(step.command);
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

        const logger = createKernelLogger(options.outputFormat ?? "pretty");
        const { io, intents } = createDefaultIO();
        const ownershipMap = await computeOwnershipMap(registry);
        const context: KernelRuntimeContext = {
          workspaceRoot: options.workspaceRoot,
          site: undefined,
          siteExplicit: false,
          logger,
          dryRun: options.dryRun ?? false,
          allSites: options.allSites ?? false,
          outputFormat: options.outputFormat ?? "pretty",
          io,
          fileIntents: intents,
          actualState: registry,
          ownershipMap,
          workpieceEnv: EMPTY_WORKPIECE_ENV,
          // RFC-1133: the executor-level cache block inside
          // executeRegisteredCommand consumes this carrier — the pipeline no
          // longer calls the cache helpers itself.
          resultCache: { layer: cache, treeIndex, moduleHashCache },
        };

        const stepLabel = `[${stepIndex + 1}/${totalSteps}]`;
        if (options.outputFormat !== "json") {
          logger.section(`workspace: ${options.pipelineName} -> ${step.command}`);
        }
        progressLine(`${stepLabel} ${step.command} …`, options.quiet);

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
          // RFC-1133: the cache read/write lives inside executeRegisteredCommand
          // (single choke point). The pipeline only supplies argv and the
          // resultCache carrier on the context.
          const stepArgs = [...(step.args ?? []), ...pipelineFlagsToArgs(options.flags)];
          report = await executeRegisteredCommand(command, context, stepArgs, {
            timeoutMs: step.timeoutMs,
            expectedDurationMs: budgetedExpectedDurationMs ?? step.expectedDurationMs,
          });
        }
        // RFC-1184: warn-only steps record the failure but do not block.
        applyWarnOnly(report, step);
        // RFC-0687 + RFC-1133: a cached report feeds the transitive-skip set.
        if (report.cached === true) {
          runState.cacheHitCommands.add(step.command);
        }
        const endedAtMonotonicMs = Math.round(performance.now());
        // RFC-1144: mark possibly-cascaded failures so operators can discount them.
        const taintedNote =
          sStep.ranAfterFailedDependency === true && !report.ok
            ? " (ran after failed dependency — may be cascaded)"
            : "";
        progressLine(
          `${stepLabel} ${step.command} — ${stepStatusLabel(report)} ${formatDuration(report.timing.durationMs)}${taintedNote}`,
          options.quiet,
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

        // RFC-1144: copy the scheduler's taint annotation onto the report.
        if (sStep.ranAfterFailedDependency === true) {
          report.ranAfterFailedDependency = true;
        }

        return report;
      },
      { collectErrors: options.collectErrors === true },
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
        undefined,
        options.quiet,
      );
    }

    if (failed) {
      progressLine(
        `[workspace] pipeline ${options.pipelineName} — FAILED at step ${failed.commandName} (${formatDuration(timing.totalDurationMs)})`,
        options.quiet,
      );
      const failedReport: KernelPipelineReport = {
        pipelineName: options.pipelineName,
        exitCode: failed.exitCode,
        ok: false,
        steps: reports,
        timing,
        filesModified: aggregateFilesModified(reports),
      };
      return failedReport;
    }

    progressLine(
      `[workspace] pipeline ${options.pipelineName} — DONE ${formatDuration(timing.totalDurationMs)} (${timing.stepCount} step(s), ${timing.timeoutCount} timeout(s))`,
      options.quiet,
    );

    const doneReport: KernelPipelineReport = {
      pipelineName: options.pipelineName,
      exitCode: 0,
      ok: true,
      steps: reports,
      timing,
      filesModified: aggregateFilesModified(reports),
    };
    return doneReport;
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
  "quiet",
];

/**
 * RFC-1144: pre-resolve read-only classification on a built schedule — the
 * scheduler never loads command definitions; missing mutatesState ⇒ mutating
 * (conservative).
 */
function annotateReadOnlySteps(scheduled: ScheduledStep[], registry: ActualState): void {
  for (const sStep of scheduled) {
    sStep.readOnly = registry.commands.get(sStep.step.command)?.mutatesState === false;
  }
}

/**
 * RFC-1144: OR-merge a pipeline declaration's `collectErrors` into the
 * executor options — either opt-in enables the mode; there is no opt-out flag.
 * Exported for unit tests (AC-6).
 */
export function mergeCollectErrorsOption(
  options: ExecuteKernelPipelineOptions,
  declaration: PipelineDeclaration,
): ExecuteKernelPipelineOptions {
  if (declaration.collectErrors === true && options.collectErrors !== true) {
    return { ...options, collectErrors: true };
  }
  return options;
}

export async function executeKernelPipeline(
  options: ExecuteKernelPipelineOptions,
): Promise<KernelPipelineReport | KernelPipelineReport[]> {
  assertKnownOptionKeys(
    options,
    EXECUTE_KERNEL_PIPELINE_OPTION_KEYS,
    "executeKernelPipeline options",
  );
  progressLine(`pipeline ${options.pipelineName} — resolving target …`, options.quiet);

  // Pre-resolved site workspace bypasses discovery (e.g. closed-mission workpieces
  // where registry.currentMission is null and discovery can't find the workpiece).
  if (options.siteWorkspace) {
    const site = options.siteWorkspace;
    progressLine(`pipeline ${options.pipelineName} — 1 site(s): ${site.name}`, options.quiet);
    progressLine(`[${site.name}] loading app runtime …`, options.quiet);
    const { registry } = await loadAppRuntime(options.workspaceRoot, site, {
      quiet: options.quiet,
    });
    progressLine(`[${site.name}] app runtime ready`, options.quiet);
    const pipelineDecl = registry.pipelines.get(options.pipelineName);
    if (!pipelineDecl) {
      throw new Error(
        `Kernel pipeline \`${options.pipelineName}\` is not registered for site \`${site.name}\`.`,
      );
    }
    return executePipelineForSite(
      site,
      registry,
      mergeCollectErrorsOption(options, pipelineDecl),
      pipelineDecl.steps,
    );
  }

  if (!options.siteName && !(options.allSites ?? false)) {
    const wsRegistry = await getOrBuildWorkspaceRegistry(options.workspaceRoot, {
      quiet: options.quiet,
    });
    if (wsRegistry) {
      progressLine(
        `pipeline ${options.pipelineName} — loading workspace registry …`,
        options.quiet,
      );
      const wsPipelineDecl = wsRegistry.pipelines.get(options.pipelineName);
      if (wsPipelineDecl) {
        progressLine(`pipeline ${options.pipelineName} — workspace registry ready`, options.quiet);
        return executePipelineForWorkspace(
          wsRegistry,
          mergeCollectErrorsOption(options, wsPipelineDecl),
          wsPipelineDecl.steps,
        );
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
    options.quiet,
  );

  const reports: KernelPipelineReport[] = [];

  for (const site of targetSites) {
    progressLine(`[${site.name}] loading app runtime …`, options.quiet);
    const { registry } = await loadAppRuntime(options.workspaceRoot, site, {
      quiet: options.quiet,
    });
    progressLine(`[${site.name}] app runtime ready`, options.quiet);
    const pipelineDecl = registry.pipelines.get(options.pipelineName);
    if (!pipelineDecl) {
      throw new Error(
        `Kernel pipeline \`${options.pipelineName}\` is not registered for site \`${site.name}\`.`,
      );
    }

    reports.push(
      await executePipelineForSite(
        site,
        registry,
        mergeCollectErrorsOption(options, pipelineDecl),
        pipelineDecl.steps,
      ),
    );
  }

  return options.allSites ? reports : reports[0]!;
}
