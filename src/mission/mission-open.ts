/*
<MODULE_CONTRACT>
<purpose>RFC-0355 §5.1: mission.open — open a new mission for a Sternsystem.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
  <item>RFC-1157: auto-trash cache-only mission husks in cleanupStaleMissionEntries; logger-threaded isCacheOnlyMissionRemnant.</item>
  <item>RFC-1159: step 3 — io.exec exit-code sweep via execOrThrow</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
  <item>RFC-1263</item>
  <history>ADR-0030, RFC-0355, RFC-0477, RFC-0560, RFC-0580, RFC-0593, RFC-0796, RFC-0951, RFC-0958, RFC-1097, RFC-1139</history>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import {
  createDefaultIO,
  execOrThrow,
  type WorkspaceIO,
} from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import type { MissionManifest, SystemState } from "@warpgogol/werkstatt-engine/schemas";
import {
  readSystemConfig,
  readSystemState,
  writeSystemState,
  resolveCacheClonePath,
  discoverSystems,
} from "../sternsystem/registry-io.ts";
import { createMissionDirectories, writeMissionManifest, missionExists } from "./mission-io.ts";
import {
  readBordbuch,
  deriveNextMissionNumberSafe,
  validateBordbuch,
  type BordbuchViolation,
} from "../bordbuch/bordbuch-io.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import {
  acquireLock,
  releaseLock,
  generateOperationId,
  commitWerkstattSideEffects,
} from "../werkstatt/index.ts";
import { resolveActor } from "./actor-identity.ts";
import { trashPath } from "@warpgogol/forge/utils";
import { gitExec } from "../werkstatt/git-exec.ts";
import { runMissionMaterializeInternal } from "./mission-materialize.ts";
import { runOperation } from "../journal/runner.ts";
import { checkDifferentKindOperation } from "../journal/index.ts";
import type { OperationStep, OperationDefinition } from "../journal/index.ts";
import { getDefaultScopeManager } from "../scope/scope.ts";
import { applyOverlay } from "../runtime/overlay-store.ts";

export interface StaleEntryCheck {
  removedPaths: string[];
  skipped: string[];
}

export interface MissionOpenData {
  missionId: string;
  systemId: string;
  state: "open";
  brief: string;
  openedAt: string;
  pinAtOpen: string;
  operationId: string;
  staleEntries: StaleEntryCheck;
  materializedAt: string | null;
}

const REPAIRABLE_RULES = new Set(["orphan-mission-close", "unmatched-mission-open"]);

// RFC-0982 parity with mission.archive: cache entries are dotfiles/dotdirs
// (.astro, .cache, .turbo, .wrangler, .closed), node_modules and dist —
// transient artifacts that never constitute recoverable mission content.
function isMissionCacheEntry(name: string): boolean {
  return name.startsWith(".") || name === "node_modules" || name === "dist";
}

/**
 * RFC-1157: a mission dir without mission.yaml is auto-trashable only when
 * every entry — at the root and inside workpiece/ — is a cache artifact
 * (husks left behind by mission.archive's post-rename cleanup or watchers).
 * Any real file makes it a manual-inspection remnant (RFC-1139 warn path).
 */
async function isCacheOnlyMissionRemnant(
  missionDir: string,
  io: WorkspaceIO,
  logger: { warn: (msg: string) => void },
): Promise<boolean> {
  try {
    for (const entry of await io.readdir(missionDir)) {
      if (entry.name === "workpiece" && entry.isDirectory) continue;
      if (!isMissionCacheEntry(entry.name)) return false;
    }
    const workpieceDir = path.join(missionDir, "workpiece");
    if (await io.exists(workpieceDir)) {
      for (const wp of await io.readdir(workpieceDir)) {
        if (!isMissionCacheEntry(wp.name)) return false;
      }
    }
    return true;
  } catch (err) {
    // Fail-safe: never auto-trash on inspection failure, but keep the reason.
    logger.warn(
      `  Could not inspect ${missionDir} for cache-only content: ${err instanceof Error ? err.message : String(err)} — treating as manual-inspection remnant`,
    );
    return false;
  }
}

