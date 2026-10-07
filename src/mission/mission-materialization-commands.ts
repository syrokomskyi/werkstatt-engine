/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/mission/mission-materialization-commands.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0096: dedupe CHANGE_SUMMARY item, use SNAPSHOT_FILENAME in CACHE_CLONE_ONLY_PATHS</item>
  <item>RFC-1218: extend reconcile conflict auto-resolution to the generated-file registry (ownershipMap ∪ CACHE_CLONE_GENERATED_PATTERNS) resolving theirs (workpiece); record paths in merge commit body + mission-reconcile bordbuch metadata.autoResolvedPaths[]</item>
  <item>RFC-1219: preserve operations/ journals across the record-pre-reconcile-sha rewind — restore from pre-reset HEAD and re-commit before the merge (m000192 journal loss); probe failures are blocking (REVIEW-CODE-2026-10-07-16 F-2).</item>
  <item>RFC-1221: count-transferred-commits derives mergedShas from the merge commit's parents (rev-list commitSha^2 --not commitSha^1 + workpiece membership) instead of preReconcileSha..FETCH_HEAD — survives journal resume and fold paths; preReconcileSha falls back to commitSha^1.</item>
  <item>RFC-1221 follow-up: mergeCommitSha now records commitSha itself when commitSha is a merge commit (null otherwise) — the previous HEAD^1 capture ran after post-merge steps could commit, storing a post-merge parent instead of the merge commit.</item>
  <history>ADR-0008, ADR-0060, ADR-0093, ADR-0096, RFC-0356, RFC-0480, RFC-0522, RFC-0560, RFC-0568, RFC-0578, RFC-0579, RFC-0580, RFC-0635, RFC-0644, RFC-0689, RFC-0697, RFC-0702, RFC-0705, RFC-0749, RFC-0763, RFC-0796, RFC-0797, RFC-0820, RFC-0913, RFC-0918, RFC-0958, RFC-0973, RFC-1020, RFC-1028, RFC-1074, RFC-1086, RFC-1097, RFC-1149, RFC-1159</history>
</CHANGE_SUMMARY>
*/

import {
  createDefaultIO,
  execOrThrow,
  type WorkspaceIO,
} from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import path from "node:path";
import picomatch from "picomatch";
import { parse as yamlParse } from "yaml";
import type {
  Diagnostic,
  DiscoveredSiteWorkspace,
  KernelCommandInput,
  KernelCommandResult,
  KernelNextStep,
  KernelPipelineReport,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelCommand, executeKernelPipeline } from "@warpgogol/werkstatt-engine/kernel";
import { createCacheLayer } from "../kernel/cache/cache-layer.ts";
import { clearPipelineCacheHits } from "../kernel/runtime/execute-pipeline.ts";
import { collectFiles } from "@warpgogol/werkstatt-shared/node/fs";
import {
  runPipelinePhase,
  computeBuildInputHash,
  writePreliminaryBuildIdentity,
  cleanupPreliminaryBuildIdentity,
} from "../handoff/build-pipeline-helpers.ts";
import { readMissionManifest, writeMissionManifest, resolveMissionDir } from "./mission-io.ts";
import {
  isWorkpieceDirty,
  investigateUntrackedFiles,
  commitWorkpieceIfDirty,
  commitCacheCloneIfDirty,
  cacheCloneCommit,
} from "./mission-git-commit.ts";
import { acquireLock, releaseLock, commitWerkstattSideEffects } from "../werkstatt/index.ts";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import { resolveActor } from "./actor-identity.ts";
import { resolveCacheClonePath, readSystemConfig } from "../sternsystem/registry-io.ts";
import {
  orchestrateSnap01Recovery,
  bootstrapCommittedSnapshot,
  SNAPSHOT_FILENAME,
} from "./snapshot-auto-regen.ts";
import { commitBordbuchProjections } from "../bordbuch/bordbuch-commit.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import type { WorkpieceConfigPresenceResult } from "./workpiece-config-presence-check.ts";
import {
  restoreCacheCloneGitignore,
  untrackForbiddenGeneratedFiles,
  CACHE_CLONE_GENERATED_PATTERNS,
} from "./cache-clone-gitignore.ts";
import { runOperation } from "../journal/runner.ts";
import { checkDifferentKindOperation } from "../journal/index.ts";
import type { OperationStep, OperationDefinition } from "../journal/index.ts";
import type { MissionManifest } from "@warpgogol/werkstatt-engine/schemas";
import { writeValidationState, buildValidatorStatesFromSteps } from "./validation-state.ts";

const STERNSYSTEM_DATA_PATHS = [
  "src/content",
  "public",
  "provenance",
  "system-config.yaml",
  "system-state.yaml",
];

/**
 * Files that exist only in the cache clone (not in workpiece git).
 * During mission.reconcile merge, these cause modify/delete conflicts.
 * They are auto-resolved by keeping the cache clone version (ours).
 * Generated-registry paths are the second auto-resolved class — they resolve
 * theirs (workpiece) per RFC-1218 via the ownershipMap-derived allowlist.
 * Add new cache-clone-only files here instead of modifying isAutoResolvablePath.
 */
const CACHE_CLONE_ONLY_PATHS: readonly string[] = [
  "bordbuch/",
  "public/.well-known/bordbuch",
  "dns-records.yaml",
  ".materialization-state.json",
  SNAPSHOT_FILENAME,
  ".gitignore",
  // RFC-1219: operation journals are append-only cache-side state — merge
  // conflicts on them resolve ours (the workpiece copy is a stale replica),
  // and the rewind preservation below keeps them across reset --hard.
  "operations/",
];

