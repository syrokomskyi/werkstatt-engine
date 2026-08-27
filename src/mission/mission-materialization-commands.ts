/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/mission/mission-materialization-commands.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0356: initial mission validate/preview/build/diff/reconcile command handlers.</item>
  <item>RFC-0480: rewrite reconcile with git format-patch + git am; add preReconcileSha idempotency.</item>
  <item>RFC-0480: integrate astro build into mission.validate — static checks + build must both pass.</item>
  <item>RFC-0480: add dirty workpiece guard to mission.reconcile.</item>
  <item>RFC-0480: add dirty workpiece warning to mission.validate.</item>
  <item>RFC-0522: add dirty cache clone guard to mission.reconcile inside existsSync(gitDir) block.</item>
  <item>RFC-0522: add git am --3way fallback to patch application loop.</item>
  <item>Add --whitespace=fix to git am calls and auto-resolve add/add conflicts on generated files by taking theirs (workpiece version).</item>
  <item>RFC-0522: add dirty cache clone warning to mission.validate.</item>
  <item>RFC-0560: use resolveActor(input) in mission.reconcile for actor resolution with --actor-from-auth flag.</item>
  <item>RFC-0568: replace git format-patch + git am with git merge --no-ff; remove 3-way fallback and auto-resolve; add untracked file investigation; use dynamic branch name; add push retry with exponential backoff.</item>
  <item>RFC-0578: add structured BUILD-01 diagnostic with pattern matching for common Astro build failures in mission.validate.</item>
  <item>RFC-0579: populate nextSteps in mission.validate for pass, fail, and dirty-workpiece states.</item>
  <item>RFC-0580: auto-commit werkstatt side-effects (mission.yaml) after writeMissionManifest in mission.reconcile.</item>
  <item>ADR-0008: run full three-phase build pipeline (build.prepare → astro build → build.post) in mission.build and mission.validate; write build-input-hash.json in mission.build; delegate to shared runPipelinePhase and computeBuildInputHash helpers.</item>
  <item>RFC-0635: reuse distribution in mission.validate when build-input-hash matches — skip build cycle, copy dist/ from distribution, add distributionReused/buildInputHash/fullBuildRan to MissionValidateData; add build.check phase to mission.build.</item>
  <item>RFC-0644: replace isWorkpieceDirty blocking guard with commitWorkpieceIfDirty auto-commit call before git fetch; add workpieceAutoCommitted/workpieceCommitSha to MissionReconcileData; update mission.validate dirty warnings.</item>
  <item>RFC-0689: extract shared autoRegenerateSnapshotOnSnap01 helper into snapshot-auto-regen.ts for reuse by leitstand.dev-deploy.</item>
  <item>RFC-0697: refactor mission.validate SNAP-01 path to use shared orchestrateSnap01Recovery helper; dirtyBeforeBuildPost check remains caller-side.</item>
  <item>RFC-0702: add commitBordbuchProjections cleanup call in distribution reuse path to clean dirty bordbuch files from previous runs.</item>
  <item>RFC-0705: add non-fatal sternsystem.sync call after git push origin in reconcile when external mirrors exist; add mirrorSync to MissionReconcileData and reconciliation-report.json.</item>
  <item>RFC-0749: add post-validation commitBordbuchProjections cleanup call in mission.validate to commit bordbuch projections that were regenerated during build.prepare but not committed by bordbuch.commit due to transient git failure.</item>
  <item>RFC-0763: add commitBordbuchProjections cleanup on build.prepare failure and validation failure early-return paths to clean bordbuch projections from cache clone on all exit paths. Extract cleanupBordbuchOnFailure helper to avoid duplication.</item>
  <item>Bug fix: post-merge guard — restore system-config.yaml/system-state.yaml if merge silently removed them; commit restored files to avoid leaving cache clone dirty.</item>
  <item>RFC-0796: add validateNoStaleMissionEntries workspace-level advisory check — warns about stale symlinks or terminal-state dirs in missions/ root (non-blocking).</item>
  <item>RFC-0797: add commitCacheCloneIfDirty auto-commit before dirty cache clone guard in mission.reconcile; replace commitBordbuchProjections with commitCacheCloneIfDirty in post-validate cleanup.</item>
  <item>RFC-0820: add zero-transfer warning in mission.reconcile when transferredCommits is zero; add zeroTransferWarning field to reconciliation report.</item>
  <item>RFC-0913: add post-merge .gitignore restoration and untrackForbiddenGeneratedFiles call; add workpieceHeadAtReconcile, gitignoreRestored, forbiddenFilesUntracked to reconciliation report.</item>
  <item>RFC-0918: add post-push divergence check in mission.reconcile comparing cache clone HEAD against origin/main; add divergenceWarning to reconciliation report.</item>
  <item>ADR-0060: split bordbuch auto-resolution conflicted paths into tracked (git checkout HEAD) and untracked generated (git add only) — CACHE_CLONE_GENERATED_PATTERNS files are not in HEAD, so git checkout HEAD fails for them.</item>
  <item>RFC-0958: wrap mission.reconcile post-lock lifecycle in runOperation with journal for crash-safe resume.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { parse as yamlParse } from "yaml";