export async function cleanupStaleMissionEntries(
  workspaceRoot: string,
  logger: { info: (msg: string) => void; warn: (msg: string) => void },
  io: WorkspaceIO = createDefaultIO().io,
): Promise<StaleEntryCheck> {
  const missionsPath = path.join(workspaceRoot, "missions");
  const result: StaleEntryCheck = { removedPaths: [], skipped: [] };

  if (!(await io.exists(missionsPath))) return result;

  // Scan all entries in missions/ root for stale symlinks and empty dirs
  const entries = await io.readdir(missionsPath);
  for (const entry of entries) {
    if (entry.name === "archive") continue;
    const entryPath = path.join(missionsPath, entry.name);
    const sourceRel = `missions/${entry.name}`;

    // Detect symlinks via test -L (port DirEntry/stat follow symlinks)
    const linkCheck = await io.exec("test", ["-L", entryPath]);
    if (linkCheck.exitCode === 0) {
      await trashPath(entryPath);
      result.removedPaths.push(sourceRel);
      logger.info(`  Cleaned stale symlink: ${sourceRel}`);
    } else if (entry.isDirectory) {
      // Check if directory is empty
      let isEmpty = true;
      try {
        const dirEntries = await io.readdir(entryPath);
        isEmpty = dirEntries.length === 0;
      } catch {
        isEmpty = false;
      }
      if (isEmpty) {
        await trashPath(entryPath);
        result.removedPaths.push(sourceRel);
        logger.info(`  Cleaned empty directory: ${sourceRel}`);
      } else if (!(await io.exists(path.join(entryPath, "mission.yaml")))) {
        if (await isCacheOnlyMissionRemnant(entryPath, io, logger)) {
          // RFC-1157: cache-only husks (post-archive workpiece/ shells with
          // only .astro/node_modules/dist) carry no recoverable content —
          // trash them here instead of re-warning on every mission.open.
          await trashPath(entryPath);
          result.removedPaths.push(sourceRel);
          logger.info(`  Cleaned cache-only mission remnant: ${sourceRel}`);
        } else {
          // RFC-1139: non-empty dir without mission.yaml that holds real
          // content is a stale remnant — report it with the cleanup path.
          result.skipped.push(sourceRel);
          logger.warn(
            `  Stale mission remnant: ${sourceRel} (no mission.yaml) — clean via \`pnpm exec werkstatt run mission.archive --clean-orphans\``,
          );
        }
      } else {
        result.skipped.push(sourceRel);
        logger.warn(`  Skipping non-empty real directory: ${sourceRel}`);
      }
    }
  }

  return result;
}
function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

async function preflightBordbuch(
  workspaceRoot: string,
  systemId: string,
): Promise<{ passed: boolean; violations: BordbuchViolation[] }> {
  const { violations } = await validateBordbuch(workspaceRoot, systemId);
  return { passed: violations.length === 0, violations };
}