// RFC-0763: shared helper for bordbuch cleanup on failure paths.
// Avoids duplicating the try/catch/log block at each failure early-return.
async function cleanupBordbuchOnFailure(
  workspaceRoot: string,
  systemId: string,
  label: string,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<void> {
  try {
    const result = await commitBordbuchProjections(workspaceRoot, systemId);
    if (result.committed) {
      logger.info(
        `  Bordbuch cleanup on ${label}: committed ${result.filesCommitted.length} file(s)`,
      );
    }
  } catch (err) {
    logger.warn(
      `  Bordbuch cleanup on ${label} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// RFC-1149: shell-string exec preserved verbatim via sh -c — commands with
// interpolated shell quoting (JSON.stringify args, -- ${paths}) keep identical
// semantics without re-tokenizing into argv.
async function shExec(cmd: string, cwd: string, io: WorkspaceIO): Promise<string> {
  const result = await io.exec("sh", ["-c", cmd], { cwd });
  if (result.exitCode !== 0) {
    const err = new Error(
      `command failed (exit ${result.exitCode}): ${cmd}\n${result.stderr.trim()}`,
    );
    throw err;
  }
  return result.stdout;
}

async function copyDir(src: string, dest: string, io: WorkspaceIO): Promise<void> {
  if (!(await io.exists(src))) return;
  await io.mkdir(dest);
  const entries = await io.readdir(src);
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath, io);
    } else {
      await io.copyFile(srcPath, destPath);
    }
  }
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

// RFC-1074: Shared distribution persistence — used by both runMissionValidate and runMissionBuild.
// Copies workpiece/dist to distribution/dist, writes build-input-hash.json (on success),
// and writes build-manifest.json. Best-effort: caller wraps in try/catch if needed.
async function persistDistribution(params: {
  workspaceRoot: string;
  workpieceDir: string;
  distributionDir: string;
  missionId: string;
  systemId: string;
  succeeded: boolean;
  routeCount: number;
  sitemapHash: string;
  builtAt: string;
  io: WorkspaceIO;
  error?: string;
}): Promise<void> {
  const distSrc = path.join(params.workpieceDir, "dist");
  const distDest = path.join(params.distributionDir, "dist");
  if (await params.io.exists(distSrc)) {
    if (await params.io.exists(distDest)) {
      await params.io.rm(distDest, { recursive: true });
    }
    await copyDir(distSrc, distDest, params.io);
  }

  if (params.succeeded) {
    const { buildInputHash } = await computeBuildInputHash(
      params.workspaceRoot,
      params.workpieceDir,
    );
    await atomicWriteFile(
      path.join(params.distributionDir, "build-input-hash.json"),
      JSON.stringify({ buildInputHash, computedAt: new Date().toISOString() }, null, 2) + "\n",
    );
  }

  const buildManifest = {
    builtAt: params.builtAt,
    missionId: params.missionId,
    systemId: params.systemId,
    succeeded: params.succeeded,
    routeCount: params.routeCount,
    sitemapHash: params.sitemapHash,
    ...(params.error ? { error: params.error } : {}),
  };
  await atomicWriteFile(
    path.join(params.distributionDir, "build-manifest.json"),
    JSON.stringify(buildManifest, null, 2) + "\n",
  );
}

// RFC-0976: Shared auto-commit logic for both distribution-reuse and full-build success paths.
// Commits generated artifacts via commitWorkpieceIfDirty, then re-checks dirty state.
// Returns the post-commit dirty check so the caller can warn if files remain uncommitted.
async function autoCommitAfterValidation(
  workpieceDir: string,
  missionId: string,
  skipAutoCommit: boolean,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
  io: WorkspaceIO,
): Promise<{ dirty: boolean; fileCount: number; files?: string[] }> {
  let dirtyCheck = await isWorkpieceDirty(workpieceDir, io);
  // ADR-0085: never attempt commits on a closed workpiece — RFC-0878 blocks
  // them anyway; report the dirty state without the misleading failure warn.
  const workpieceClosed = await io.exists(path.join(workpieceDir, ".closed"));
  if (dirtyCheck.dirty && !skipAutoCommit && !workpieceClosed) {
    try {
      const autoCommit = await commitWorkpieceIfDirty(
        workpieceDir,
        missionId,
        "chore: post-validation artifacts (mission.validate)",
        io,
      );
      if (autoCommit.committed) {
        logger.info(
          `[mission.validate] auto-committed ${dirtyCheck.fileCount} generated artifact(s) (${autoCommit.commitSha?.slice(0, 8)})`,
        );
      }
      dirtyCheck = await isWorkpieceDirty(workpieceDir, io);
    } catch (err) {
      logger.warn(
        `[mission.validate] auto-commit failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (dirtyCheck.dirty) {
    logger.warn(
      `[mission.validate] workpiece has ${dirtyCheck.fileCount} uncommitted file(s) — reconcile will auto-commit these before merge. Run \`git status\` to review.`,
    );
  }
  return dirtyCheck;
}

// RFC-0796: Workspace-level advisory check for stale entries in missions/ root.
// Warns about stale symlinks or terminal-state directories. Non-blocking.
export async function validateNoStaleMissionEntries(
  workspaceRoot: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<StaleEntryViolation[]> {
  const missionsPath = path.join(workspaceRoot, "missions");
  if (!(await io.exists(missionsPath))) return [];

  const warnings: StaleEntryViolation[] = [];
  const entries = await io.readdir(missionsPath);
  for (const entry of entries) {
    if (entry.name === "archive") continue;
    const entryPath = path.join(missionsPath, entry.name);
    const sourceRel = `missions/${entry.name}`;

    const linkCheck = await io.exec("test", ["-L", entryPath]);
    if (linkCheck.exitCode === 0) {
      warnings.push({
        path: sourceRel,
        kind: "symlink",
        message: "stale symlink in missions/ root — run mission.archive to clean up",
      });
    } else if (entry.isDirectory) {
      // Check if this is a terminal-state mission directory
      const manifestPath = path.join(entryPath, "mission.yaml");
      if (await io.exists(manifestPath)) {
        try {
          const content = await io.readFile(manifestPath);
          const m = yamlParse(content);
          if (m.state === "closed" || m.state === "aborted") {
            warnings.push({
              path: sourceRel,
              kind: "terminal-state-in-root",
              state: m.state,
              message: `terminal-state mission (${m.state}) in missions/ root — run mission.archive to move to archive`,
            });
          }
        } catch {
          // Can't read manifest — skip
        }
      }
    }
  }
  return warnings;
}

// §2: mission.validate
export interface StaleEntryViolation {
  path: string;
  kind: "symlink" | "terminal-state-in-root";
  state?: string;
  message: string;
}

export interface MissionValidateData {
  missionId: string;
  contractFull: { passed: boolean; validators: Array<Record<string, unknown>> };
  build: { succeeded: boolean; routeCount: number; sitemapHash: string; error?: string };
  diagnostics?: Diagnostic[];
  distributionReused: boolean;
  buildInputHash: string | null;
  fullBuildRan: boolean;
  validatedAt: string;
  staleEntryWarnings?: StaleEntryViolation[];
}

interface BuildFailurePattern {
  id: string;
  test: (errorOutput: string) => boolean;
  fixHint: string;
  excerpt: (errorOutput: string) => string;
}

function extractErrorLine(output: string, pattern: RegExp): string {
  const lines = output.split("\n");
  const matchLine = lines.find((l) => pattern.test(l));
  return (matchLine ?? lines[0] ?? "").trim().slice(0, 200);
}

const BUILD_FAILURE_PATTERNS: BuildFailurePattern[] = [
  {
    id: "enoent-system-manifest",
    test: (out) => /ENOENT.*system\.md|loadSystemManifestSync.*not found/i.test(out),
    fixHint:
      "Guard loadSystemManifestSync with import.meta.env.DEV — it resolves __dirname differently during prerender. See middleware.template.ts.",
    excerpt: (out) => extractErrorLine(out, /ENOENT|loadSystemManifestSync/i),
  },
  {
    id: "module-not-found",
    test: (out) => /Cannot find module|Module not found|ERR_MODULE_NOT_FOUND/i.test(out),
    fixHint:
      "Check the import path in the file shown above. If it's a workspace package, run pnpm install. If it's a relative path, verify the file exists.",
    excerpt: (out) => extractErrorLine(out, /Cannot find module|Module not found/i),
  },
  {
    id: "content-schema-error",
    test: (out) => /schema|frontmatter|collection.*error|ZodError/i.test(out),
    fixHint:
      "Check the frontmatter of the file shown above against its content collection schema. Look for missing required fields or type mismatches.",
    excerpt: (out) => extractErrorLine(out, /schema|frontmatter|ZodError/i),
  },
  {
    id: "typescript-error",
    test: (out) => /error TS\d+:|Type .* is not assignable/i.test(out),
    fixHint:
      "Fix the TypeScript type mismatch in the file shown above. Check the component props schema or the type declaration.",
    excerpt: (out) => extractErrorLine(out, /error TS\d+/i),
  },
];

function matchBuildFailure(errorOutput: string): BuildFailurePattern | undefined {
  return BUILD_FAILURE_PATTERNS.find((p) => p.test(errorOutput));
}

export function buildFailureDiagnostics(buildError: string): Diagnostic[] {
  const pattern = matchBuildFailure(buildError);
  return [
    {
      ruleId: "BUILD-01",
      severity: "error",
      message: pattern
        ? `Astro build failed (${pattern.id}): ${pattern.excerpt(buildError)}`
        : `Astro build failed: ${buildError.slice(0, 200)}`,
      fixHint: pattern?.fixHint ?? "Read the full build output above for the error details.",
      data: {
        patternId: pattern?.id ?? "unknown",
        buildErrorLength: buildError.length,
      },
    },
  ];
}

function buildValidateNextSteps(
  missionId: string,
  dirtyCheck: { dirty: boolean; fileCount: number },
): KernelNextStep[] {
  return dirtyCheck.dirty
    ? [
        {
          action: `Commit uncommitted changes: pnpm exec werkstatt run mission.git.commit --mission ${missionId} --message "<msg>"`,
          kind: "required",
        },
        {
          action: `Then run: pnpm exec werkstatt run mission.reconcile --mission ${missionId}`,
          kind: "optional",
        },
      ]
    : [
        {
          action: `Run: pnpm exec werkstatt run mission.reconcile --mission ${missionId}`,
          kind: "optional",
        },
        {
          action: `Then run: pnpm exec werkstatt run mission.close --mission ${missionId}`,
          kind: "optional",
        },
      ];
}

// RFC-1086: PreviousValidationReport — subset of validation-report.json read by --fast
export interface PreviousValidationReport {
  schemaVersion: string;
  missionId: string;
  contractFull: {
    passed: boolean;
    validators: Array<{ name: string; status: "pass" | "fail"; exitCode: number }>;
  };
  build: {
    succeeded: boolean;
    routeCount: number;
    sitemapHash: string;
    failedSteps: Array<{ name: string; exitCode: number }>;
  };
  distributionReused: boolean;
  buildInputHash: string | null;
  fullBuildRan: boolean;
  validatedAt: string;
}

// RFC-1086: read and parse the previous validation-report.json
export async function readPreviousValidationReport(
  evidenceDir: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<PreviousValidationReport | null> {
  const reportPath = path.join(evidenceDir, "validation-report.json");
  try {
    const raw = await io.readFile(reportPath);
    return JSON.parse(raw) as PreviousValidationReport;
  } catch {
    return null;
  }
}

// RFC-1086: check if all 4 phases passed in the previous report
export function isPreviousReportAllPassed(report: PreviousValidationReport): boolean {
  return (
    report.contractFull.passed && report.build.succeeded && report.build.failedSteps.length === 0
  );
}

// RFC-0958: ValidateStepCtx — mutable context for journaled validate steps
export interface ValidateStepCtx {
  workspaceRoot: string;
  missionId: string;
  manifest: MissionManifest;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
  evidenceDir: string;
  missionDir: string;
  workpieceDir: string;
  // ADR-0085: synthetic site pointing at the workpiece — set for closed
  // missions, where registry.currentMission is null and site discovery would
  // resolve to the cache clone instead of the workpiece under audit.
  siteWorkspace?: DiscoveredSiteWorkspace;
  collectErrors: boolean;
  skipContentRegression: boolean;
  autoAcceptRegression: boolean;
  force: boolean;
  fast: boolean;
  previousReport: PreviousValidationReport | null;
  cascadeRerun: boolean;
  prepareReport: KernelPipelineReport | null;
  pipelineReport: KernelPipelineReport | null;
  staticPassed: boolean;
  stepCount: number;
  failedSteps: Array<{ name: string; exitCode: number }>;
  buildSucceeded: boolean;
  buildError: string | undefined;
  routeCount: number;
  sitemapHash: string;
  postPipelineReport: KernelPipelineReport | undefined;
  dirtyBeforeBuildPost: { dirty: boolean; fileCount: number };
  preliminaryBuildIdentityPath: string | null;
  now: string;
  io: WorkspaceIO;
}

// RFC-1086: create a minimally valid KernelPipelineReport for skipped phases
function makeSkippedPipelineReport(pipelineName: string): KernelPipelineReport {
  return {
    pipelineName,
    exitCode: 0,
    ok: true,
    steps: [],
    timing: {
      pipeline: pipelineName,
      totalDurationMs: 0,
      stepCount: 0,
      slowestSteps: [],
      timeoutCount: 0,
      warningCount: 0,
    },
  };
}

// RFC-0958: buildValidateSteps — journaled steps for mission.validate build cycle
export function buildValidateSteps(_ctx: ValidateStepCtx): OperationStep<ValidateStepCtx>[] {
  return [
    {
      name: "build-prepare",
      run: async (c: ValidateStepCtx) => {
        // RFC-1086: skip build.prepare if --fast and previous report shows it passed
        if (c.fast && c.previousReport && c.previousReport.contractFull.passed) {
          c.logger.info("  Skipping build.prepare (passed in previous run)");
          c.prepareReport = makeSkippedPipelineReport("build.prepare");
          return;
        }
        c.cascadeRerun = true;
        c.logger.info(`  Running build.prepare pipeline for ${c.manifest.systemId}…`);
        const prepareResult = await executeKernelPipeline({
          workspaceRoot: c.workspaceRoot,
          pipelineName: "build.prepare",
          siteName: c.manifest.systemId,
          outputFormat: "pretty",
          ...(c.siteWorkspace ? { siteWorkspace: c.siteWorkspace } : {}),
          ...(c.force ? { force: true } : {}),
          ...(c.collectErrors ? { collectErrors: true } : {}),
        });
        c.prepareReport = Array.isArray(prepareResult) ? prepareResult[0] : prepareResult;
        if (!c.prepareReport.ok) {
          const failedPrepareSteps = c.prepareReport.steps
            .filter((s) => !s.ok)
            .map((s) => ({ name: s.commandName, exitCode: s.exitCode }));
          const report = {
            schemaVersion: "1.0.0",
            missionId: c.missionId,
            contractFull: {
              passed: false,
              validators: c.prepareReport.steps.map((s) => ({
                name: s.commandName,
                status: s.ok ? "pass" : "fail",
                exitCode: s.exitCode,
              })),
            },
            build: {
              succeeded: false,
              routeCount: 0,
              sitemapHash: "sha256:failed",
              failedSteps: failedPrepareSteps,
            },
            distributionReused: false,
            buildInputHash: null,
            fullBuildRan: true,
            validatedAt: new Date().toISOString(),
          };
          await atomicWriteFile(
            path.join(c.evidenceDir, "validation-report.json"),
            JSON.stringify(report, null, 2) + "\n",
          );
          // RFC-0763: clean bordbuch projections on build.prepare failure path
          await cleanupBordbuchOnFailure(
            c.workspaceRoot,
            c.manifest.systemId,
            "build.prepare failure",
            c.logger,
          );
          throw new Error(
            `[mission.validate] ${c.missionId} build.prepare FAILED (${failedPrepareSteps.length} steps failed)`,
          );
        }
      },
      verify: async (c: ValidateStepCtx) => {
        return c.prepareReport !== null && c.prepareReport.ok;
      },
    },
    {
      name: "build-check",
      run: async (c: ValidateStepCtx) => {
        // RFC-1086: skip build.check if --fast, no cascade, and previous report shows it passed
        if (
          c.fast &&
          !c.cascadeRerun &&
          c.previousReport &&
          c.previousReport.build.failedSteps.length === 0
        ) {
          c.logger.info("  Skipping build.check (passed in previous run)");
          c.pipelineReport = makeSkippedPipelineReport("build.check");
          c.staticPassed = true;
          return;
        }
        c.cascadeRerun = true;
        c.logger.info(`  Running build.check pipeline for ${c.manifest.systemId}…`);
        const pipelineFlags: Record<string, boolean> = {};
        if (c.skipContentRegression) pipelineFlags["skip-content-regression"] = true;
        if (c.autoAcceptRegression) pipelineFlags["auto-accept"] = true;
        const pipelineResult = await executeKernelPipeline({
          workspaceRoot: c.workspaceRoot,
          pipelineName: "build.check",
          siteName: c.manifest.systemId,
          outputFormat: "pretty",
          ...(c.siteWorkspace ? { siteWorkspace: c.siteWorkspace } : {}),
          ...(c.force ? { force: true } : {}),
          ...(Object.keys(pipelineFlags).length > 0 ? { flags: pipelineFlags } : {}),
          ...(c.collectErrors ? { collectErrors: true } : {}),
        });
        c.pipelineReport = Array.isArray(pipelineResult) ? pipelineResult[0] : pipelineResult;
        c.staticPassed = c.pipelineReport.ok;
        c.stepCount = c.pipelineReport.steps.length;
        c.failedSteps = c.pipelineReport.steps
          .filter((s) => !s.ok)
          .map((s) => ({ name: s.commandName, exitCode: s.exitCode }));
      },
      verify: async (c: ValidateStepCtx) => {
        return c.pipelineReport !== null;
      },
    },
    {
      name: "astro-build",
      run: async (c: ValidateStepCtx) => {
        if (!c.staticPassed) return;

        // RFC-1086: skip astro build if --fast, no cascade, and previous report shows it passed
        if (c.fast && !c.cascadeRerun && c.previousReport && c.previousReport.build.succeeded) {
          c.logger.info("  Skipping astro build (passed in previous run)");
          c.buildSucceeded = true;
          c.routeCount = c.previousReport.build.routeCount;
          c.sitemapHash = c.previousReport.build.sitemapHash;
          return;
        }
        c.cascadeRerun = true;

        // RFC-0615: clean stale dist/ before build to prevent false positives
        const distDir = path.join(c.workpieceDir, "dist");
        if (await c.io.exists(distDir)) {
          c.logger.info(`  Cleaning stale dist/ before build…`);
          await c.io.rm(distDir, { recursive: true });
        }

        c.preliminaryBuildIdentityPath = await writePreliminaryBuildIdentity(
          c.workpieceDir,
          {
            releaseId: `workpiece-${c.missionId}`,
            systemId: c.manifest.systemId,
            missionId: c.missionId,
            semver: "0.0.0-workpiece",
          },
          c.logger,
        );

        c.logger.info(`  Running astro build in ${c.workpieceDir}…`);
        try {
          const buildResult = await c.io.exec("pnpm", ["exec", "astro", "build"], {
            cwd: c.workpieceDir,
            timeoutMs: 300_000,
          });
          if (buildResult.exitCode !== 0) {
            throw new Error(
              buildResult.stderr.trim() || `astro build exited ${buildResult.exitCode}`,
            );
          }
          const buildOutput = buildResult.stdout;
          c.buildSucceeded = true;
          const routeMatches = buildOutput.match(/\d+ page\(s\)/g);
          if (routeMatches) {
            const nums = routeMatches.map((m) => parseInt(m, 10));
            c.routeCount = Math.max(...nums, 0);
          }
          const sitemapPath = path.join(c.workpieceDir, "dist", "sitemap-index.xml");
          if (await c.io.exists(sitemapPath)) {
            const { byteHashFile } = await import("@warpgogol/werkstatt-engine/fingerprint");
            c.sitemapHash = await byteHashFile(sitemapPath);
          } else {
            c.sitemapHash = "sha256:no-sitemap";
          }
        } catch (err) {
          c.buildError = err instanceof Error ? err.message : String(err);
          c.logger.info(`  Build failed: ${c.buildError}`);
        }

        // RFC-0615: check dirty state before build.post
        c.dirtyBeforeBuildPost = await isWorkpieceDirty(c.workpieceDir, c.io);
        if (c.dirtyBeforeBuildPost.dirty) {
          c.logger.info(
            `  [warn] workpiece has ${c.dirtyBeforeBuildPost.fileCount} uncommitted file(s) — snapshot auto-regeneration will be skipped`,
          );
        }
      },
      verify: async (c: ValidateStepCtx) => {
        // Step is done if static checks failed (skip path) or build was attempted
        return c.buildSucceeded || c.buildError !== undefined || !c.staticPassed;
      },
    },
    {
      name: "build-post",
      run: async (c: ValidateStepCtx) => {
        // RFC-1086: skip build.post if --fast, no cascade, and previous report shows build succeeded
        if (c.fast && !c.cascadeRerun && c.previousReport && c.previousReport.build.succeeded) {
          c.logger.info("  Skipping build.post (passed in previous run)");
          // Still need to write the validation report
          c.now = new Date().toISOString();
          const report = {
            schemaVersion: "1.0.0",
            missionId: c.missionId,
            contractFull: {
              passed: true,
              validators: c.previousReport.contractFull.validators,
            },
            build: {
              succeeded: true,
              routeCount: c.routeCount,
              sitemapHash: c.sitemapHash,
              failedSteps: [],
            },
            distributionReused: c.previousReport.distributionReused,
            buildInputHash: c.previousReport.buildInputHash,
            fullBuildRan: false,
            validatedAt: c.now,
          };
          await atomicWriteFile(
            path.join(c.evidenceDir, "validation-report.json"),
            JSON.stringify(report, null, 2) + "\n",
          );
          return;
        }
        // RFC-0356: run build.post after astro build — only when static checks passed
        if (c.staticPassed) {
          if (c.buildSucceeded) {
            // ADR-0096: ensure a committed behavior.snapshot.generated.yaml
            // exists before build.post — behavior.snapshot.validate diffs
            // against the committed baseline (SNAP-02) and would deadlock
            // first-time sites otherwise. Non-fatal: failure is logged and
            // build.post proceeds (SNAP-02's fixHint remains the fallback).
            await bootstrapCommittedSnapshot({
              workspaceRoot: c.workspaceRoot,
              systemId: c.manifest.systemId,
              missionId: c.missionId,
              logger: c.logger,
            });

            c.logger.info(`  Running build.post pipeline for ${c.manifest.systemId}…`);
            try {
              const postResult = await executeKernelPipeline({
                workspaceRoot: c.workspaceRoot,
                pipelineName: "build.post",
                siteName: c.manifest.systemId,
                outputFormat: "pretty",
                ...(c.siteWorkspace ? { siteWorkspace: c.siteWorkspace } : {}),
                ...(c.force ? { force: true } : {}),
                ...(c.collectErrors ? { collectErrors: true } : {}),
              });
              c.postPipelineReport = Array.isArray(postResult) ? postResult[0] : postResult;
              if (!c.postPipelineReport.ok) {
                c.buildError = `build.post failed at step: ${c.postPipelineReport.timing.failedStep ?? "unknown"}`;
                c.buildSucceeded = false;
                c.logger.info(`  ${c.buildError}`);
              }
            } catch (err) {
              c.buildError = err instanceof Error ? err.message : String(err);
              c.buildSucceeded = false;
              c.logger.info(`  build.post failed: ${c.buildError}`);
            }
          }

          // RFC-0615/RFC-0697: auto-regenerate behavior snapshot on SNAP-01
          if (
            c.postPipelineReport &&
            !c.postPipelineReport.ok &&
            !c.dirtyBeforeBuildPost.dirty &&
            !c.buildSucceeded
          ) {
            const snapshotStep = c.postPipelineReport.steps.find(
              (s) => s.commandName === "behavior.snapshot.validate",
            );

            const snapResult = await orchestrateSnap01Recovery({
              workspaceRoot: c.workspaceRoot,
              systemId: c.manifest.systemId,
              missionId: c.missionId,
              logger: c.logger,
              validateFn: async () => snapshotStep?.data,
              rebuildFn: async () => {
                c.logger.info(`  Re-running build.post after snapshot regeneration…`);
                const revalidateResult = await executeKernelPipeline({
                  workspaceRoot: c.workspaceRoot,
                  pipelineName: "build.post",
                  siteName: c.manifest.systemId,
                  outputFormat: "pretty",
                  ...(c.siteWorkspace ? { siteWorkspace: c.siteWorkspace } : {}),
                  ...(c.force ? { force: true } : {}),
                  ...(c.collectErrors ? { collectErrors: true } : {}),
                });
                const revalidateReport = Array.isArray(revalidateResult)
                  ? revalidateResult[0]
                  : revalidateResult;
                if (!revalidateReport.ok) {
                  throw new Error(
                    `build.post still failing after snapshot regeneration: ${revalidateReport.timing.failedStep ?? "unknown"}`,
                  );
                }
              },
            });

            if (snapResult.regenerated && snapResult.rebuildSucceeded) {
              c.buildSucceeded = true;
              c.buildError = undefined;
              c.logger.info(`  build.post passed after snapshot regeneration`);
            } else if (snapResult.regenerated && !snapResult.rebuildSucceeded) {
              c.buildError =
                snapResult.error ?? "build.post still failing after snapshot regeneration";
              c.logger.info(`  ${c.buildError}`);
            } else if (snapResult.error) {
              c.buildError = snapResult.error;
            }
          }
        }

        // Cleanup preliminary build identity
        if (c.preliminaryBuildIdentityPath) {
          await cleanupPreliminaryBuildIdentity(c.preliminaryBuildIdentityPath);
        }

        // Write validation report
        c.now = new Date().toISOString();
        const passed = c.staticPassed && c.buildSucceeded;
        const buildDiagnostics = c.buildError ? buildFailureDiagnostics(c.buildError) : [];
        const report = {
          schemaVersion: "1.0.0",
          missionId: c.missionId,
          contractFull: {
            passed,
            validators:
              c.pipelineReport?.steps.map((s) => ({
                name: s.commandName,
                status: s.ok ? "pass" : "fail",
                exitCode: s.exitCode,
              })) ?? [],
          },
          build: {
            succeeded: c.buildSucceeded,
            routeCount: c.routeCount,
            sitemapHash: c.sitemapHash,
            ...(c.buildError ? { error: c.buildError } : {}),
            failedSteps: c.failedSteps,
          },
          ...(buildDiagnostics.length > 0 ? { diagnostics: buildDiagnostics } : {}),
          distributionReused: false,
          buildInputHash: null,
          fullBuildRan: true,
          validatedAt: c.now,
        };
        await atomicWriteFile(
          path.join(c.evidenceDir, "validation-report.json"),
          JSON.stringify(report, null, 2) + "\n",
        );
      },
      verify: async (c: ValidateStepCtx) => {
        // Report is written — check file exists
        return c.io.exists(path.join(c.evidenceDir, "validation-report.json"));
      },
    },
  ];
}

export async function runMissionValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionValidateData>> {
  const { workspaceRoot, logger } = context;
  const missionId = flagString(input, "mission");
  if (!missionId) throw new Error("[mission.validate] --mission is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);
  // ADR-0085: closed missions remain auditable — mutating pipeline steps are
  // skipped by the executor (`.closed` sentinel), validators run read-only.
  if (manifest.state !== "open" && manifest.state !== "closed") {
    throw new Error(
      `[mission.validate] mission '${missionId}' is not open or closed (state: ${manifest.state})`,
    );
  }
  if (!manifest.materializedAt) {
    throw new Error(
      `[mission.validate] mission '${missionId}' has not been materialized — run mission.materialize first`,
    );
  }

  const missionDir = await resolveMissionDir(workspaceRoot, missionId, context.io);
  const workpieceDir = path.join(missionDir, "workpiece");
  const evidenceDir = path.join(missionDir, "evidence");
  const distributionDir = path.join(missionDir, "distribution");
  await context.io.mkdir(evidenceDir);

  // ADR-0085: for closed missions, registry.currentMission is null and site
  // discovery would resolve to the cache clone — point pipelines at the
  // workpiece under audit via a synthetic site (same pattern as
  // release.prepare).
  const closedSiteWorkspace: DiscoveredSiteWorkspace | undefined =
    manifest.state === "closed"
      ? {
          name: manifest.systemId,
          directory: workpieceDir,
          toolsDirectory: path.join(workpieceDir, "tools"),
          configPath: path.join(workpieceDir, "tools", "kernel.config.ts"),
        }
      : undefined;

  // RFC-1086: parse --fast flag — mutually exclusive with --force
  const fast = input.flags.fast === true;
  const force = input.flags.force === true;
  if (fast && force) {
    return {
      data: {
        missionId,
        contractFull: { passed: false, validators: [] },
        build: { succeeded: false, routeCount: 0, sitemapHash: "sha256:invalid" },
        distributionReused: false,
        buildInputHash: null,
        fullBuildRan: false,
        validatedAt: new Date().toISOString(),
      } as unknown as MissionValidateData,
      exitCode: 1,
      summary: "[mission.validate] --fast and --force are mutually exclusive",
    };
  }

  // RFC-1086: read previous validation-report.json BEFORE deletion (when --fast is set)
  let previousReport: PreviousValidationReport | null = null;
  let effectiveFast = fast;
  if (fast) {
    previousReport = await readPreviousValidationReport(evidenceDir);
    if (previousReport === null) {
      logger.warn("  No previous validation report found — running full validation.");
      effectiveFast = false;
    } else if (previousReport.missionId !== missionId) {
      logger.warn(
        "  Previous validation report is for a different mission — running full validation.",
      );
      effectiveFast = false;
      previousReport = null;
    } else if (isPreviousReportAllPassed(previousReport)) {
      // All phases passed — short-circuit, do NOT overwrite the existing report
      logger.info("  All phases passed in previous report — skipping validation.");
      const staleEntryWarnings = await validateNoStaleMissionEntries(workspaceRoot, context.io);
      if (staleEntryWarnings.length > 0) {
        for (const w of staleEntryWarnings) {
          logger.warn(`  [stale-entry] ${w.path}: ${w.message}`);
        }
      }
      await writeValidationState(workspaceRoot, {
        missionId,
        lastValidatedAt: previousReport.validatedAt,
        lastValidationStatus: "pass",
        validatorStates: [],
      });
      return {
        data: {
          ...previousReport,
          staleEntryWarnings,
        } as unknown as MissionValidateData,
        summary: `[mission.validate] ${missionId} validation passed (all phases passed in previous report — skipped)`,
      };
    }
  }

  // RFC-1020: Delete stale validation report from any previous run.
  // This prevents mission.reconcile from reading a failed report after a successful re-validate.
  // The report is always rewritten by the validate step (success or failure), so deleting it
  // upfront is safe — a fresh report will be written by the end of this run.
  // RFC-1086: guard deletion when --fast is active so the previous report can be read.
  const validationReportPath = path.join(evidenceDir, "validation-report.json");
  if (!effectiveFast) {
    await context.io.rm(validationReportPath).catch(() => {});
  }

  // RFC-0724: Auto-commit dirty bordbuch files on all paths (not just reuse).
  // This prevents dirty bordbuch projection files from blocking the pipeline.
  try {
    const bordbuchResult = await commitBordbuchProjections(workspaceRoot, manifest.systemId);
    if (bordbuchResult.committed) {
      logger.info(
        `  Bordbuch auto-commit: committed ${bordbuchResult.filesCommitted.length} file(s) before validate`,
      );
    }
  } catch (err) {
    logger.warn(
      `  Bordbuch auto-commit failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // RFC-0635: check if distribution can be reused by comparing build-input-hash.
  // If the hash matches and distribution/dist/ exists, skip the entire build cycle.
  // RFC-1086: --fast skips distribution reuse — it needs to run the pipeline phases.
  if (!force && !effectiveFast) {
    const distributionMetaPath = path.join(distributionDir, "build-input-hash.json");
    const distributionDistDir = path.join(distributionDir, "dist");
    if (
      (await context.io.exists(distributionMetaPath)) &&
      (await context.io.exists(distributionDistDir))
    ) {
      let canReuse = false;
      let storedHash: string | null = null;
      try {
        const meta = JSON.parse(await context.io.readFile(distributionMetaPath));
        storedHash = meta.buildInputHash ?? null;
      } catch {
        // Corrupt or unreadable — fall through to full build
      }
      if (storedHash) {
        try {
          const { buildInputHash: computedHash } = await computeBuildInputHash(
            workspaceRoot,
            workpieceDir,
          );
          if (storedHash === computedHash) {
            canReuse = true;
          }
        } catch {
          // Hash computation failed — fall through to full build
        }
      }
      if (canReuse && storedHash) {
        logger.info(`  Distribution reuse: build-input-hash matched — skipping build cycle`);
        // Copy distribution/dist/ to workpiece/dist/ if missing
        const workpieceDistDir = path.join(workpieceDir, "dist");
        if (!(await context.io.exists(workpieceDistDir))) {
          logger.info(`  Copying distribution/dist/ to workpiece/dist/…`);
          await copyDir(distributionDistDir, workpieceDistDir, context.io);
        }

        // Read build-manifest.json for routeCount and sitemapHash if available
        let reusedRouteCount = 0;
        let reusedSitemapHash = "sha256:reused";
        try {
          const buildManifestPath = path.join(distributionDir, "build-manifest.json");
          if (await context.io.exists(buildManifestPath)) {
            const manifestData = JSON.parse(await context.io.readFile(buildManifestPath));
            reusedRouteCount = manifestData.routeCount ?? 0;
            reusedSitemapHash = manifestData.sitemapHash ?? "sha256:reused";
          }
        } catch {
          // Manifest missing or corrupt — use defaults
        }

        const now = new Date().toISOString();
        const reusedReport = {
          schemaVersion: "1.0.0",
          missionId,
          contractFull: { passed: true, validators: [] },
          build: {
            succeeded: true,
            routeCount: reusedRouteCount,
            sitemapHash: reusedSitemapHash,
          },
          distributionReused: true,
          buildInputHash: storedHash,
          fullBuildRan: false,
          validatedAt: now,
        };
        await atomicWriteFile(
          path.join(evidenceDir, "validation-report.json"),
          JSON.stringify(reusedReport, null, 2) + "\n",
        );

        // RFC-0976: auto-commit generated artifacts after successful validation (reuse path).
        const dirtyCheck = await autoCommitAfterValidation(
          workpieceDir,
          missionId,
          input.flags["skip-auto-commit"] === true,
          logger,
          context.io,
        );

        // RFC-0724: bordbuch auto-commit is now done at the top of mission.validate (covers all paths).
        // The reuse path no longer needs its own cleanup call.

        const reuseNextSteps = buildValidateNextSteps(missionId, dirtyCheck);

        // RFC-0796: stale entry warnings (non-blocking)
        const staleEntryWarnings = await validateNoStaleMissionEntries(workspaceRoot, context.io);
        if (staleEntryWarnings.length > 0) {
          for (const w of staleEntryWarnings) {
            logger.warn(`  [stale-entry] ${w.path}: ${w.message}`);
          }
        }

        // RFC-1028: write .validation-state.json
        await writeValidationState(workspaceRoot, {
          missionId,
          lastValidatedAt: now,
          lastValidationStatus: "pass",
          validatorStates: [],
        });

        return {
          data: { ...reusedReport, staleEntryWarnings } as unknown as MissionValidateData,
          summary: `[mission.validate] ${missionId} validation passed (distribution reused, build-input-hash matched)`,
          nextSteps: reuseNextSteps,
        };
      }
    }
  }

  // RFC-0844: Operator config presence check — fail fast before expensive build.
  // Runs BEFORE Playwright pre-flight (existsSync <10ms vs browser launch ~100-500ms).
  // Skipped on distribution-reuse path (returns early above).
  try {
    const presenceResult = (await executeKernelCommand({
      workspaceRoot,
      commandName: "workpiece.config.presence.check",
      argv: [`--mission=${missionId}`],
      outputFormat: "pretty",
    })) as { exitCode?: number; data?: WorkpieceConfigPresenceResult };
    if ((presenceResult.exitCode ?? 0) !== 0) {
      const missing = presenceResult.data?.missing ?? [];
      const missingFiles = missing.map((m) => m.file).join(", ");
      logger.info(`  [preflight] Missing operator config files: ${missingFiles}`);
      for (const m of missing) {
        logger.info(`    Restore: ${m.restoreCommand}`);
      }
      const preflightReport = {
        schemaVersion: "1.0.0",
        missionId,
        contractFull: { passed: false, validators: [] },
        build: {
          succeeded: false,
          routeCount: 0,
          sitemapHash: "sha256:config-presence-failed",
          failedSteps: [{ name: "workpiece.config.presence.check", exitCode: 1 }],
        },
        distributionReused: false,
        buildInputHash: null,
        fullBuildRan: false,
        validatedAt: new Date().toISOString(),
      };
      await atomicWriteFile(
        path.join(evidenceDir, "validation-report.json"),
        JSON.stringify(preflightReport, null, 2) + "\n",
      );
      return {
        data: preflightReport as unknown as MissionValidateData,
        exitCode: 1,
        summary: `[mission.validate] ${missionId} pre-flight FAILED: missing operator config files (${missingFiles})`,
        nextSteps: [
          {
            action: `Restore missing files:\n${missing.map((m) => m.restoreCommand).join("\n")}\nThen re-run: pnpm exec werkstatt run mission.validate --mission ${missionId}`,
            kind: "required",
          },
        ],
      };
    }
    logger.info(`  Operator config files: all present`);
  } catch (err) {
    // Non-fatal: if the check itself throws unexpectedly, log and continue
    logger.warn(
      `  Operator config presence check error (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // RFC-0813: Playwright Chromium pre-flight check — fail fast before expensive
  // build.prepare + build.check + astro build + build.post cycle.
  // Skipped on distribution-reuse path (returns early above).
  try {
    const preflightResult = (await executeKernelCommand({
      workspaceRoot,
      commandName: "playwright.preflight.check",
      outputFormat: "pretty",
    })) as { exitCode?: number; summary?: string };
    if ((preflightResult.exitCode ?? 0) !== 0) {
      const msg = preflightResult.summary ?? "Playwright Chromium is not installed";
      logger.info(`  [preflight] ${msg}`);
      const preflightReport = {
        schemaVersion: "1.0.0",
        missionId,
        contractFull: { passed: false, validators: [] },
        build: {
          succeeded: false,
          routeCount: 0,
          sitemapHash: "sha256:preflight-failed",
          failedSteps: [{ name: "playwright.preflight.check", exitCode: 1 }],
        },
        distributionReused: false,
        buildInputHash: null,
        fullBuildRan: false,
        validatedAt: new Date().toISOString(),
      };
      await atomicWriteFile(
        path.join(evidenceDir, "validation-report.json"),
        JSON.stringify(preflightReport, null, 2) + "\n",
      );
      return {
        data: preflightReport as unknown as MissionValidateData,
        exitCode: 1,
        summary: `[mission.validate] ${missionId} pre-flight FAILED: Playwright Chromium is not installed`,
        nextSteps: [
          {
            action: `Run: pnpm exec playwright install chromium, then re-run: pnpm exec werkstatt run mission.validate --mission ${missionId}`,
            kind: "required",
          },
        ],
      };
    }
    logger.info(`  Playwright Chromium: pre-flight check passed`);
  } catch (err) {
    // Non-fatal: if the check itself throws unexpectedly, log and continue
    logger.warn(
      `  Playwright Chromium pre-flight check error (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // RFC-0958: Wrap the build cycle in runOperation for crash-safe resumable execution.
  // Pre-flight checks (distribution reuse, config presence, playwright) run outside the journal.
  // The build cycle (build.prepare → build.check → astro build → build.post → report write) runs as journaled steps.
  // Post-validation logic (dirty check, cache clone cleanup, stale entries, nextSteps) runs after runOperation.
  const collectErrors = input.flags["collect-errors"] === true;
  const skipContentRegression = input.flags["skip-content-regression"] === true;
  const autoAcceptRegression = input.flags["auto-accept-regression"] === true;

  const validateCtx: ValidateStepCtx = {
    workspaceRoot,
    missionId,
    manifest,
    logger,
    evidenceDir,
    missionDir,
    workpieceDir,
    ...(closedSiteWorkspace ? { siteWorkspace: closedSiteWorkspace } : {}),
    collectErrors,
    skipContentRegression,
    autoAcceptRegression,
    force,
    fast: effectiveFast,
    previousReport,
    cascadeRerun: false,
    prepareReport: null,
    pipelineReport: null,
    staticPassed: false,
    stepCount: 0,
    failedSteps: [],
    buildSucceeded: false,
    buildError: undefined,
    routeCount: 0,
    sitemapHash: "sha256:not-built",
    io: context.io,
    postPipelineReport: undefined,
    dirtyBeforeBuildPost: { dirty: false, fileCount: 0 },
    preliminaryBuildIdentityPath: null,
    now: new Date().toISOString(),
  };

  const journalPath = path.join(missionDir, "journal.jsonl");

  // RFC-0958 Step 7: block if a different-kind operation is incomplete
  const blockCheck = await checkDifferentKindOperation(journalPath, "mission.validate");
  if (blockCheck.blocked) {
    return {
      data: {
        missionId,
        contractFull: { passed: false, validators: [] },
        build: { succeeded: false, routeCount: 0, sitemapHash: "sha256:blocked" },
        distributionReused: false,
        buildInputHash: null,
        fullBuildRan: false,
        validatedAt: new Date().toISOString(),
        blockedByOperation: blockCheck.incompleteOp,
      } as unknown as MissionValidateData,
      exitCode: 1,
      summary: `[mission.validate] ${missionId} blocked: incomplete '${blockCheck.incompleteOp}' operation found in journal`,
      nextSteps: [
        {
          action: `Run: pnpm exec werkstatt run mission.resume --mission ${missionId} to resume or abandon the incomplete operation`,
          kind: "required",
        },
      ],
    };
  }

  // RFC-0973: --force auto-clears all caches and stale artifacts before pipeline execution.
  // Must happen AFTER checkDifferentKindOperation passes to preserve incomplete-operation detection.
  if (force) {
    logger.info("  Clearing all caches and stale artifacts (--force)…");
    // 1. Clear kernel cache DB (all namespaces)
    try {
      const cache = await createCacheLayer(workspaceRoot);
      try {
        await cache.clear();
      } finally {
        await cache.close();
      }
    } catch (err) {
      logger.warn(
        `  Kernel cache clear failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // 2. Clear pipeline cache hits
    try {
      await clearPipelineCacheHits(workspaceRoot);
    } catch (err) {
      logger.warn(
        `  Pipeline cache hits clear failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // 3. Delete stale journal (safe — checkDifferentKindOperation already passed)
    await context.io.rm(path.join(missionDir, "journal.jsonl")).catch(() => {});
    // 4. Delete stale validation report
    await context.io.rm(path.join(evidenceDir, "validation-report.json")).catch(() => {});
  }

  const opResult = await runOperation(
    journalPath,
    { op: "mission.validate", steps: buildValidateSteps(validateCtx) },
    validateCtx,
  );

  if (!opResult.completed) {
    const detail = opResult.failedStepError ?? "unknown error";
    const failedStep = opResult.failedStep;
    // build.prepare failure writes its own report before throwing
    if (failedStep === "build-prepare") {
      return {
        data: {
          schemaVersion: "1.0.0",
          missionId,
          contractFull: { passed: false, validators: [] },
          build: { succeeded: false, routeCount: 0, sitemapHash: "sha256:failed" },
          distributionReused: false,
          buildInputHash: null,
          fullBuildRan: true,
          validatedAt: new Date().toISOString(),
        } as unknown as MissionValidateData,
        exitCode: 1,
        summary: `[mission.validate] ${missionId} build.prepare FAILED: ${detail}`,
      };
    }
    throw new Error(
      `[mission.validate] step "${failedStep}" failed: ${detail} — run mission.resume --mission ${missionId} to retry`,
    );
  }

  // Read report from context state after runOperation
  const passed = validateCtx.staticPassed && validateCtx.buildSucceeded;
  const buildDiagnostics = validateCtx.buildError
    ? buildFailureDiagnostics(validateCtx.buildError)
    : [];
  const report = {
    schemaVersion: "1.0.0",
    missionId,
    contractFull: {
      passed,
      validators:
        validateCtx.pipelineReport?.steps.map((s) => ({
          name: s.commandName,
          status: s.ok ? "pass" : "fail",
          exitCode: s.exitCode,
        })) ?? [],
    },
    build: {
      succeeded: validateCtx.buildSucceeded,
      routeCount: validateCtx.routeCount,
      sitemapHash: validateCtx.sitemapHash,
      ...(validateCtx.buildError ? { error: validateCtx.buildError } : {}),
      failedSteps: validateCtx.failedSteps,
    },
    ...(buildDiagnostics.length > 0 ? { diagnostics: buildDiagnostics } : {}),
    distributionReused: false,
    buildInputHash: null,
    fullBuildRan: true,
    validatedAt: validateCtx.now,
  };

  if (!passed) {
    const reason = !validateCtx.staticPassed
      ? `${validateCtx.failedSteps.length}/${validateCtx.stepCount} steps failed`
      : "astro build failed";
    const failNextSteps: KernelNextStep[] = [
      {
        action: `Fix the failing validators above, then re-run: pnpm exec werkstatt run mission.validate --mission ${missionId}`,
        kind: "required",
      },
    ];
    // RFC-0763: clean bordbuch projections on validation failure path
    await cleanupBordbuchOnFailure(workspaceRoot, manifest.systemId, "validation failure", logger);
    // RFC-1028: write .validation-state.json
    await writeValidationState(workspaceRoot, {
      missionId,
      lastValidatedAt: validateCtx.now,
      lastValidationStatus: "fail",
      validatorStates: validateCtx.pipelineReport
        ? buildValidatorStatesFromSteps(validateCtx.pipelineReport.steps)
        : [],
    });
    return {
      data: report as unknown as MissionValidateData,
      exitCode: 1,
      summary: `[mission.validate] ${missionId} validation FAILED (${reason})`,
      nextSteps: failNextSteps,
    };
  }

  // RFC-1074: Persist distribution after successful full build so release.prepare can reuse it.
  // Shared with runMissionBuild via persistDistribution helper.
  try {
    await persistDistribution({
      workspaceRoot,
      workpieceDir,
      distributionDir,
      missionId,
      systemId: manifest.systemId,
      succeeded: true,
      routeCount: validateCtx.routeCount,
      sitemapHash: validateCtx.sitemapHash,
      builtAt: validateCtx.now,
      io: context.io,
    });
    logger.info(
      `  Distribution persisted to missions/${missionId}/distribution/ (reusable by release.prepare)`,
    );
  } catch (err) {
    logger.warn(
      `  Distribution persist failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // RFC-0976: auto-commit generated artifacts after successful validation.
  const dirtyCheck = await autoCommitAfterValidation(
    workpieceDir,
    missionId,
    input.flags["skip-auto-commit"] === true,
    logger,
    context.io,
  );

  // RFC-0797: post-validation cache clone cleanup — commit ALL generated files
  // (superset of bordbuch projections). This prevents the RFC-0522 dirty cache clone
  // warning from firing for any generated file and unblocks mission.reconcile.
  try {
    const postValidateCachePath = await resolveCacheClonePath(workspaceRoot, manifest.systemId);
    const postValidateCache = await commitCacheCloneIfDirty(
      postValidateCachePath,
      manifest.systemId,
      context.io,
    );
    if (postValidateCache.committed) {
      logger.info(
        `  Cache clone post-validate cleanup: committed generated file(s) (${postValidateCache.commitSha?.slice(0, 8)})`,
      );
    }
  } catch (err) {
    logger.warn(
      `  Cache clone post-validate cleanup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // RFC-0522: warn on dirty cache clone — reconcile will fail until resolved
  const systemDir = await resolveCacheClonePath(workspaceRoot, manifest.systemId);
  if (await context.io.exists(path.join(systemDir, ".git"))) {
    const cacheDirtyCheck = await isWorkpieceDirty(systemDir, context.io);
    if (cacheDirtyCheck.dirty) {
      logger.warn(
        `[mission.validate] cache clone for system '${manifest.systemId}' has ${cacheDirtyCheck.fileCount} uncommitted file(s) — reconcile will fail until resolved`,
      );
    }
  }

  // RFC-0796: stale entry warnings (non-blocking)
  const staleEntryWarnings = await validateNoStaleMissionEntries(workspaceRoot, context.io);
  if (staleEntryWarnings.length > 0) {
    for (const w of staleEntryWarnings) {
      logger.warn(`  [stale-entry] ${w.path}: ${w.message}`);
    }
  }

  // RFC-0579: populate nextSteps based on workpiece dirty state
  const passNextSteps = buildValidateNextSteps(missionId, dirtyCheck);

  // RFC-1028: write .validation-state.json
  await writeValidationState(workspaceRoot, {
    missionId,
    lastValidatedAt: validateCtx.now,
    lastValidationStatus: "pass",
    validatorStates: validateCtx.pipelineReport
      ? buildValidatorStatesFromSteps(validateCtx.pipelineReport.steps)
      : [],
  });

  return {
    data: { ...report, staleEntryWarnings } as unknown as MissionValidateData,
    summary: `[mission.validate] ${missionId} validation passed (${validateCtx.stepCount} steps, ${validateCtx.routeCount} routes built)`,
    nextSteps: passNextSteps,
  };
}

// §3: mission.preview — extracted to mission-preview.ts (RFC-0480)

// §4: mission.build
export interface MissionBuildData {
  missionId: string;
  distributionPath: string;
  buildSucceeded: boolean;
  builtAt: string;
}

export async function runMissionBuild(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionBuildData>> {
  const { workspaceRoot, logger } = context;
  const missionId = flagString(input, "mission");
  if (!missionId) throw new Error("[mission.build] --mission is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);
  if (manifest.state !== "open") {
    throw new Error(
      `[mission.build] mission '${missionId}' is not open (state: ${manifest.state})`,
    );
  }

  const missionDir = await resolveMissionDir(workspaceRoot, missionId, context.io);
  const workpieceDir = path.join(missionDir, "workpiece");
  const distributionDir = path.join(missionDir, "distribution");

  // RFC-0356 §4: run build.prepare → astro build → build.post unconditionally.
  // All three phases must succeed — without build.post the distribution is
  // unsigned (text.normalize.apply, passport.emit, etc. never run).
  let buildSucceeded = false;
  let buildError: string | undefined;

  // Phase 1: build.prepare (codegen, derived artifacts)
  logger.info(`  Running build.prepare pipeline for ${manifest.systemId}…`);
  try {
    await runPipelinePhase(workspaceRoot, "build.prepare", manifest.systemId);
  } catch (err) {
    buildError = err instanceof Error ? err.message : String(err);
    logger.info(`  build.prepare failed: ${buildError}`);
  }

  // Phase 1b: build.check (content validators) — RFC-0635
  // Ensures distributions have passed all content validators before being
  // reused by mission.validate. build-input-hash.json is only written when
  // all phases including build.check succeed.
  if (!buildError) {
    logger.info(`  Running build.check pipeline for ${manifest.systemId}…`);
    try {
      await runPipelinePhase(workspaceRoot, "build.check", manifest.systemId);
    } catch (err) {
      buildError = err instanceof Error ? err.message : String(err);
      logger.info(`  build.check failed: ${buildError}`);
    }
  }

  // Phase 2: astro build
  let buildRouteCount = 0;
  let buildSitemapHash = "sha256:no-sitemap";
  let preliminaryBuildIdentityPath: string | null = null;
  if (!buildError) {
    preliminaryBuildIdentityPath = await writePreliminaryBuildIdentity(
      workpieceDir,
      {
        releaseId: `workpiece-${missionId}`,
        systemId: manifest.systemId,
        missionId,
        semver: "0.0.0-workpiece",
      },
      logger,
    );
    logger.info(`  Running astro build in ${workpieceDir}…`);
    try {
      const buildResult = await context.io.exec("pnpm", ["exec", "astro", "build"], {
        cwd: workpieceDir,
        timeoutMs: 300_000,
      });
      if (buildResult.exitCode !== 0) {
        throw new Error(buildResult.stderr.trim() || `astro build exited ${buildResult.exitCode}`);
      }
      const buildOutput = buildResult.stdout;
      const routeMatches = buildOutput.match(/\d+ page\(s\)/g);
      if (routeMatches) {
        const nums = routeMatches.map((m) => parseInt(m, 10));
        buildRouteCount = Math.max(...nums, 0);
      }
      const sitemapPath = path.join(workpieceDir, "dist", "sitemap-index.xml");
      if (await context.io.exists(sitemapPath)) {
        const { byteHashFile } = await import("@warpgogol/werkstatt-engine/fingerprint");
        buildSitemapHash = await byteHashFile(sitemapPath);
      }
    } catch (err) {
      buildError = err instanceof Error ? err.message : String(err);
      logger.info(`  Astro build failed: ${buildError}`);
    }
  }

  // Phase 3: build.post (text.normalize.apply, passport.emit, etc.)
  if (!buildError) {
    logger.info(`  Running build.post pipeline for ${manifest.systemId}…`);
    try {
      await runPipelinePhase(workspaceRoot, "build.post", manifest.systemId);
    } catch (err) {
      buildError = err instanceof Error ? err.message : String(err);
      logger.info(`  build.post failed: ${buildError}`);
    }
  }

  buildSucceeded = !buildError;

  if (preliminaryBuildIdentityPath) {
    await cleanupPreliminaryBuildIdentity(preliminaryBuildIdentityPath);
  }
  // RFC-1074: Shared with runMissionValidate via persistDistribution helper.
  const now = new Date().toISOString();
  const distDest = path.join(distributionDir, "dist");
  await persistDistribution({
    workspaceRoot,
    workpieceDir,
    distributionDir,
    missionId,
    systemId: manifest.systemId,
    succeeded: buildSucceeded,
    routeCount: buildRouteCount,
    sitemapHash: buildSitemapHash,
    builtAt: now,
    io: context.io,
    error: buildError,
  });

  const evidenceDir = path.join(missionDir, "evidence");
  await context.io.mkdir(evidenceDir);
  const buildManifest = {
    builtAt: now,
    missionId,
    systemId: manifest.systemId,
    succeeded: buildSucceeded,
    routeCount: buildRouteCount,
    sitemapHash: buildSitemapHash,
    ...(buildError ? { error: buildError } : {}),
  };
  await atomicWriteFile(
    path.join(evidenceDir, "build-report.json"),
    JSON.stringify(buildManifest, null, 2) + "\n",
  );

  if (!buildSucceeded) {
    return {
      data: {
        missionId,
        distributionPath: distDest,
        buildSucceeded: false,
        builtAt: now,
      },
      exitCode: 1,
      summary: `[mission.build] ${missionId} build FAILED`,
      nextSteps: [
        {
          action: `Fix the build errors above, then re-run: pnpm exec werkstatt run mission.build --mission ${missionId}`,
          kind: "required",
        },
      ],
    };
  }

  return {
    data: { missionId, distributionPath: distDest, buildSucceeded: true, builtAt: now },
    summary: `[mission.build] ${missionId} distribution built`,
    nextSteps: [
      {
        action: `Validate the mission: pnpm exec werkstatt run mission.validate --mission ${missionId}`,
        kind: "optional",
      },
    ],
  };
}

// §5: mission.diff
export interface MissionDiffData {
  missionId: string;
  added: string[];
  modified: string[];
  removed: string[];
}

async function collectRelativeFiles(
  dir: string,
  base: string = dir,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string[]> {
  if (!(await io.exists(dir))) return [];
  const files = await collectFiles(dir, { ignore: (name) => name === ".git" });
  return files.map((filePath) => path.relative(base, filePath).replace(/\\/g, "/"));
}

export async function runMissionDiff(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionDiffData>> {
  const { workspaceRoot, logger } = context;
  const missionId = flagString(input, "mission");
  if (!missionId) throw new Error("[mission.diff] --mission is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);
  const systemDir = await resolveCacheClonePath(workspaceRoot, manifest.systemId);
  const workpieceDir = path.join(
    await resolveMissionDir(workspaceRoot, missionId, context.io),
    "workpiece",
  );

  const systemFiles = new Set(await collectRelativeFiles(systemDir, undefined, context.io));
  const workpieceFiles = new Set(await collectRelativeFiles(workpieceDir, undefined, context.io));

  const added = [...workpieceFiles].filter((f) => !systemFiles.has(f));
  const removed = [...systemFiles].filter((f) => !workpieceFiles.has(f));
  const modified: string[] = [];

  for (const f of workpieceFiles) {
    if (systemFiles.has(f)) {
      const sysContent = await context.io.readFile(path.join(systemDir, f)).catch(() => "");
      const wpContent = await context.io.readFile(path.join(workpieceDir, f)).catch(() => "");
      if (sysContent !== wpContent) modified.push(f);
    }
  }

  const missionDir = await resolveMissionDir(workspaceRoot, missionId, context.io);
  const evidenceDir = path.join(missionDir, "evidence");
  await context.io.mkdir(evidenceDir);
  const diffReport = {
    schemaVersion: "1.0.0",
    missionId,
    added,
    modified,
    removed,
  };
  await atomicWriteFile(
    path.join(evidenceDir, "authored-diff.json"),
    JSON.stringify(diffReport, null, 2) + "\n",
  );

  logger.info(`  Added: ${added.length}, Modified: ${modified.length}, Removed: ${removed.length}`);
  return {
    data: { missionId, added, modified, removed },
    summary: `[mission.diff] ${missionId}: ${added.length} added, ${modified.length} modified, ${removed.length} removed`,
    nextSteps: [
      {
        action: `Commit changes: pnpm exec werkstatt run mission.git.commit --mission ${missionId} --message "<msg>"`,
        kind: "optional",
      },
    ],
  };
}

// §6: mission.reconcile
export interface MissionReconcileData {
  missionId: string;
  systemId: string;
  commitSha: string | null;
  preReconcileSha: string | null;
  reconciledAt: string;
  mergedShas: string[];
  autoResolvedPaths?: string[];
  workpieceAutoCommitted: boolean;
  workpieceCommitSha: string | null;
  mirrorSync?: {
    attempted: boolean;
    succeeded: boolean;
    error: string | null;
  };
  // RFC-0918: post-push divergence diagnostic
  divergenceWarning?: {
    cacheCloneHead: string;
    originHead: string;
    diverged: boolean;
  } | null;
}

// RFC-0584: shared merge-abort helper — attempts git merge --abort, silently catches failure
async function abortMerge(systemDir: string, io: WorkspaceIO): Promise<void> {
  await execOrThrow(io, "git", ["merge", "--abort"], { cwd: systemDir }).catch(() => {});
}

export async function runMissionReconcile(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionReconcileData>> {
  const { workspaceRoot } = context;
  const missionId = flagString(input, "mission");
  const message = flagString(input, "message") ?? `Reconcile ${missionId}`;
  const actor = resolveActor(input);
  if (!missionId) throw new Error("[mission.reconcile] --mission is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);
  if (manifest.state !== "open") {
    throw new Error(
      `[mission.reconcile] mission '${missionId}' is not open (state: ${manifest.state})`,
    );
  }

  // Check validation has passed
  const evidenceDir = path.join(
    await resolveMissionDir(workspaceRoot, missionId, context.io),
    "evidence",
  );
  const validationPath = path.join(evidenceDir, "validation-report.json");
  if (!(await context.io.exists(validationPath))) {
    throw new Error(
      `[mission.reconcile] mission '${missionId}' has not passed validation — run mission.validate first`,
    );
  }

  await acquireLock(
    workspaceRoot,
    `system:${manifest.systemId}`,
    manifest.operationId,
    "mission.reconcile",
    actor,
  );
  await acquireLock(
    workspaceRoot,
    `mission:${missionId}`,
    manifest.operationId,
    "mission.reconcile",
    actor,
  );

  // RFC-0356 §6: verify validation passed before reconciling.
  const validationRaw = await context.io.readFile(validationPath).catch(() => null);
  if (!validationRaw) {
    throw new Error(
      `[mission.reconcile] mission '${missionId}' has not passed validation — run mission.validate first`,
    );
  }
  const validationReport = JSON.parse(validationRaw) as { contractFull?: { passed?: boolean } };
  if (!validationReport.contractFull?.passed) {
    throw new Error(
      `[mission.reconcile] mission '${missionId}' validation did not pass — fix issues and re-run mission.validate`,
    );
  }

  const workpieceDir = path.join(
    await resolveMissionDir(workspaceRoot, missionId, context.io),
    "workpiece",
  );
  const systemDir = await resolveCacheClonePath(workspaceRoot, manifest.systemId);

  try {
    const now = new Date().toISOString();
    const missionDir = await resolveMissionDir(workspaceRoot, missionId, context.io);

    const reconcileCtx: ReconcileStepCtx = {
      workspaceRoot,
      missionId,
      missionDir,
      workpieceDir,
      evidenceDir,
      systemDir,
      manifest,
      actor,
      message,
      now,
      context,
      commitSha: null,
      preReconcileSha: null,
      mergeCommitSha: null,
      transferredCommits: 0,
      mergedShas: [],
      copiedPaths: [],
      autoResolvedPaths: [],
      workpieceHeadAtReconcile: null,
      gitignoreRestored: false,
      forbiddenFilesUntracked: [],
      mirrorSync: { attempted: false, succeeded: false, error: null },
      divergenceWarning: null,
      workpieceCommit: { committed: false, commitSha: null },
    };

    const steps = await buildReconcileSteps(workspaceRoot, missionId, reconcileCtx);
    const journalPath = path.join(missionDir, "journal.jsonl");

    // RFC-0958 Step 7: block if a different-kind operation is incomplete
    const blockCheck = await checkDifferentKindOperation(journalPath, "mission.reconcile");
    if (blockCheck.blocked) {
      return {
        data: {
          missionId,
          systemId: manifest.systemId,
          commitSha: null,
          blockedByOperation: blockCheck.incompleteOp,
        } as unknown as MissionReconcileData,
        exitCode: 1,
        summary: `[mission.reconcile] ${missionId} blocked: incomplete '${blockCheck.incompleteOp}' operation found in journal`,
        nextSteps: [
          {
            action: `Run: pnpm exec werkstatt run mission.resume --mission ${missionId} to resume or abandon the incomplete operation`,
            kind: "required",
          },
        ],
      };
    }

    const def: OperationDefinition<unknown> = { op: "mission.reconcile", steps };
    const opResult = await runOperation(journalPath, def, reconcileCtx, {
      missionId,
      platformVersion: "",
    });

    if (!opResult.completed) {
      const detail = opResult.failedStepError ?? "unknown error";
      throw new Error(
        `[mission.reconcile] step "${opResult.failedStep}" failed: ${detail} — run mission.resume --mission ${missionId} to retry`,
      );
    }

    const cc = reconcileCtx;
    const autoResolveSuffix =
      cc.autoResolvedPaths.length > 0
        ? `, ${cc.autoResolvedPaths.length} conflict${cc.autoResolvedPaths.length > 1 ? "s" : ""} auto-resolved`
        : "";

    const mirrorSyncSuffix = cc.mirrorSync.attempted
      ? cc.mirrorSync.succeeded
        ? ", mirrors synced"
        : ", mirror sync failed — non-fatal"
      : "";

    return {
      data: {
        missionId,
        systemId: manifest.systemId,
        commitSha: cc.commitSha,
        preReconcileSha: cc.preReconcileSha,
        mergedShas: cc.mergedShas,
        reconciledAt: now,
        ...(cc.autoResolvedPaths.length > 0 ? { autoResolvedPaths: cc.autoResolvedPaths } : {}),
        workpieceAutoCommitted: cc.workpieceCommit.committed,
        workpieceCommitSha: cc.workpieceCommit.commitSha,
        ...(cc.mirrorSync.attempted ? { mirrorSync: cc.mirrorSync } : {}),
        divergenceWarning: cc.divergenceWarning,
      },
      summary: `[mission.reconcile] ${missionId} reconciled (${cc.commitSha ? `${cc.commitSha.slice(0, 8)}, ${cc.transferredCommits} commits merged` : "no git"}${autoResolveSuffix}${cc.workpieceCommit.committed ? `, workpiece auto-committed ${cc.workpieceCommit.commitSha?.slice(0, 8)}` : ""}${mirrorSyncSuffix})`,
      nextSteps: [
        {
          action: `Close the mission: pnpm exec werkstatt run mission.close --mission ${missionId}`,
          kind: "optional",
        },
      ],
    };
  } finally {
    await releaseLock(workspaceRoot, `mission:${missionId}`);
    await releaseLock(workspaceRoot, `system:${manifest.systemId}`);
  }
}

// ---------------------------------------------------------------------------
// RFC-0958: Journal-integrated reconcile steps
// ---------------------------------------------------------------------------

export interface ReconcileStepCtx {
  workspaceRoot: string;
  missionId: string;
  missionDir: string;
  workpieceDir: string;
  evidenceDir: string;
  systemDir: string;
  manifest: MissionManifest;
  actor: ReturnType<typeof resolveActor>;
  message: string;
  now: string;
  context: KernelRuntimeContext;
  commitSha: string | null;
  preReconcileSha: string | null;
  mergeCommitSha: string | null;
  transferredCommits: number;
  mergedShas: string[];
  copiedPaths: string[];
  autoResolvedPaths: string[];
  workpieceHeadAtReconcile: string | null;
  gitignoreRestored: boolean;
  forbiddenFilesUntracked: string[];
  mirrorSync: { attempted: boolean; succeeded: boolean; error: string | null };
  divergenceWarning: { cacheCloneHead: string; originHead: string; diverged: boolean } | null;
  workpieceCommit: { committed: boolean; commitSha: string | null };
}

export async function buildReconcileSteps(
  _workspaceRoot: string,
  _missionId: string,
  _ctx: unknown,
): Promise<OperationStep<unknown>[]> {
  const steps: OperationStep<unknown>[] = [
    {
      name: "workpiece-git-check",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        if (!(await cc.context.io.exists(path.join(cc.workpieceDir, ".git")))) {
          throw new Error(
            `[mission.reconcile] workpiece is not a git repository — run mission.materialize first`,
          );
        }
      },
    },
    {
      name: "auto-commit-workpiece",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const result = await commitWorkpieceIfDirty(
          cc.workpieceDir,
          cc.missionId,
          undefined,
          cc.context.io,
        );
        cc.workpieceCommit = result;
        if (result.committed) {
          cc.context.logger.info(
            `  Auto-committed dirty workpiece (${result.commitSha?.slice(0, 8)}) before reconcile`,
          );
        }
      },
    },
    {
      name: "auto-commit-cache-clone",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!(await cc.context.io.exists(gitDir))) return;
        const cacheCommit = await commitCacheCloneIfDirty(
          cc.systemDir,
          cc.manifest.systemId,
          cc.context.io,
        );
        if (cacheCommit.committed) {
          cc.context.logger.info(
            `  Auto-committed cache clone (${cacheCommit.commitSha?.slice(0, 8)}) before reconcile`,
          );
        }
      },
    },
    {
      name: "dirty-cache-clone-guard",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!(await cc.context.io.exists(gitDir))) return;
        const cacheDirtyCheck = await isWorkpieceDirty(cc.systemDir, cc.context.io);
        if (cacheDirtyCheck.dirty) {
          const untrackedReport = await investigateUntrackedFiles(
            cc.workspaceRoot,
            cc.manifest.systemId,
            cc.systemDir,
            cacheDirtyCheck.files,
          );
          await atomicWriteFile(
            path.join(cc.evidenceDir, "untracked-files-report.json"),
            JSON.stringify(untrackedReport, null, 2) + "\n",
          );
          const reportSummary = untrackedReport
            .map(
              (r) => `  ${r.path} — ${r.likelyOrigin}${r.originHint ? ` (${r.originHint})` : ""}`,
            )
            .join("\n");
          throw new Error(
            `[mission.reconcile] cache clone for system '${cc.manifest.systemId}' has ${cacheDirtyCheck.fileCount} uncommitted/untracked file(s):\n` +
              reportSummary +
              `\n\nEvidence written to evidence/untracked-files-report.json.\nResolve uncommitted changes in the cache clone before re-running reconcile.`,
          );
        }
      },
    },
    {
      name: "record-pre-reconcile-sha",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!(await cc.context.io.exists(gitDir))) return;
        try {
          cc.preReconcileSha = (
            await shExec("git rev-parse HEAD", cc.systemDir, cc.context.io)
          ).trim();
        } catch {
          cc.preReconcileSha = null;
        }
        const prevReportPath = path.join(cc.evidenceDir, "reconciliation-report.json");
        if (await cc.context.io.exists(prevReportPath)) {
          let prevReport: { preReconcileSha?: string };
          try {
            prevReport = JSON.parse(await cc.context.io.readFile(prevReportPath)) as {
              preReconcileSha?: string;
            };
          } catch {
            // Unparseable report — continue
            prevReport = {};
          }
          if (prevReport.preReconcileSha) {
            let rewound = false;
            try {
              await shExec(
                `git reset --hard ${prevReport.preReconcileSha}`,
                cc.systemDir,
                cc.context.io,
              );
              cc.context.logger.info(
                `  Reset cache clone to pre-reconcile SHA ${prevReport.preReconcileSha.slice(0, 12)}`,
              );
              rewound = true;
            } catch {
              // Previous SHA may not exist — continue with current HEAD
            }
            // RFC-1219: the rewind deletes every file tracked at the
            // pre-reset HEAD but absent at the reset target — including
            // operation journals committed mid-run by
            // auto-commit-cache-clone (observed: ship journal wiped →
            // orphan step-failed → "nothing to resume"). Restore
            // operations/ from the pre-reset HEAD and re-commit so the
            // merge sees tracked-clean state. Journals are append-only;
            // restoration is always safe. A failure here is blocking —
            // continuing silently would lose journal state.
            if (rewound && cc.preReconcileSha) {
              // Probe failure is blocking too — "can't inspect the tree" must
              // not silently degrade to "nothing to restore" (that path is
              // exactly how the journal was lost in m000192).
              const opsInTree = await shExec(
                `git ls-tree --name-only ${cc.preReconcileSha} -- operations/`,
                cc.systemDir,
                cc.context.io,
              );
              if (opsInTree.trim().length > 0) {
                await shExec(
                  `git checkout ${cc.preReconcileSha} -- operations/`,
                  cc.systemDir,
                  cc.context.io,
                );
                const opsStaged = await shExec(
                  "git status --porcelain -- operations/",
                  cc.systemDir,
                  cc.context.io,
                );
                if (opsStaged.trim().length > 0) {
                  await cacheCloneCommit(
                    cc.systemDir,
                    "cache-clone: preserve operations journals across reconcile rewind",
                    {},
                    cc.context.io,
                  );
                  cc.context.logger.info(
                    "  Preserved operations/ journals across pre-reconcile rewind",
                  );
                }
              }
            }
          }
        }
      },
    },
    {
      name: "fetch-and-merge",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!(await cc.context.io.exists(gitDir))) {
          for (const dataPath of STERNSYSTEM_DATA_PATHS) {
            const src = path.join(cc.workpieceDir, dataPath);
            const dest = path.join(cc.systemDir, dataPath);
            if (await cc.context.io.exists(src)) {
              if (await cc.context.io.exists(dest)) {
                await cc.context.io.rm(dest, { recursive: true });
              }
              await copyDir(src, dest, cc.context.io);
              cc.copiedPaths.push(dataPath);
              cc.context.logger.info(`  Reconciled ${dataPath}`);
            }
          }
          return;
        }
        const workpieceBranch = (
          await shExec("git rev-parse --abbrev-ref HEAD", cc.workpieceDir, cc.context.io)
        ).trim();
        await shExec(
          `git fetch ${JSON.stringify(cc.workpieceDir)} ${JSON.stringify(workpieceBranch)}`,
          cc.systemDir,
          cc.context.io,
        );
        const mergeMessage = `reconcile mission ${cc.missionId}`;
        try {
          await shExec(
            `git merge --no-ff FETCH_HEAD -m ${JSON.stringify(mergeMessage)}`,
            cc.systemDir,
            cc.context.io,
          );
        } catch (err) {
          const isAutoResolvablePath = (p: string) =>
            CACHE_CLONE_ONLY_PATHS.some((pattern) => p.startsWith(pattern));
          // RFC-1218: generated-path allowlist — the RFC-0960 ownership
          // registry (generates[] declarations) unioned with the RFC-0913
          // cache-clone patterns. ownershipMap absent (site plugin not
          // loaded) degenerates to the RFC-0913 set alone.
          const generatedPatterns = [
            ...(cc.context.ownershipMap ?? []).map((e) => e.artifact.path),
            ...CACHE_CLONE_GENERATED_PATTERNS,
          ];
          const isGeneratedPath = (p: string) =>
            generatedPatterns.some((pattern) => p === pattern || picomatch.isMatch(p, pattern));
          const conflictedPaths: string[] = [];
          const bordbuchDeletedPaths: string[] = [];
          try {
            const statusOutput = await shExec(
              "git status --porcelain",
              cc.systemDir,
              cc.context.io,
            );
            for (const line of statusOutput.split("\n")) {
              if (!line) continue;
              const status = line.slice(0, 2);
              const filePath = line.slice(3).trim();
              if (!filePath) continue;
              if (
                status.startsWith("DU") ||
                status.startsWith("UD") ||
                status.startsWith("AA") ||
                status.startsWith("UU")
              ) {
                conflictedPaths.push(filePath);
              } else if (status === "D ") {
                if (isAutoResolvablePath(filePath)) bordbuchDeletedPaths.push(filePath);
              }
            }
          } catch {
            // git status failed
          }
          // RFC-1218: three classes — clone-only paths resolve ours, generated
          // allowlist paths resolve theirs (workpiece), anything else aborts.
          const oursPaths = conflictedPaths.filter(isAutoResolvablePath);
          const theirsPaths = conflictedPaths.filter(
            (p) => !isAutoResolvablePath(p) && isGeneratedPath(p),
          );
          const unclassifiedPaths = conflictedPaths.filter(
            (p) => !isAutoResolvablePath(p) && !isGeneratedPath(p),
          );
          const allAutoResolvable = conflictedPaths.length > 0 && unclassifiedPaths.length === 0;
          if (allAutoResolvable) {
            try {
              if (bordbuchDeletedPaths.length > 0) {
                const delPathArgs = bordbuchDeletedPaths.map((p) => JSON.stringify(p)).join(" ");
                await shExec(`git checkout HEAD -- ${delPathArgs}`, cc.systemDir, cc.context.io);
                await shExec(`git add -- ${delPathArgs}`, cc.systemDir, cc.context.io);
              }
              if (oursPaths.length > 0) {
                const oursArgs = oursPaths.map((p) => JSON.stringify(p)).join(" ");
                await shExec(`git checkout HEAD -- ${oursArgs}`, cc.systemDir, cc.context.io);
                await shExec(`git add -- ${oursArgs}`, cc.systemDir, cc.context.io);
              }
              for (const theirsPath of theirsPaths) {
                const quoted = JSON.stringify(theirsPath);
                // Workpiece-side presence decides checkout-vs-remove: UD means
                // the workpiece deleted the file, so theirs-wins = git rm.
                const inTheirs = (
                  await shExec(`git ls-tree FETCH_HEAD -- ${quoted}`, cc.systemDir, cc.context.io)
                ).trim();
                if (inTheirs.length > 0) {
                  await shExec(`git checkout FETCH_HEAD -- ${quoted}`, cc.systemDir, cc.context.io);
                } else {
                  await shExec(
                    `git rm -f --ignore-unmatch -- ${quoted}`,
                    cc.systemDir,
                    cc.context.io,
                  );
                }
              }
              const sortedResolved = [...conflictedPaths].sort();
              const resolveMessage =
                `${mergeMessage}\n\nAuto-resolved conflicts:\n` +
                sortedResolved.map((p) => `- ${p}`).join("\n");
              await cacheCloneCommit(cc.systemDir, resolveMessage, {}, cc.context.io);
              cc.autoResolvedPaths = sortedResolved;
              cc.context.logger.info(
                `  Auto-resolved ${cc.autoResolvedPaths.length} conflict(s) ` +
                  `(${oursPaths.length} clone-only, ${theirsPaths.length} generated)`,
              );
            } catch (resolveErr) {
              await abortMerge(cc.systemDir, cc.context.io);
              throw new Error(
                `[mission.reconcile] conflict auto-resolution failed: ${(resolveErr as Error).message}.\n` +
                  `Merge has been aborted. Inspect the cache clone state manually.\n` +
                  `Reconcile is idempotent — it will reset the cache clone to preReconcileSha and re-merge.`,
              );
            }
          } else {
            await abortMerge(cc.systemDir, cc.context.io);
            const unclassifiedNote =
              unclassifiedPaths.length > 0
                ? `\nUnclassified conflicted paths:\n` +
                  unclassifiedPaths.map((p) => `  - ${p}`).join("\n")
                : "";
            throw new Error(
              `[mission.reconcile] git merge --no-ff failed: ${(err as Error).message}.${unclassifiedNote}\n` +
                `Resolve conflicts in the workpiece (not the cache clone), commit via mission.git.commit, then re-run reconcile.\n` +
                `Reconcile is idempotent — it will reset the cache clone to preReconcileSha and re-merge.`,
            );
          }
        }
      },
    },
    {
      name: "capture-workpiece-head",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!(await cc.context.io.exists(gitDir))) return;
        try {
          cc.workpieceHeadAtReconcile = (
            await shExec("git rev-parse HEAD", cc.workpieceDir, cc.context.io)
          ).trim();
        } catch {
          cc.workpieceHeadAtReconcile = null;
        }
        cc.commitSha = (await shExec("git rev-parse HEAD", cc.systemDir, cc.context.io)).trim();
      },
    },
    {
      name: "post-merge-guard",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!(await cc.context.io.exists(gitDir))) return;
        const criticalFiles = ["system-config.yaml", "system-state.yaml"];
        const restoredFiles: string[] = [];
        for (const cf of criticalFiles) {
          if (!(await cc.context.io.exists(path.join(cc.systemDir, cf))) && cc.preReconcileSha) {
            try {
              await shExec(
                `git checkout ${cc.preReconcileSha} -- ${JSON.stringify(cf)}`,
                cc.systemDir,
                cc.context.io,
              );
              restoredFiles.push(cf);
              cc.context.logger.info(`  Restored ${cf} after merge (was missing)`);
            } catch {
              // File may not exist in preReconcileSha either — skip
            }
          }
        }
        if (restoredFiles.length > 0) {
          const addArgs = restoredFiles.map((f) => JSON.stringify(f)).join(" ");
          await shExec(`git add -- ${addArgs}`, cc.systemDir, cc.context.io);
          await cacheCloneCommit(
            cc.systemDir,
            "restore critical config files after merge",
            undefined,
            cc.context.io,
          );
        }
      },
    },
    {
      name: "gitignore-restoration",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!(await cc.context.io.exists(gitDir))) return;
        try {
          cc.gitignoreRestored = await restoreCacheCloneGitignore(cc.systemDir, cc.context.io);
          if (cc.gitignoreRestored) {
            cc.context.logger.info(`  Restored cache-clone-only .gitignore patterns after merge`);
            await shExec("git add .gitignore", cc.systemDir, cc.context.io);
          }
          cc.forbiddenFilesUntracked = await untrackForbiddenGeneratedFiles(
            cc.systemDir,
            cc.context.io,
          );
          if (cc.forbiddenFilesUntracked.length > 0) {
            cc.context.logger.info(
              `  Untracked ${cc.forbiddenFilesUntracked.length} forbidden/generated file(s)`,
            );
          }
          if (cc.gitignoreRestored || cc.forbiddenFilesUntracked.length > 0) {
            await cacheCloneCommit(
              cc.systemDir,
              "restore cache-clone .gitignore and untrack forbidden files (RFC-0913)",
              undefined,
              cc.context.io,
            );
          }
        } catch (restoreErr) {
          cc.context.logger.warn(
            `  .gitignore restoration failed (non-fatal): ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}`,
          );
        }
      },
    },
    {
      name: "count-transferred-commits",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!(await cc.context.io.exists(gitDir))) return;
        // RFC-1221: derive the folded set from the merge commit's own parents
        // — rev-list <commitSha>^2 --not <commitSha>^1 needs no recorded ctx
        // state, so the computation survives journal resume (a completed
        // record-pre-reconcile-sha is skipped, leaving cc.preReconcileSha
        // null) and the fold path where no new merge was needed alike.
        if (cc.commitSha) {
          try {
            const secondParent = (
              await shExec(
                `git rev-parse --verify -q ${cc.commitSha}^2 || true`,
                cc.systemDir,
                cc.context.io,
              )
            ).trim();
            if (secondParent.length > 0) {
              // commitSha IS the merge commit — record it under its own name.
              // The previous `HEAD^1` capture ran after post-merge steps could
              // already have committed, storing a post-merge parent instead.
              cc.mergeCommitSha = cc.commitSha;
              const firstParent = (
                await shExec(`git rev-parse ${cc.commitSha}^1`, cc.systemDir, cc.context.io)
              ).trim();
              // The merge's first parent IS the head the merge started from —
              // the truthful preReconcileSha whenever the recorded value was
              // lost (resume) or degenerate (self-range on the fold path).
              if (!cc.preReconcileSha || cc.preReconcileSha === cc.commitSha) {
                cc.preReconcileSha = firstParent;
              }
              const shaListOutput = (
                await shExec(
                  `git rev-list ${cc.commitSha}^2 --not ${cc.commitSha}^1`,
                  cc.systemDir,
                  cc.context.io,
                )
              ).trim();
              const candidates = shaListOutput
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l.length > 0);
              // Restrict to SHAs present in the workpiece repo — the folded
              // ancestry can legitimately contain cache-clone bookkeeping
              // (workpiece origin is the cache clone); those pass the
              // subject whitelist anyway, so over-tracing is safe while
              // under-tracing is not. On any workpiece-repo failure record
              // the unfiltered set.
              let workpieceUsable = true;
              try {
                await shExec("git rev-parse --git-dir", cc.workpieceDir, cc.context.io);
              } catch {
                workpieceUsable = false;
              }
              if (!workpieceUsable) {
                cc.mergedShas = candidates;
              } else {
                const kept: string[] = [];
                for (const sha of candidates) {
                  try {
                    await shExec(`git cat-file -e ${sha}`, cc.workpieceDir, cc.context.io);
                    kept.push(sha);
                  } catch {
                    // Absent from the workpiece — cache-clone-side commit, skip.
                  }
                }
                cc.mergedShas = kept;
              }
              cc.transferredCommits = cc.mergedShas.length;
            } else {
              // Non-merge commitSha — no-op fold: nothing was folded.
              cc.mergedShas = [];
              cc.transferredCommits = 0;
            }
          } catch (foldErr) {
            cc.context.logger.warn(
              `[mission.reconcile] folded-SHA computation failed (non-fatal): ${foldErr instanceof Error ? foldErr.message : String(foldErr)}`,
            );
            cc.transferredCommits = 0;
            cc.mergedShas = [];
          }
        }
        cc.context.logger.info(
          `  Merged ${cc.transferredCommits} commit(s) from workpiece to cache clone (${cc.commitSha?.slice(0, 8)})`,
        );
        if (cc.transferredCommits === 0) {
          cc.context.logger.warn(
            `[mission.reconcile] WARNING: Zero commits transferred from workpiece to cache clone.\n` +
              `  Brief: "${cc.manifest.brief}"\n` +
              `  If you expected changes, the workpiece may have no operator commits — check mission.git.commit output.\n`,
          );
        }
      },
    },
    {
      // ADR-0093: record the reconcile trace — commitSha is the merge/head
      // commit, mergedShas[] lists every workpiece commit folded into the
      // cache clone. The external-edit guard treats all of them as traced.
      name: "bordbuch-append",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        await appendAndCommitBordbuch(
          cc.workspaceRoot,
          cc.manifest.systemId,
          "mission-reconcile",
          `Mission ${cc.missionId} reconciled`,
          cc.actor,
          {
            missionId: cc.missionId,
            writerRole: "mission",
            metadata: {
              commitSha: cc.commitSha,
              preReconcileSha: cc.preReconcileSha,
              // RFC-1221: omit the field when nothing was folded — an absent
              // mergedShas is the precise "no folded commits" signal.
              ...(cc.mergedShas.length > 0 ? { mergedShas: cc.mergedShas } : {}),
              transferredCommits: cc.transferredCommits,
              // RFC-1218: audit trail for auto-resolved merge conflicts.
              ...(cc.autoResolvedPaths.length > 0
                ? { autoResolvedPaths: cc.autoResolvedPaths }
                : {}),
            },
          },
          `Bordbuch: mission-reconcile ${cc.missionId}`,
        );
      },
    },
    {
      name: "push-to-origin",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!(await cc.context.io.exists(gitDir))) return;
        const branch = (
          await shExec("git rev-parse --abbrev-ref HEAD", cc.systemDir, cc.context.io)
        ).trim();
        const pushBackoffMs = [1000, 2000, 4000];
        let pushSucceeded = false;
        for (let attempt = 0; attempt < pushBackoffMs.length; attempt++) {
          try {
            await shExec(`git push origin ${JSON.stringify(branch)}`, cc.systemDir, cc.context.io);
            pushSucceeded = true;
            break;
          } catch {
            if (attempt < pushBackoffMs.length - 1) {
              cc.context.logger.info(`  Push attempt ${attempt + 1} failed — retrying…`);
              await new Promise((resolve) => setTimeout(resolve, pushBackoffMs[attempt]));
            }
          }
        }
        if (!pushSucceeded) {
          cc.context.logger.info(
            `  Push failed after ${pushBackoffMs.length} attempts (non-fatal)`,
          );
        }
      },
    },
    {
      name: "divergence-check",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!(await cc.context.io.exists(gitDir))) return;
        try {
          const cacheCloneHead = (
            await shExec("git rev-parse HEAD", cc.systemDir, cc.context.io)
          ).trim();
          const originHead = (
            await shExec("git rev-parse origin/main", cc.systemDir, cc.context.io)
          ).trim();
          if (cacheCloneHead !== originHead) {
            cc.divergenceWarning = { cacheCloneHead, originHead, diverged: true };
            cc.context.logger.warn(
              `[mission.reconcile] WARNING: Cache clone HEAD (${cacheCloneHead.slice(0, 8)}) diverged from origin/main (${originHead.slice(0, 8)}).\n` +
                `  Run \`git reset --hard origin/main\` in the cache clone to resolve.`,
            );
          }
        } catch {
          // Non-fatal — origin/main may not exist yet
        }
      },
    },
    {
      name: "mirror-sync",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!(await cc.context.io.exists(gitDir))) return;
        try {
          const config = await readSystemConfig(cc.workspaceRoot, cc.manifest.systemId);
          if (config && config.mirrors.length > 2) {
            cc.mirrorSync.attempted = true;
            cc.context.logger.info(`  Syncing external mirrors via sternsystem.sync…`);
            try {
              const syncResult = (await executeKernelCommand({
                workspaceRoot: cc.workspaceRoot,
                commandName: "sternsystem.sync",
                argv: [`--id=${cc.manifest.systemId}`],
              })) as { exitCode?: number; summary?: string };
              const syncExitCode = syncResult.exitCode ?? 0;
              if (syncExitCode !== 0) {
                cc.mirrorSync.succeeded = false;
                cc.mirrorSync.error =
                  syncResult.summary ?? `sternsystem.sync exited with code ${syncExitCode}`;
                cc.context.logger.warn(
                  `  External mirror sync failed (non-fatal): ${cc.mirrorSync.error}`,
                );
              } else {
                cc.mirrorSync.succeeded = true;
                cc.context.logger.info(`  External mirrors synced`);
              }
            } catch (syncError) {
              cc.mirrorSync.succeeded = false;
              cc.mirrorSync.error =
                syncError instanceof Error ? syncError.message : String(syncError);
              cc.context.logger.warn(
                `  External mirror sync failed (non-fatal): ${cc.mirrorSync.error}`,
              );
            }
          }
        } catch (registryError) {
          cc.context.logger.warn(
            `  Could not read registry for mirror sync: ${registryError instanceof Error ? registryError.message : String(registryError)}`,
          );
        }
      },
    },
    {
      name: "write-reconciliation-report",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const report = {
          schemaVersion: "1.0.0",
          missionId: cc.missionId,
          systemId: cc.manifest.systemId,
          commitSha: cc.commitSha,
          preReconcileSha: cc.preReconcileSha,
          reconciledAt: cc.now,
          mergeCommitSha: cc.mergeCommitSha,
          transferredCommits: cc.transferredCommits,
          // Unlike the bordbuch entry (which omits the field when empty —
          // absence is the "no folded commits" signal, RFC-1221), the report
          // is a flat diagnostic shape and always records the array.
          mergedShas: cc.mergedShas,
          zeroTransferWarning: cc.transferredCommits === 0,
          message: cc.message,
          copiedPaths: cc.copiedPaths,
          autoResolvedPaths: cc.autoResolvedPaths,
          workpieceHeadAtReconcile: cc.workpieceHeadAtReconcile,
          gitignoreRestored: cc.gitignoreRestored,
          forbiddenFilesUntracked: cc.forbiddenFilesUntracked,
          mirrorSync: cc.mirrorSync.attempted ? cc.mirrorSync : undefined,
          divergenceWarning: cc.divergenceWarning,
        };
        await atomicWriteFile(
          path.join(cc.evidenceDir, "reconciliation-report.json"),
          JSON.stringify(report, null, 2) + "\n",
        );
      },
    },
    {
      name: "update-manifest",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        cc.manifest.reconciledAt = cc.now;
        await writeMissionManifest(cc.workspaceRoot, cc.manifest);
      },
    },
    {
      name: "commit-werkstatt-side-effects",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        await commitWerkstattSideEffects(
          cc.workspaceRoot,
          [path.join("missions", cc.missionId, "mission.yaml")],
          `werkstatt: mission.reconcile ${cc.missionId}`,
        );
      },
    },
  ];
  return steps;
}