import type {
  Diagnostic,
  KernelCommandInput,
  KernelCommandResult,
  KernelNextStep,
  KernelPipelineReport,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelCommand, executeKernelPipeline } from "@warpgogol/werkstatt-engine/kernel";
import { collectFiles } from "@warpgogol/werkstatt-shared/share/fs";
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
import { orchestrateSnap01Recovery } from "./snapshot-auto-regen.ts";
import { commitBordbuchProjections } from "../bordbuch/bordbuch-commit.ts";
import type { WorkpieceConfigPresenceResult } from "./workpiece-config-presence-check.ts";
import {
  restoreCacheCloneGitignore,
  untrackForbiddenGeneratedFiles,
  CACHE_CLONE_GENERATED_PATTERNS,
} from "./cache-clone-gitignore.ts";
import { runOperation } from "../journal/runner.ts";
import type { OperationStep, OperationDefinition } from "../journal/index.ts";
import type { MissionManifest } from "@warpgogol/werkstatt-engine/schemas";

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
 * Add new cache-clone-only files here instead of modifying isAutoResolvablePath.
 */
const CACHE_CLONE_ONLY_PATHS: readonly string[] = [
  "bordbuch/",
  "public/.well-known/bordbuch",
  "dns-records.yaml",
  ".materialization-state.json",
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

async function copyDir(src: string, dest: string): Promise<void> {
  if (!existsSync(src)) return;
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

// RFC-0796: Workspace-level advisory check for stale entries in missions/ root.
// Warns about stale symlinks or terminal-state directories. Non-blocking.
export function validateNoStaleMissionEntries(workspaceRoot: string): StaleEntryViolation[] {
  const missionsPath = path.join(workspaceRoot, "missions");
  if (!existsSync(missionsPath)) return [];

  const warnings: StaleEntryViolation[] = [];
  const entries = readdirSync(missionsPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "archive") continue;
    const entryPath = path.join(missionsPath, entry.name);
    const sourceRel = `missions/${entry.name}`;

    let stat;
    try {
      stat = lstatSync(entryPath);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) {
      warnings.push({
        path: sourceRel,
        kind: "symlink",
        message: "stale symlink in missions/ root — run mission.archive to clean up",
      });
    } else if (stat.isDirectory()) {
      // Check if this is a terminal-state mission directory
      const manifestPath = path.join(entryPath, "mission.yaml");
      if (existsSync(manifestPath)) {
        try {
          const content = readFileSync(manifestPath, "utf8");
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

export async function runMissionValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionValidateData>> {
  const { workspaceRoot, logger } = context;
  const missionId = flagString(input, "mission");
  if (!missionId) throw new Error("[mission.validate] --mission is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);
  if (manifest.state !== "open") {
    throw new Error(
      `[mission.validate] mission '${missionId}' is not open (state: ${manifest.state})`,
    );
  }
  if (!manifest.materializedAt) {
    throw new Error(
      `[mission.validate] mission '${missionId}' has not been materialized — run mission.materialize first`,
    );
  }

  const missionDir = resolveMissionDir(workspaceRoot, missionId);
  const workpieceDir = path.join(missionDir, "workpiece");
  const evidenceDir = path.join(missionDir, "evidence");
  const distributionDir = path.join(missionDir, "distribution");
  await fs.mkdir(evidenceDir, { recursive: true });

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
  const force = input.flags.force === true;
  if (!force) {
    const distributionMetaPath = path.join(distributionDir, "build-input-hash.json");
    const distributionDistDir = path.join(distributionDir, "dist");
    if (existsSync(distributionMetaPath) && existsSync(distributionDistDir)) {
      let canReuse = false;
      let storedHash: string | null = null;
      try {
        const meta = JSON.parse(await fs.readFile(distributionMetaPath, "utf8"));
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
        if (!existsSync(workpieceDistDir)) {
          logger.info(`  Copying distribution/dist/ to workpiece/dist/…`);
          await copyDir(distributionDistDir, workpieceDistDir);
        }

        // Read build-manifest.json for routeCount and sitemapHash if available
        let reusedRouteCount = 0;
        let reusedSitemapHash = "sha256:reused";
        try {
          const buildManifestPath = path.join(distributionDir, "build-manifest.json");
          if (existsSync(buildManifestPath)) {
            const manifestData = JSON.parse(await fs.readFile(buildManifestPath, "utf8"));
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

        const dirtyCheck = isWorkpieceDirty(workpieceDir);
        if (dirtyCheck.dirty) {
          logger.warn(
            `[mission.validate] workpiece has ${dirtyCheck.fileCount} uncommitted file(s) — reconcile will auto-commit these before merge. Run \`git status\` to review.`,
          );
        }

        // RFC-0724: bordbuch auto-commit is now done at the top of mission.validate (covers all paths).
        // The reuse path no longer needs its own cleanup call.

        const reuseNextSteps = buildValidateNextSteps(missionId, dirtyCheck);

        // RFC-0796: stale entry warnings (non-blocking)
        const staleEntryWarnings = validateNoStaleMissionEntries(workspaceRoot);
        if (staleEntryWarnings.length > 0) {
          for (const w of staleEntryWarnings) {
            logger.warn(`  [stale-entry] ${w.path}: ${w.message}`);
          }
        }

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

  // RFC-0356 §2: run build.prepare then build.check against the workpiece.
  // build.prepare generates derived artifacts (surface.generated.yaml, etc.)
  // that build.check validators like semantic.targets.validate depend on.
  // The workpiece is discovered as a site workspace via tryResolveMissionWorkpiece
  // when the registry entry has currentMission set.
  logger.info(`  Running build.prepare pipeline for ${manifest.systemId}…`);
  const collectErrors = input.flags["collect-errors"] === true;
  const prepareResult = await executeKernelPipeline({
    workspaceRoot,
    pipelineName: "build.prepare",
    siteName: manifest.systemId,
    outputFormat: "pretty",
    ...(collectErrors ? { collectErrors: true } : {}),
  });
  const prepareReport = Array.isArray(prepareResult) ? prepareResult[0] : prepareResult;
  if (!prepareReport.ok) {
    const failedPrepareSteps = prepareReport.steps
      .filter((s) => !s.ok)
      .map((s) => ({ name: s.commandName, exitCode: s.exitCode }));
    const now = new Date().toISOString();
    const report = {
      schemaVersion: "1.0.0",
      missionId,
      contractFull: {
        passed: false,
        validators: prepareReport.steps.map((s) => ({
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
      validatedAt: now,
    };
    await atomicWriteFile(
      path.join(evidenceDir, "validation-report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    // RFC-0763: clean bordbuch projections on build.prepare failure path
    await cleanupBordbuchOnFailure(
      workspaceRoot,
      manifest.systemId,
      "build.prepare failure",
      logger,
    );
    return {
      data: report as unknown as MissionValidateData,
      exitCode: 1,
      summary: `[mission.validate] ${missionId} build.prepare FAILED (${failedPrepareSteps.length} steps failed)`,
    };
  }

  logger.info(`  Running build.check pipeline for ${manifest.systemId}…`);
  const skipContentRegression = input.flags["skip-content-regression"] === true;
  const autoAcceptRegression = input.flags["auto-accept-regression"] === true;
  const pipelineFlags: Record<string, boolean> = {};
  if (skipContentRegression) pipelineFlags["skip-content-regression"] = true;
  if (autoAcceptRegression) pipelineFlags["auto-accept"] = true;
  const pipelineResult = await executeKernelPipeline({
    workspaceRoot,
    pipelineName: "build.check",
    siteName: manifest.systemId,
    outputFormat: "pretty",
    ...(Object.keys(pipelineFlags).length > 0 ? { flags: pipelineFlags } : {}),
    ...(collectErrors ? { collectErrors: true } : {}),
  });

  const pipelineReport = Array.isArray(pipelineResult) ? pipelineResult[0] : pipelineResult;
  const staticPassed = pipelineReport.ok;
  const stepCount = pipelineReport.steps.length;
  const failedSteps = pipelineReport.steps
    .filter((s) => !s.ok)
    .map((s) => ({ name: s.commandName, exitCode: s.exitCode }));

  // RFC-0480: run astro build after static checks pass — catches runtime errors
  // (content references, missing collections, import failures) that static
  // validators cannot detect.
  let buildSucceeded = false;
  let buildError: string | undefined;
  let routeCount = 0;
  let sitemapHash = "sha256:not-built";

  if (staticPassed) {
    const workpieceDir = path.join(missionDir, "workpiece");

    // RFC-0615: clean stale dist/ before build to prevent false positives
    const distDir = path.join(workpieceDir, "dist");
    if (existsSync(distDir)) {
      logger.info(`  Cleaning stale dist/ before build…`);
      await fs.rm(distDir, { recursive: true, force: true });
    }

    const preliminaryBuildIdentityPath = await writePreliminaryBuildIdentity(
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
      const buildOutput = execSync("pnpm exec astro build", {
        cwd: workpieceDir,
        stdio: "pipe",
        timeout: 300_000,
        encoding: "utf-8",
      });
      buildSucceeded = true;
      // Count generated routes from build output
      const routeMatches = buildOutput.match(/\d+ page\(s\)/g);
      if (routeMatches) {
        const nums = routeMatches.map((m) => parseInt(m, 10));
        routeCount = Math.max(...nums, 0);
      }
      // Compute sitemap hash if sitemap exists
      const sitemapPath = path.join(workpieceDir, "dist", "sitemap-index.xml");
      if (existsSync(sitemapPath)) {
        const { byteHashFile } = await import("@warpgogol/werkstatt-engine/fingerprint");
        sitemapHash = await byteHashFile(sitemapPath);
      } else {
        sitemapHash = "sha256:no-sitemap";
      }
    } catch (err) {
      buildError = err instanceof Error ? err.message : String(err);
      logger.info(`  Build failed: ${buildError}`);
    }

    // RFC-0615: check dirty state before build.post — auto-regeneration
    // requires a clean workpiece because mission.git.commit stages all changes.
    const dirtyBeforeBuildPost = isWorkpieceDirty(workpieceDir);
    if (dirtyBeforeBuildPost.dirty) {
      logger.info(
        `  [warn] workpiece has ${dirtyBeforeBuildPost.fileCount} uncommitted file(s) — snapshot auto-regeneration will be skipped`,
      );
    }

    // RFC-0356: run build.post after astro build — text.normalize.apply,
    // passport.emit, etc. must all run before the validation verdict.
    // RFC-0615: use executeKernelPipeline instead of runPipelinePhase so we
    // can inspect step-level diagnostics for SNAP-01 detection.
    let postPipelineReport: KernelPipelineReport | undefined;
    if (buildSucceeded) {
      logger.info(`  Running build.post pipeline for ${manifest.systemId}…`);
      try {
        const postResult = await executeKernelPipeline({
          workspaceRoot,
          pipelineName: "build.post",
          siteName: manifest.systemId,
          outputFormat: "pretty",
          ...(collectErrors ? { collectErrors: true } : {}),
        });
        postPipelineReport = Array.isArray(postResult) ? postResult[0] : postResult;
        if (!postPipelineReport.ok) {
          buildError = `build.post failed at step: ${postPipelineReport.timing.failedStep ?? "unknown"}`;
          buildSucceeded = false;
          logger.info(`  ${buildError}`);
        }
      } catch (err) {
        buildError = err instanceof Error ? err.message : String(err);
        buildSucceeded = false;
        logger.info(`  build.post failed: ${buildError}`);
      }
    }

    // RFC-0615/RFC-0697: auto-regenerate behavior snapshot on SNAP-01 when workpiece was clean.
    // The dirtyBeforeBuildPost check is caller-side (mission.validate-specific pre-condition).
    if (
      postPipelineReport &&
      !postPipelineReport.ok &&
      !dirtyBeforeBuildPost.dirty &&
      !buildSucceeded
    ) {
      const snapshotStep = postPipelineReport.steps.find(
        (s) => s.commandName === "behavior.snapshot.validate",
      );

      const snapResult = await orchestrateSnap01Recovery({
        workspaceRoot,
        systemId: manifest.systemId,
        missionId,
        logger,
        validateFn: async () => snapshotStep?.data,
        rebuildFn: async () => {
          logger.info(`  Re-running build.post after snapshot regeneration…`);
          const revalidateResult = await executeKernelPipeline({
            workspaceRoot,
            pipelineName: "build.post",
            siteName: manifest.systemId,
            outputFormat: "pretty",
            ...(collectErrors ? { collectErrors: true } : {}),
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
        buildSucceeded = true;
        buildError = undefined;
        logger.info(`  build.post passed after snapshot regeneration`);
      } else if (snapResult.regenerated && !snapResult.rebuildSucceeded) {
        buildError = snapResult.error ?? "build.post still failing after snapshot regeneration";
        logger.info(`  ${buildError}`);
      } else if (snapResult.error) {
        buildError = snapResult.error;
      }
    }

    await cleanupPreliminaryBuildIdentity(preliminaryBuildIdentityPath);
  }

  const passed = staticPassed && buildSucceeded;
  const now = new Date().toISOString();
  const buildDiagnostics = buildError ? buildFailureDiagnostics(buildError) : [];
  const report = {
    schemaVersion: "1.0.0",
    missionId,
    contractFull: {
      passed,
      validators: pipelineReport.steps.map((s) => ({
        name: s.commandName,
        status: s.ok ? "pass" : "fail",
        exitCode: s.exitCode,
      })),
    },
    build: {
      succeeded: buildSucceeded,
      routeCount,
      sitemapHash,
      ...(buildError ? { error: buildError } : {}),
      failedSteps,
    },
    ...(buildDiagnostics.length > 0 ? { diagnostics: buildDiagnostics } : {}),
    distributionReused: false,
    buildInputHash: null,
    fullBuildRan: true,
    validatedAt: now,
  };

  await atomicWriteFile(
    path.join(evidenceDir, "validation-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );

  if (!passed) {
    const reason = !staticPassed
      ? `${failedSteps.length}/${stepCount} steps failed`
      : "astro build failed";
    const failNextSteps: KernelNextStep[] = [
      {
        action: `Fix the failing validators above, then re-run: pnpm exec werkstatt run mission.validate --mission ${missionId}`,
        kind: "required",
      },
    ];
    // RFC-0763: clean bordbuch projections on validation failure path
    await cleanupBordbuchOnFailure(workspaceRoot, manifest.systemId, "validation failure", logger);
    return {
      data: report as unknown as MissionValidateData,
      exitCode: 1,
      summary: `[mission.validate] ${missionId} validation FAILED (${reason})`,
      nextSteps: failNextSteps,
    };
  }

  const dirtyCheck = isWorkpieceDirty(workpieceDir);
  if (dirtyCheck.dirty) {
    logger.warn(
      `[mission.validate] workpiece has ${dirtyCheck.fileCount} uncommitted file(s) — reconcile will auto-commit these before merge. Run \`git status\` to review.`,
    );
  }

  // RFC-0797: post-validation cache clone cleanup — commit ALL generated files
  // (superset of bordbuch projections). This prevents the RFC-0522 dirty cache clone
  // warning from firing for any generated file and unblocks mission.reconcile.
  try {
    const postValidateCachePath = await resolveCacheClonePath(workspaceRoot, manifest.systemId);
    const postValidateCache = commitCacheCloneIfDirty(postValidateCachePath, manifest.systemId);
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
  if (existsSync(path.join(systemDir, ".git"))) {
    const cacheDirtyCheck = isWorkpieceDirty(systemDir);
    if (cacheDirtyCheck.dirty) {
      logger.warn(
        `[mission.validate] cache clone for system '${manifest.systemId}' has ${cacheDirtyCheck.fileCount} uncommitted file(s) — reconcile will fail until resolved`,
      );
    }
  }

  // RFC-0796: stale entry warnings (non-blocking)
  const staleEntryWarnings = validateNoStaleMissionEntries(workspaceRoot);
  if (staleEntryWarnings.length > 0) {
    for (const w of staleEntryWarnings) {
      logger.warn(`  [stale-entry] ${w.path}: ${w.message}`);
    }
  }

  // RFC-0579: populate nextSteps based on workpiece dirty state
  const passNextSteps = buildValidateNextSteps(missionId, dirtyCheck);

  return {
    data: { ...report, staleEntryWarnings } as unknown as MissionValidateData,
    summary: `[mission.validate] ${missionId} validation passed (${stepCount} steps, ${routeCount} routes built)`,
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

  const missionDir = resolveMissionDir(workspaceRoot, missionId);
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
      const buildOutput = execSync("pnpm exec astro build", {
        cwd: workpieceDir,
        stdio: "pipe",
        timeout: 300_000,
        encoding: "utf-8",
      });
      const routeMatches = buildOutput.match(/\d+ page\(s\)/g);
      if (routeMatches) {
        const nums = routeMatches.map((m) => parseInt(m, 10));
        buildRouteCount = Math.max(...nums, 0);
      }
      const sitemapPath = path.join(workpieceDir, "dist", "sitemap-index.xml");
      if (existsSync(sitemapPath)) {
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
  // Copy dist/ from workpiece to distribution/
  const distSrc = path.join(workpieceDir, "dist");
  const distDest = path.join(distributionDir, "dist");
  if (existsSync(distSrc)) {
    if (existsSync(distDest)) {
      await fs.rm(distDest, { recursive: true, force: true });
    }
    await copyDir(distSrc, distDest);
  }

  // Write build-input-hash.json so release.prepare can reuse this distribution
  if (buildSucceeded) {
    const { buildInputHash } = await computeBuildInputHash(workspaceRoot, workpieceDir);
    await atomicWriteFile(
      path.join(distributionDir, "build-input-hash.json"),
      JSON.stringify({ buildInputHash, computedAt: new Date().toISOString() }, null, 2) + "\n",
    );
  }

  const now = new Date().toISOString();
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
    path.join(distributionDir, "build-manifest.json"),
    JSON.stringify(buildManifest, null, 2) + "\n",
  );

  const evidenceDir = path.join(missionDir, "evidence");
  await fs.mkdir(evidenceDir, { recursive: true });
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

async function collectRelativeFiles(dir: string, base: string = dir): Promise<string[]> {
  if (!existsSync(dir)) return [];
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
  const workpieceDir = path.join(resolveMissionDir(workspaceRoot, missionId), "workpiece");

  const systemFiles = new Set(await collectRelativeFiles(systemDir));
  const workpieceFiles = new Set(await collectRelativeFiles(workpieceDir));

  const added = [...workpieceFiles].filter((f) => !systemFiles.has(f));
  const removed = [...systemFiles].filter((f) => !workpieceFiles.has(f));
  const modified: string[] = [];

  for (const f of workpieceFiles) {
    if (systemFiles.has(f)) {
      const sysContent = await fs.readFile(path.join(systemDir, f), "utf8").catch(() => "");
      const wpContent = await fs.readFile(path.join(workpieceDir, f), "utf8").catch(() => "");
      if (sysContent !== wpContent) modified.push(f);
    }
  }

  const missionDir = resolveMissionDir(workspaceRoot, missionId);
  const evidenceDir = path.join(missionDir, "evidence");
  await fs.mkdir(evidenceDir, { recursive: true });
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
function abortMerge(systemDir: string): void {
  try {
    execSync("git merge --abort", { cwd: systemDir, stdio: "pipe" });
  } catch {
    // merge --abort also failed — continue to throw
  }
}

export async function runMissionReconcile(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionReconcileData>> {
  const { workspaceRoot, logger } = context;
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
  const evidenceDir = path.join(resolveMissionDir(workspaceRoot, missionId), "evidence");
  const validationPath = path.join(evidenceDir, "validation-report.json");
  if (!existsSync(validationPath)) {
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
  const validationRaw = await fs.readFile(validationPath, "utf8").catch(() => null);
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

  const workpieceDir = path.join(resolveMissionDir(workspaceRoot, missionId), "workpiece");
  const systemDir = await resolveCacheClonePath(workspaceRoot, manifest.systemId);

  try {
    const now = new Date().toISOString();
    const missionDir = resolveMissionDir(workspaceRoot, missionId);

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
        ? `, ${cc.autoResolvedPaths.length} bordbuch conflict${cc.autoResolvedPaths.length > 1 ? "s" : ""} auto-resolved`
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
  ctx: unknown,
): Promise<OperationStep<unknown>[]> {
  const steps: OperationStep<unknown>[] = [
    {
      name: "workpiece-git-check",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        if (!existsSync(path.join(cc.workpieceDir, ".git"))) {
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
        const result = commitWorkpieceIfDirty(cc.workpieceDir, cc.missionId);
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
        if (!existsSync(gitDir)) return;
        const cacheCommit = commitCacheCloneIfDirty(cc.systemDir, cc.manifest.systemId);
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
        if (!existsSync(gitDir)) return;
        const cacheDirtyCheck = isWorkpieceDirty(cc.systemDir);
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
        if (!existsSync(gitDir)) return;
        try {
          cc.preReconcileSha = execSync("git rev-parse HEAD", {
            cwd: cc.systemDir,
            stdio: "pipe",
            encoding: "utf-8",
          }).trim();
        } catch {
          cc.preReconcileSha = null;
        }
        const prevReportPath = path.join(cc.evidenceDir, "reconciliation-report.json");
        if (existsSync(prevReportPath)) {
          try {
            const prevReport = JSON.parse(await fs.readFile(prevReportPath, "utf8")) as {
              preReconcileSha?: string;
            };
            if (prevReport.preReconcileSha) {
              try {
                execSync(`git reset --hard ${prevReport.preReconcileSha}`, {
                  cwd: cc.systemDir,
                  stdio: "pipe",
                  encoding: "utf-8",
                });
                cc.context.logger.info(
                  `  Reset cache clone to pre-reconcile SHA ${prevReport.preReconcileSha.slice(0, 12)}`,
                );
              } catch {
                // Previous SHA may not exist — continue with current HEAD
              }
            }
          } catch {
            // Unparseable report — continue
          }
        }
      },
    },
    {
      name: "fetch-and-merge",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!existsSync(gitDir)) {
          for (const dataPath of STERNSYSTEM_DATA_PATHS) {
            const src = path.join(cc.workpieceDir, dataPath);
            const dest = path.join(cc.systemDir, dataPath);
            if (existsSync(src)) {
              if (existsSync(dest)) {
                await fs.rm(dest, { recursive: true, force: true });
              }
              await copyDir(src, dest);
              cc.copiedPaths.push(dataPath);
              cc.context.logger.info(`  Reconciled ${dataPath}`);
            }
          }
          return;
        }
        const workpieceBranch = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: cc.workpieceDir,
          stdio: "pipe",
          encoding: "utf-8",
        }).trim();
        execSync(
          `git fetch ${JSON.stringify(cc.workpieceDir)} ${JSON.stringify(workpieceBranch)}`,
          {
            cwd: cc.systemDir,
            stdio: "pipe",
            encoding: "utf-8",
          },
        );
        const mergeMessage = `reconcile mission ${cc.missionId}`;
        try {
          execSync(`git merge --no-ff FETCH_HEAD -m ${JSON.stringify(mergeMessage)}`, {
            cwd: cc.systemDir,
            stdio: "pipe",
            encoding: "utf-8",
          });
        } catch (err) {
          const isAutoResolvablePath = (p: string) =>
            CACHE_CLONE_ONLY_PATHS.some((pattern) => p.startsWith(pattern));
          const conflictedPaths: string[] = [];
          const bordbuchDeletedPaths: string[] = [];
          try {
            const statusOutput = execSync("git status --porcelain", {
              cwd: cc.systemDir,
              stdio: "pipe",
              encoding: "utf-8",
            });
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
          const allAutoResolvable =
            conflictedPaths.length > 0 && conflictedPaths.every(isAutoResolvablePath);
          if (allAutoResolvable) {
            try {
              if (bordbuchDeletedPaths.length > 0) {
                const delPathArgs = bordbuchDeletedPaths.map((p) => JSON.stringify(p)).join(" ");
                execSync(`git checkout HEAD -- ${delPathArgs}`, {
                  cwd: cc.systemDir,
                  stdio: "pipe",
                  encoding: "utf-8",
                });
                execSync(`git add -- ${delPathArgs}`, {
                  cwd: cc.systemDir,
                  stdio: "pipe",
                  encoding: "utf-8",
                });
              }
              const isGeneratedUntracked = (p: string) =>
                CACHE_CLONE_GENERATED_PATTERNS.some(
                  (pattern) => p === pattern || p.startsWith(pattern.replace(/\.[^.]+$/, "")),
                );
              const trackedConflicted = conflictedPaths.filter((p) => !isGeneratedUntracked(p));
              const generatedConflicted = conflictedPaths.filter((p) => isGeneratedUntracked(p));
              if (trackedConflicted.length > 0) {
                const trackedArgs = trackedConflicted.map((p) => JSON.stringify(p)).join(" ");
                execSync(`git checkout HEAD -- ${trackedArgs}`, {
                  cwd: cc.systemDir,
                  stdio: "pipe",
                  encoding: "utf-8",
                });
                execSync(`git add -- ${trackedArgs}`, {
                  cwd: cc.systemDir,
                  stdio: "pipe",
                  encoding: "utf-8",
                });
              }
              if (generatedConflicted.length > 0) {
                const generatedArgs = generatedConflicted.map((p) => JSON.stringify(p)).join(" ");
                execSync(`git add -- ${generatedArgs}`, {
                  cwd: cc.systemDir,
                  stdio: "pipe",
                  encoding: "utf-8",
                });
              }
              cacheCloneCommit(cc.systemDir, "", { noEdit: true });
              cc.autoResolvedPaths = conflictedPaths;
              cc.context.logger.info(
                `  Auto-resolved ${cc.autoResolvedPaths.length} cache-clone-only conflict(s)`,
              );
            } catch (resolveErr) {
              abortMerge(cc.systemDir);
              throw new Error(
                `[mission.reconcile] bordbuch auto-resolution failed: ${(resolveErr as Error).message}.\n` +
                  `Merge has been aborted. Inspect the cache clone state manually.\n` +
                  `Reconcile is idempotent — it will reset the cache clone to preReconcileSha and re-merge.`,
              );
            }
          } else {
            abortMerge(cc.systemDir);
            throw new Error(
              `[mission.reconcile] git merge --no-ff failed: ${(err as Error).message}.\n` +
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
        if (!existsSync(gitDir)) return;
        try {
          cc.workpieceHeadAtReconcile = execSync("git rev-parse HEAD", {
            cwd: cc.workpieceDir,
            stdio: ["pipe", "pipe", "pipe"],
            encoding: "utf-8",
          }).trim();
        } catch {
          cc.workpieceHeadAtReconcile = null;
        }
        cc.commitSha = execSync("git rev-parse HEAD", {
          cwd: cc.systemDir,
          stdio: "pipe",
          encoding: "utf-8",
        }).trim();
      },
    },
    {
      name: "post-merge-guard",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!existsSync(gitDir)) return;
        const criticalFiles = ["system-config.yaml", "system-state.yaml"];
        const restoredFiles: string[] = [];
        for (const cf of criticalFiles) {
          if (!existsSync(path.join(cc.systemDir, cf)) && cc.preReconcileSha) {
            try {
              execSync(`git checkout ${cc.preReconcileSha} -- ${JSON.stringify(cf)}`, {
                cwd: cc.systemDir,
                stdio: "pipe",
                encoding: "utf-8",
              });
              restoredFiles.push(cf);
              cc.context.logger.info(`  Restored ${cf} after merge (was missing)`);
            } catch {
              // File may not exist in preReconcileSha either — skip
            }
          }
        }
        if (restoredFiles.length > 0) {
          const addArgs = restoredFiles.map((f) => JSON.stringify(f)).join(" ");
          execSync(`git add -- ${addArgs}`, {
            cwd: cc.systemDir,
            stdio: "pipe",
            encoding: "utf-8",
          });
          cacheCloneCommit(cc.systemDir, "restore critical config files after merge");
        }
      },
    },
    {
      name: "gitignore-restoration",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!existsSync(gitDir)) return;
        try {
          cc.gitignoreRestored = await restoreCacheCloneGitignore(cc.systemDir);
          if (cc.gitignoreRestored) {
            cc.context.logger.info(`  Restored cache-clone-only .gitignore patterns after merge`);
            execSync("git add .gitignore", { cwd: cc.systemDir, stdio: "pipe", encoding: "utf-8" });
          }
          cc.forbiddenFilesUntracked = untrackForbiddenGeneratedFiles(cc.systemDir);
          if (cc.forbiddenFilesUntracked.length > 0) {
            cc.context.logger.info(
              `  Untracked ${cc.forbiddenFilesUntracked.length} forbidden/generated file(s)`,
            );
          }
          if (cc.gitignoreRestored || cc.forbiddenFilesUntracked.length > 0) {
            cacheCloneCommit(
              cc.systemDir,
              "restore cache-clone .gitignore and untrack forbidden files (RFC-0913)",
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
        if (!existsSync(gitDir)) return;
        cc.mergeCommitSha = execSync("git rev-parse HEAD^1", {
          cwd: cc.systemDir,
          stdio: "pipe",
          encoding: "utf-8",
        }).trim();
        if (cc.preReconcileSha) {
          try {
            const countOutput = execSync(`git rev-list --count ${cc.preReconcileSha}..FETCH_HEAD`, {
              cwd: cc.systemDir,
              stdio: "pipe",
              encoding: "utf-8",
            }).trim();
            cc.transferredCommits = parseInt(countOutput, 10);
          } catch {
            cc.transferredCommits = 0;
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
      name: "push-to-origin",
      run: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const gitDir = path.join(cc.systemDir, ".git");
        if (!existsSync(gitDir)) return;
        const branch = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: cc.systemDir,
          stdio: "pipe",
          encoding: "utf-8",
        }).trim();
        const pushBackoffMs = [1000, 2000, 4000];
        let pushSucceeded = false;
        for (let attempt = 0; attempt < pushBackoffMs.length; attempt++) {
          try {
            execSync(`git push origin ${JSON.stringify(branch)}`, {
              cwd: cc.systemDir,
              stdio: "pipe",
              timeout: 30_000,
            });
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
        if (!existsSync(gitDir)) return;
        try {
          const cacheCloneHead = execSync("git rev-parse HEAD", {
            cwd: cc.systemDir,
            stdio: "pipe",
            encoding: "utf-8",
          }).trim();
          const originHead = execSync("git rev-parse origin/main", {
            cwd: cc.systemDir,
            stdio: "pipe",
            encoding: "utf-8",
          }).trim();
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
        if (!existsSync(gitDir)) return;
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
      verify: async (c: unknown) => {
        const cc = c as ReconcileStepCtx;
        const reRead = await readMissionManifest(cc.workspaceRoot, cc.missionId);
        return reRead.reconciledAt === cc.now;
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