export async function runMissionOpen(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionOpenData>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system");
  const brief = flagString(input, "brief");
  const actor = resolveActor(input);
  // RFC-1263: --lane declares the mission's lifecycle lane on the record —
  // "content" marks a content fast-lane mission (mission.content-edit).
  const laneFlag = flagString(input, "lane");
  if (laneFlag && laneFlag !== "content" && laneFlag !== "full") {
    throw new Error(`[mission.open] --lane must be "content" or "full" (got "${laneFlag}")`);
  }

  if (!systemId) throw new Error("[mission.open] --system is required");
  if (!brief) throw new Error("[mission.open] --brief is required");

  // Check system exists before proceeding — list available systems on failure
  try {
    await readSystemConfig(workspaceRoot, systemId);
  } catch {
    const { systems: available } = await discoverSystems(workspaceRoot);
    const ids = available.map((s) => s.id).join(", ");
    throw new Error(
      `[mission.open] system '${systemId}' not found. Available systems: ${ids || "(none)"}`,
    );
  }

  // RFC-0987 Fix 3: Pre-preflight cache clone git sanity check — must run before
  // bordbuch.repair to prevent rebase cascade from blocking mission.open. A stale
  // rebase-merge from a previous failed commitAndPushBordbuch will cause bordbuch.repair's
  // git pull --rebase to fail with "It seems that there is already a rebase-merge directory".
  // Auto-recover: abort the stale rebase and log a warning. Detached HEAD remains fail-fast.
  const cacheDir = resolveCacheClonePath(workspaceRoot, systemId);
  if (await context.io.exists(path.join(cacheDir, ".git"))) {
    // Check detached HEAD — fail-fast (requires operator decision)
    const symRef = await context.io.exec("git", ["symbolic-ref", "HEAD"], {
      cwd: cacheDir,
    });
    if (symRef.exitCode !== 0) {
      throw new Error(
        `[mission.open] cache clone for '${systemId}' is in detached HEAD. ` +
          `Run: git -C ${cacheDir} checkout main`,
      );
    }
    // Check stale rebase-merge — auto-recover + warn
    if (await context.io.exists(path.join(cacheDir, ".git", "rebase-merge"))) {
      logger.warn(
        `[mission.open] cache clone for '${systemId}' has stale rebase-merge — auto-aborting before bordbuch validation.`,
      );
      let abortSucceeded = false;
      const abortResult = await context.io.exec("git", ["rebase", "--abort"], {
        cwd: cacheDir,
        timeoutMs: 10_000,
      });
      if (abortResult.exitCode === 0) {
        abortSucceeded = true;
      } else {
        // If git rebase --abort fails, manually remove the rebase state directories
        try {
          await context.io.rm(path.join(cacheDir, ".git", "rebase-merge"), { recursive: true });
          await context.io
            .rm(path.join(cacheDir, ".git", "rebase-apply"), { recursive: true })
            .catch(() => {});
          abortSucceeded = true;
        } catch {}
      }
      if (!abortSucceeded) {
        throw new Error(
          `[mission.open] stale rebase-merge found in cache clone for '${systemId}' and auto-abort failed. ` +
            `Run: git -C ${cacheDir} rebase --abort`,
        );
      }
    }
  }

  // RFC-0593: pre-flight bordbuch validation gate — refuse to open a new mission
  // if the system's bordbuch has any violations. This runs before lock acquisition
  // to avoid holding locks during validation. Known TOCTOU limitation: bordbuch.repair
  // (operator-only) could change the bordbuch concurrently — low risk, failed attempt
  // exits with code 1 before any side effects.
  //
  // Auto-repair: if all violations are orphan-mission-close (safe to repair per
  // RFC-0583), automatically call bordbuch.repair instead of requiring manual
  // intervention. This is the most common violation after a manual bordbuch edit
  // or a crashed mission.close, and repair is deterministic and safe.
  const bordbuchCheck = await preflightBordbuch(workspaceRoot, systemId);
  if (!bordbuchCheck.passed) {
    const allRepairable = bordbuchCheck.violations.every((v) => REPAIRABLE_RULES.has(v.rule));
    if (allRepairable) {
      try {
        const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
        await executeKernelCommand({
          workspaceRoot,
          commandName: "bordbuch.repair",
          argv: [`--system=${systemId}`],
        });
        const recheck = await preflightBordbuch(workspaceRoot, systemId);
        if (!recheck.passed) {
          const violationLines = recheck.violations
            .map((v) => `  ${v.rule}: ${v.message}`)
            .join("\n");
          throw new Error(
            `[mission.open] bordbuch.repair ran but ${recheck.violations.length} violation${recheck.violations.length === 1 ? "" : "s"} remain for system '${systemId}'\n${violationLines}`,
          );
        }
        // bordbuch.repair now auto-commits its output, so no separate
        // commitAndPushBordbuch call is needed here. The cache clone is
        // clean after repair, preventing git pull --rebase failures.
      } catch (repairErr) {
        throw new Error(
          `[mission.open] bordbuch for system '${systemId}' has ${bordbuchCheck.violations.length} repairable violation${bordbuchCheck.violations.length === 1 ? "" : "s"} — auto-repair failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}`,
        );
      }
    } else {
      const violationLines = bordbuchCheck.violations
        .map((v) => `  ${v.rule}: ${v.message}`)
        .join("\n");
      throw new Error(
        `[mission.open] bordbuch for system '${systemId}' has ${bordbuchCheck.violations.length} violation${bordbuchCheck.violations.length === 1 ? "" : "s"} — run bordbuch.repair first\n${violationLines}`,
      );
    }
  }

  const operationId = generateOperationId();

  await acquireLock(workspaceRoot, `system:${systemId}`, operationId, "mission.open", actor);

  try {
    const config = await readSystemConfig(workspaceRoot, systemId);
    const state = await readSystemState(workspaceRoot, systemId);

    if (config.status === "paused" || config.status === "archived") {
      throw new Error(
        `[mission.open] system '${systemId}' has status '${config.status}' — cannot open missions`,
      );
    }
    if (state.currentMission) {
      throw new Error(
        `[mission.open] system '${systemId}' already has open mission '${state.currentMission}'`,
      );
    }

    // Check pin file exists
    const cacheDir = resolveCacheClonePath(workspaceRoot, systemId);
    const pinPath = path.join(cacheDir, "system.pin.json");
    if (!(await context.io.exists(pinPath))) {
      throw new Error(
        `[mission.open] system '${systemId}' has no system.pin.json — run sternsystem.pin first`,
      );
    }

    // Read pin to get platform version
    const pinRaw = await context.io.readFile(pinPath);
    const pin = JSON.parse(pinRaw);
    const pinAtOpen = pin.platform?.version ?? "unknown";

    // Derive next mission number from Bordbuch + existing directories on disk
    const bordbuchEntries = await readBordbuch(workspaceRoot, systemId);
    const nextNum = await deriveNextMissionNumberSafe(bordbuchEntries, workspaceRoot, systemId);
    const missionId = `${systemId}-m${String(nextNum).padStart(6, "0")}`;

    // Belt-and-suspenders: deriveNextMissionNumberSafe already scans disk
    // directories, but this guard ensures we never overwrite an existing
    // mission manifest even if the directory scan missed it (e.g. race).
    if (await missionExists(workspaceRoot, missionId)) {
      throw new Error(
        `[mission.open] mission directory '${missionId}' already exists — remove it or renumber before opening a new mission`,
      );
    }

    // RFC-0796: Pre-flight cleanup of stale symlinks and empty directories
    // before creating mission directories. Non-empty real directories are
    // skipped with a warning.
    const staleEntries = await cleanupStaleMissionEntries(workspaceRoot, logger);

    // Create mission directories
    await createMissionDirectories(workspaceRoot, missionId);

    const now = new Date().toISOString();
    const manifest: MissionManifest = {
      schemaVersion: "1.0.0",
      missionId,
      systemId,
      state: "open",
      brief,
      openedAt: now,
      openedBy: actor,
      closedAt: null,
      closedBy: null,
      pinAtOpen,
      materializedAt: null,
      migratedAt: null,
      reconciledAt: null,
      releaseId: null,
      rfcId: null,
      operationId,
      ...(laneFlag ? { lane: laneFlag as "content" | "full" } : {}),
    };

    // RFC-0958: Build step context and run post-lock lifecycle via journal
    const openCtx: OpenStepCtx = {
      workspaceRoot,
      systemId,
      missionId,
      manifest,
      actor,
      now,
      pinAtOpen,
      operationId,
      staleEntries,
      context,
      state,
      materializedAt: null,
    };

    const steps = await buildOpenSteps(workspaceRoot, missionId, openCtx);
    const journalPath = path.join(workspaceRoot, "missions", missionId, "journal.jsonl");

    // RFC-0958 Step 7: block if a different-kind operation is incomplete
    const blockCheck = await checkDifferentKindOperation(journalPath, "mission.open");
    if (blockCheck.blocked) {
      return {
        data: {
          missionId,
          systemId,
          state: "open" as const,
          openedAt: new Date().toISOString(),
          materializedAt: null,
          blockedByOperation: blockCheck.incompleteOp,
        } as unknown as MissionOpenData,
        exitCode: 1,
        summary: `[mission.open] ${missionId} blocked: incomplete '${blockCheck.incompleteOp}' operation found in journal`,
        nextSteps: [
          {
            action: `Run: pnpm exec werkstatt run mission.resume --mission ${missionId} to resume or abandon the incomplete operation`,
            kind: "required",
          },
        ],
      };
    }

    const def: OperationDefinition<unknown> = { op: "mission.open", steps };
    const opResult = await runOperation(journalPath, def, openCtx, {
      missionId,
      platformVersion: "",
    });

    if (!opResult.completed) {
      const detail = opResult.failedStepError ?? "unknown error";
      const failedStep = opResult.failedStep;

      // Domain-specific rollback (RFC-0951, bug fix cleanup)
      if (failedStep === "bordbuch-append") {
        const missionDir = path.join(workspaceRoot, "missions", missionId);
        try {
          await context.io.rm(missionDir, { recursive: true });
        } catch {
          // best-effort cleanup
        }
        throw new Error(detail);
      }

      if (failedStep === "auto-materialize") {
        // Forward-only rollback — RFC-0951, DNA-46 append-only log
        try {
          await appendAndCommitBordbuch(
            workspaceRoot,
            systemId,
            "mission-open-rolled-back",
            `Materialization failed: ${detail}`,
            actor,
            {
              missionId,
              writerRole: "mission",
              metadata: { reason: detail },
            },
            `Bordbuch: mission-open-rolled-back ${missionId}`,
          );
        } catch (bordbuchRollbackErr) {
          logger.warn(
            `[mission.open] compensating bordbuch entry failed: ${bordbuchRollbackErr instanceof Error ? bordbuchRollbackErr.message : String(bordbuchRollbackErr)}. ` +
              `Run bordbuch.repair to fix the bordbuch manually.`,
          );
        }
        const missionDir = path.join(workspaceRoot, "missions", missionId);
        const workpieceDir = path.join(missionDir, "workpiece");
        const workpieceFailedDir = path.join(missionDir, "workpiece-failed");

        // RFC-1033: Preserve workpiece for post-failure debugging before cleanup.
        // Rename workpiece/ to workpiece-failed/ and write failure-report.json.
        if (await context.io.exists(workpieceDir)) {
          try {
            // If a previous workpiece-failed/ exists, remove it first
            if (await context.io.exists(workpieceFailedDir)) {
              await context.io.rm(workpieceFailedDir, { recursive: true });
            }
            await context.io.rename(workpieceDir, workpieceFailedDir);
          } catch {
            // best-effort — if rename fails, continue with deletion
          }
        }

        // Write failure-report.json alongside preserved workpiece
        try {
          const failureReport = {
            missionId,
            systemId,
            failedStep,
            error: detail,
            rolledBackAt: new Date().toISOString(),
            preservedAt: (await context.io.exists(workpieceFailedDir))
              ? "missions/" + missionId + "/workpiece-failed"
              : null,
          };
          await context.io.writeFile(
            path.join(missionDir, "failure-report.json"),
            JSON.stringify(failureReport, null, 2) + "\n",
          );
        } catch {
          // best-effort
        }

        // RFC-0985 Measure 7: Write rollback marker before cleanup for crash safety
        try {
          await context.io.writeFile(path.join(missionDir, ".rollback-pending"), missionId);
        } catch {
          // best-effort — mission dir may not exist
        }

        // Remove everything except workpiece-failed/ and failure-report.json
        try {
          const entries = await context.io.readdir(missionDir);
          for (const entry of entries) {
            if (entry.name === "workpiece-failed" || entry.name === "failure-report.json") continue;
            await context.io.rm(path.join(missionDir, entry.name), { recursive: true });
          }
        } catch {
          // best-effort cleanup
        }
        state.currentMission = null;
        await writeSystemState(workspaceRoot, systemId, state);
        await commitWerkstattSideEffects(
          workspaceRoot,
          [path.join("..", "systems-cache", systemId, "system-state.yaml")],
          `werkstatt: mission.open rollback ${missionId}`,
        );
        // RFC-0985 Measure 3: Commit system-state.yaml to cache clone git
        const cacheCloneDir = resolveCacheClonePath(workspaceRoot, systemId);
        if (await context.io.exists(path.join(cacheCloneDir, ".git"))) {
          try {
            await execOrThrow(
              context.io,
              "sh",
              [
                "-c",
                'git add system-state.yaml && git commit -m "mission.open rollback: clear currentMission"',
              ],
              { cwd: cacheCloneDir, env: { MISSION_GIT_COMMIT: "1" } },
            );
          } catch {
            // Non-fatal — system-state.yaml may already be committed or unchanged
          }
        }
        throw new Error(`[mission.open] materialization failed — mission rolled back: ${detail}`);
      }

      throw new Error(
        `[mission.open] step "${failedStep}" failed: ${detail} — run mission.resume --mission ${missionId} to retry`,
      );
    }

    const cc = openCtx;
    return {
      data: {
        missionId,
        systemId,
        state: "open",
        brief,
        openedAt: now,
        pinAtOpen,
        operationId,
        staleEntries,
        materializedAt: cc.materializedAt,
      },
      exitCode: 0,
      summary: `[mission.open] opened and materialized mission ${missionId} for ${systemId}`,
      nextSteps: [
        {
          action: `Validate the workpiece: pnpm exec werkstatt run mission.validate --mission ${missionId}`,
          kind: "optional",
        },
      ],
    };
  } finally {
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }
}

// ---------------------------------------------------------------------------
// RFC-0958: Journal-integrated open steps
// ---------------------------------------------------------------------------

export interface OpenStepCtx {
  workspaceRoot: string;
  systemId: string;
  missionId: string;
  manifest: MissionManifest;
  actor: ReturnType<typeof resolveActor>;
  now: string;
  pinAtOpen: string;
  operationId: string;
  staleEntries: StaleEntryCheck;
  context: KernelRuntimeContext;
  state: SystemState;
  materializedAt: string | null;
}

export async function buildOpenSteps(
  _workspaceRoot: string,
  _missionId: string,
  _ctx: unknown,
): Promise<OperationStep<unknown>[]> {
  const steps: OperationStep<unknown>[] = [
    {
      name: "cache-clone-git-check",
      run: async (c: unknown) => {
        const cc = c as OpenStepCtx;
        // RFC-0985 Measure 4: Pre-flight cache clone git sanity check.
        const cacheDir = resolveCacheClonePath(cc.workspaceRoot, cc.systemId);
        if (!(await cc.context.io.exists(path.join(cacheDir, ".git")))) return;
        // Check detached HEAD
        const symRef = await cc.context.io.exec("git", ["symbolic-ref", "HEAD"], {
          cwd: cacheDir,
        });
        if (symRef.exitCode !== 0) {
          throw new Error(
            `[mission.open] cache clone for '${cc.systemId}' is in detached HEAD. ` +
              `Run: git -C ${cacheDir} checkout main`,
          );
        }
        // Check stale rebase-merge
        if (await cc.context.io.exists(path.join(cacheDir, ".git", "rebase-merge"))) {
          throw new Error(
            `[mission.open] stale rebase-merge found in cache clone for '${cc.systemId}'. ` +
              `Run: git -C ${cacheDir} rebase --abort`,
          );
        }
      },
    },
    {
      name: "rollback-marker-check",
      run: async (c: unknown) => {
        const cc = c as OpenStepCtx;
        // RFC-0985 Measure 7: Crash-safe rollback — if a previous mission.open
        // was killed during rollback, complete the cleanup before proceeding.
        const missionsDir = path.join(cc.workspaceRoot, "missions");
        if (!(await cc.context.io.exists(missionsDir))) return;
        const entries = await cc.context.io.readdir(missionsDir);
        for (const entry of entries) {
          if (!entry.isDirectory || entry.name === "archive") continue;
          const marker = path.join(missionsDir, entry.name, ".rollback-pending");
          if (await cc.context.io.exists(marker)) {
            // Complete the rollback: remove mission dir, clear system-state
            const staleDir = path.join(missionsDir, entry.name);
            try {
              await cc.context.io.rm(staleDir, { recursive: true });
            } catch {
              // best-effort
            }
          }
        }
      },
    },
    {
      name: "write-manifest",
      run: async (c: unknown) => {
        const cc = c as OpenStepCtx;
        await writeMissionManifest(cc.workspaceRoot, cc.manifest);
      },
    },
    {
      name: "bordbuch-append",
      run: async (c: unknown) => {
        const cc = c as OpenStepCtx;
        const { commitResult: pushResult } = await appendAndCommitBordbuch(
          cc.workspaceRoot,
          cc.systemId,
          "mission-open",
          cc.manifest.brief,
          cc.actor,
          {
            missionId: cc.missionId,
            writerRole: "mission",
            metadata: { brief: cc.manifest.brief, pinAtOpen: cc.pinAtOpen },
          },
          `Bordbuch: mission-open ${cc.missionId}`,
        );
        if (pushResult.commitSha === null) {
          throw new Error(
            `[mission.open] bordbuch commit failed for system '${cc.systemId}' — mission-open event was not committed. ` +
              `Check git state in the cache clone and re-run mission.open.`,
          );
        }
        if (!pushResult.pushed) {
          const cacheDir = resolveCacheClonePath(cc.workspaceRoot, cc.systemId);
          try {
            await gitExec(cacheDir, "reset --hard HEAD~1");
          } catch {
            // best-effort rollback
          }
          throw new Error(
            `[mission.open] bordbuch push failed for system '${cc.systemId}' — mission-open event was rolled back. ` +
              `Error: ${pushResult.error ?? "unknown"}. ` +
              `Check git remote connectivity and re-run mission.open.`,
          );
        }
      },
    },
    {
      name: "update-system-state",
      run: async (c: unknown) => {
        const cc = c as OpenStepCtx;
        cc.state.currentMission = cc.missionId;
        await writeSystemState(cc.workspaceRoot, cc.systemId, cc.state);
      },
    },
    {
      name: "auto-materialize",
      run: async (c: unknown) => {
        const cc = c as OpenStepCtx;
        const materializeResult = await runMissionMaterializeInternal(
          cc.workspaceRoot,
          cc.manifest,
          cc.context,
          { reportOnly: false, skipPreflight: false, force: false, skipOperationBlockCheck: true },
        );
        cc.materializedAt = materializeResult.data?.materializedAt ?? null;
      },
    },
    {
      name: "create-scope-registry",
      run: async (c: unknown) => {
        const cc = c as OpenStepCtx;
        const scopeManager = getDefaultScopeManager();
        scopeManager.getRegistry({ scope: "per-mission", missionId: cc.missionId });
      },
    },
    {
      name: "apply-mission-overlay",
      run: async (c: unknown) => {
        const cc = c as OpenStepCtx;
        applyOverlay({
          id: `mission-${cc.missionId}`,
          scope: "per-mission",
          context: { scope: "per-mission", missionId: cc.missionId },
          addOrReplace: new Map(),
          remove: [],
          priority: 100,
        });
      },
    },
    {
      name: "commit-side-effects",
      run: async (c: unknown) => {
        const cc = c as OpenStepCtx;
        await commitWerkstattSideEffects(
          cc.workspaceRoot,
          [path.join("..", "systems-cache", cc.systemId, "system-state.yaml")],
          `werkstatt: mission.open ${cc.missionId}`,
        );
      },
    },
  ];

  return steps;
}
