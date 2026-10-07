/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/mission/mission-close.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0084: abandon-incomplete-operations step before transition-state — sweeps systems-cache operations/*.jsonl for incomplete ops referencing the closing mission and appends op-abandoned, then commits the journal updates to the cache clone.</item>
  <item>RECOVERY-2026-10-04: sweep passes getActiveOpIds() — ops still executing in this process (the ship journal that mission.close runs inside) are excluded so the live ship op is not self-abandoned mid-run.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
  <item>RFC-1159: step 4 — exec.exitcode.lint command, sweep remainder, packages-check wiring</item>
  <item>RFC-1190: restore mission context + evidence archival in release-mode deploys

RFC-1190: precedence-ordered resolveMissionContext (--mission → release build-identity → currentMission), MISSION_CONTEXT_UNRESOLVED/MISMATCH blocking, fail-closed EVIDENCE_SYNC_FAILED with --skip-evidence-sync as sole escape hatch, journaled evidence-sync-* ship steps after each certify-*, evidence.sync --site/--system flag.

2026-10-04 handoff fixes: shared 25min mission.check timeout (inner 5min race + 300s orchestrator raced cold ~7-11min captures), sweep excludeOpIds so mission.close no longer self-abandons the live ship journal (broke --resume), name-keyed journal resume state so closed-mission plan shifts can't skip unexecuted steps, wrangler dev documented as the required --base-url preview server.</item>
  <history>ADR-0010, RFC-0355, RFC-0477, RFC-0480, RFC-0522, RFC-0560, RFC-0580, RFC-0593, RFC-0597, RFC-0652, RFC-0655, RFC-0658, RFC-0703, RFC-0705, RFC-0734, RFC-0762, RFC-0797, RFC-0801, RFC-0820, RFC-0822, RFC-0878, RFC-0913, RFC-0958, RFC-0991, RFC-0992, RFC-1097</history>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { parse as yamlParse } from "yaml";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  readSystemConfigSmart,
  readSystemState,
  writeSystemState,
  resolveCacheClonePath,
  resolveMirrorPath,
  readPassport,
  writePassport,
} from "../sternsystem/registry-io.ts";
import { readMissionManifest, writeMissionManifest, resolveMissionDir } from "./mission-io.ts";
import {
  commitWorkpieceIfDirty,
  countOperatorCommits,
  cacheCloneCommit,
} from "./mission-git-commit.ts";
import { validateBordbuch, type BordbuchViolation } from "../bordbuch/bordbuch-io.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import {
  runMissionValidate,
  type MissionValidateData,
} from "./mission-materialization-commands.ts";
import { acquireLock, releaseLock, commitWerkstattSideEffects } from "../werkstatt/index.ts";
import { gitExec } from "../werkstatt/git-exec.ts";
import { execOrThrow, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import { resolveActor } from "./actor-identity.ts";
import { persistEnvFilesToCacheClone } from "./env-persist.ts";
import { persistOperatorConfigFiles } from "./operator-config-files.ts";
import { runOperation, getActiveOpIds } from "../journal/runner.ts";
import { checkDifferentKindOperation } from "../journal/index.ts";
import {
  abandonIncompleteOperationsForMission,
  findIncompleteOperationsForMission,
  referencesMissionId,
} from "../journal/sweep.ts";
import type { OperationStep, OperationDefinition } from "../journal/index.ts";
import { getDefaultScopeManager } from "../scope/scope.ts";
import { removeOverlay } from "../runtime/overlay-store.ts";

// RFC-0597: Media cache directories to persist across missions
const MEDIA_CACHE_DIRS = [".cache/video", ".cache/video-live"];

async function copyDirRecursive(src: string, dest: string, io: WorkspaceIO): Promise<void> {
  await io.mkdir(dest);
  const entries = await io.readdir(src);
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory) {
      await copyDirRecursive(srcPath, destPath, io);
    } else {
      await io.copyFile(srcPath, destPath);
    }
  }
}

export interface CloseReportGit {
  commitSha: string | null;
  pushed: boolean;
  pushError: string | null;
  dirtyFiles: string[];
}

export interface CloseReportMirror {
  originSha: string | null;
  mirrorSha: string | null;
  inSync: boolean;
  recommendation: string | null;
  synced: boolean;
  syncError: string | null;
}

export interface CloseReportReconcile {
  reconciledAt: string;
  verified: boolean;
  freshnessChecked: boolean;
  unreconciledCommits: number;
  workpieceHead: string | null;
  reconciledSha: string | null;
}

export interface CloseReportTemplateSync {
  synced: boolean;
  syncError: string | null;
}

export interface CloseReport {
  releaseId: string | null;
  git: CloseReportGit;
  mirror: CloseReportMirror;
  reconcile: CloseReportReconcile;
  templateSync: CloseReportTemplateSync;
  warnings: Array<{ rule: string; message: string }>;
}

export interface MissionCloseData {
  missionId: string;
  systemId: string;
  state: "closed";
  closedAt: string;
  releaseId: string | null;
  closeReport: CloseReport;
  evidenceSynced: boolean;
  evidenceSyncResult: { r2KeyPrefix: string; uploadedFiles: number } | null;
  bordbuchValidation: { violations: BordbuchViolation[]; checked: boolean };
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBoolean(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

async function runInlineValidate(
  missionId: string,
  context: KernelRuntimeContext,
): Promise<{ passed: boolean; failures: string[]; report: MissionValidateData | null }> {
  const syntheticInput: KernelCommandInput = {
    argv: [],
    flags: { mission: missionId, "skip-auto-commit": true },
  };
  const result = await runMissionValidate(syntheticInput, context);
  if (result.exitCode !== 1) {
    return { passed: true, failures: [], report: result.data ?? null };
  }
  const failures: string[] = [];
  if (result.data?.contractFull?.validators) {
    for (const v of result.data.contractFull.validators) {
      if (v.status === "fail") {
        failures.push(`${v.name}: exit code ${v.exitCode}`);
      }
    }
  }
  if (failures.length === 0 && result.summary) {
    failures.push(result.summary);
  }
  if (result.data) {
    failures.push(`See evidence/validation-report.json for details`);
  }
  return { passed: false, failures, report: result.data ?? null };
}

async function updateReconcileReportHead(
  evidenceDir: string,
  commitSha: string | null,
  io: WorkspaceIO,
): Promise<void> {
  try {
    const reconcileReportPath = path.join(evidenceDir, "reconciliation-report.json");
    if (await io.exists(reconcileReportPath)) {
      const report = JSON.parse(await io.readFile(reconcileReportPath));
      report.workpieceHeadAtReconcile = commitSha;
      await atomicWriteFile(reconcileReportPath, JSON.stringify(report, null, 2) + "\n");
    }
  } catch {
    // Non-fatal
  }
}

export async function runMissionClose(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionCloseData>> {
  const { workspaceRoot, logger } = context;
  const missionId = flagString(input, "mission");
  const actor = resolveActor(input);
  const releaseIdFlag = flagString(input, "release");
  const skipEvidenceSync = flagBoolean(input, "skip-evidence-sync");
  const skipAutoSync = flagBoolean(input, "skip-auto-sync");
  const skipTemplateSync = flagBoolean(input, "skip-template-sync");
  const allowNoOp = flagBoolean(input, "allow-no-op");
  const skipReconcileCheck = flagBoolean(input, "skip-reconcile-check");

  if (!missionId) throw new Error("[mission.close] --mission is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);

  // RFC-0522: releaseId precedence — flag overrides manifest (written by release.prepare)
  const releaseId = releaseIdFlag ?? manifest.releaseId ?? null;

  if (manifest.state !== "open") {
    throw new Error(
      `[mission.close] mission '${missionId}' is not open (state: ${manifest.state})`,
    );
  }

  if (!manifest.reconciledAt) {
    throw new Error(
      `[mission.close] mission '${missionId}' has not been reconciled — run mission.reconcile first`,
    );
  }

  // RFC-0800: Auto-sync template dependencies from workpiece to template BEFORE inline validate.
  // Placed here so the drift check (in SITES_BUILD_CHECK_PIPELINE via mission.validate)
  // passes after the template is synced. If sync fails (non-fatal), the drift check
  // catches the residual drift and blocks close — safety net working as intended.
  // The template file is committed later via commitWerkstattSideEffects.
  let templateSyncResult: CloseReportTemplateSync = { synced: false, syncError: null };
  if (!skipTemplateSync) {
    try {
      const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
      logger.info(`  Auto-syncing template dependencies from workpiece…`);
      const syncResult = (await executeKernelCommand({
        workspaceRoot,
        commandName: "config.template.sync",
        argv: [`--site=${manifest.systemId}`],
      })) as { exitCode?: number; summary?: string };
      const syncExitCode = syncResult.exitCode ?? 0;
      if (syncExitCode !== 0) {
        const syncError =
          syncResult.summary ?? `config.template.sync exited with code ${syncExitCode}`;
        logger.warn(`  Template sync failed (non-fatal): ${syncError}`);
        templateSyncResult = { synced: false, syncError };
      } else {
        templateSyncResult = { synced: true, syncError: null };
        logger.info(`  Template dependencies synced`);
      }
    } catch (syncErr) {
      const errMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
      logger.warn(`  Template sync threw (non-fatal): ${errMsg}`);
      templateSyncResult = { synced: false, syncError: errMsg };
    }
  }

  // RFC-0593: inline validation gate — run mission.validate before acquiring locks.
  // This avoids holding registry/system/mission locks for 2+ minutes during the build.
  // State is re-checked inside the lock after validation passes.
  const validationCheck = await runInlineValidate(missionId, context);
  if (!validationCheck.passed) {
    const failureLines = validationCheck.failures.map((f) => `  ${f}`).join("\n");
    throw new Error(
      `[mission.close] validation failed for mission '${missionId}' — fix issues and re-run mission.validate\n${failureLines}`,
    );
  }

  await acquireLock(
    workspaceRoot,
    `system:${manifest.systemId}`,
    manifest.operationId,
    "mission.close",
    actor,
  );
  await acquireLock(
    workspaceRoot,
    `mission:${missionId}`,
    manifest.operationId,
    "mission.close",
    actor,
  );

  try {
    // RFC-0593: re-read manifest inside lock and re-check state — between out-of-lock
    // validation and lock acquisition, another process could have aborted the mission.
    const lockedManifest = await readMissionManifest(workspaceRoot, missionId);
    if (lockedManifest.state !== "open") {
      throw new Error(
        `[mission.close] mission '${missionId}' state changed to '${lockedManifest.state}' during validation — aborting close`,
      );
    }

    const now = new Date().toISOString();
    const missionDir = await resolveMissionDir(workspaceRoot, missionId, context.io);
    const workpieceDir = path.join(missionDir, "workpiece");
    const evidenceDir = path.join(missionDir, "evidence");
    await context.io.mkdir(evidenceDir);

    // RFC-0958: Build step context and run post-lock lifecycle via journal
    const stepCtx: CloseStepCtx = {
      workspaceRoot,
      missionId,
      missionDir,
      workpieceDir,
      evidenceDir,
      manifest: lockedManifest,
      actor,
      releaseId,
      now,
      skipEvidenceSync,
      skipAutoSync,
      skipReconcileCheck,
      allowNoOp,
      skipContentRegression: flagBoolean(input, "skip-content-regression"),
      skipBehaviorSnapshot: flagBoolean(input, "skip-behavior-snapshot"),
      context,
      templateSyncResult,
      closeReport: null,
      evidenceSynced: false,
      evidenceSyncResult: null,
      freshnessChecked: false,
      unreconciledCommits: 0,
      workpieceHead: null,
      reconciledSha: null,
      originSha: null,
      mirrorSha: null,
      mirrorInSync: false,
      recommendation: null,
    };

    const steps = await buildCloseSteps(workspaceRoot, missionId, stepCtx);
    const journalPath = path.join(missionDir, "journal.jsonl");

    // RFC-0958 Step 7: block if a different-kind operation is incomplete
    const blockCheck = await checkDifferentKindOperation(journalPath, "mission.close");
    if (blockCheck.blocked) {
      return {
        data: {
          missionId,
          closed: false,
          blockedByOperation: blockCheck.incompleteOp,
        } as unknown as MissionCloseData,
        exitCode: 1,
        summary: `[mission.close] ${missionId} blocked: incomplete '${blockCheck.incompleteOp}' operation found in journal`,
        nextSteps: [
          {
            action: `Run: pnpm exec werkstatt run mission.resume --mission ${missionId} to resume or abandon the incomplete operation`,
            kind: "required",
          },
        ],
      };
    }

    const def: OperationDefinition<unknown> = { op: "mission.close", steps };
    const opResult = await runOperation(journalPath, def, stepCtx, {
      missionId,
      platformVersion: "",
    });

    if (!opResult.completed) {
      const detail = opResult.failedStepError ?? "unknown error";
      throw new Error(
        `[mission.close] step "${opResult.failedStep}" failed: ${detail} — run mission.resume --mission ${missionId} to retry`,
      );
    }

    const cc = stepCtx;
    return {
      data: {
        missionId,
        systemId: cc.manifest.systemId,
        state: "closed",
        closedAt: now,
        releaseId,
        closeReport: cc.closeReport!,
        evidenceSynced: cc.evidenceSynced,
        evidenceSyncResult: cc.evidenceSyncResult,
        bordbuchValidation: { violations: [], checked: true },
      },
      summary: `[mission.close] closed mission ${missionId}`,
      nextSteps: [
        {
          action: `Prepare a release: pnpm exec werkstatt run release.prepare --mission ${missionId}`,
          kind: "optional",
        },
        {
          action: `Archive the mission: pnpm exec forge run docs.archive`,
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
// RFC-0958: Journal-integrated close steps
// ---------------------------------------------------------------------------

export interface CloseStepCtx {
  workspaceRoot: string;
  missionId: string;
  missionDir: string;
  workpieceDir: string;
  evidenceDir: string;
  manifest: import("@warpgogol/werkstatt-engine/schemas").MissionManifest;
  actor: ReturnType<typeof resolveActor>;
  releaseId: string | null;
  now: string;
  skipEvidenceSync: boolean;
  skipAutoSync: boolean;
  skipReconcileCheck: boolean;
  allowNoOp: boolean;
  skipContentRegression: boolean;
  skipBehaviorSnapshot: boolean;
  context: KernelRuntimeContext;
  templateSyncResult: CloseReportTemplateSync;
  closeReport: CloseReport | null;
  evidenceSynced: boolean;
  evidenceSyncResult: { r2KeyPrefix: string; uploadedFiles: number } | null;
  freshnessChecked: boolean;
  unreconciledCommits: number;
  workpieceHead: string | null;
  reconciledSha: string | null;
  originSha: string | null;
  mirrorSha: string | null;
  mirrorInSync: boolean;
  recommendation: string | null;
}

export async function buildCloseSteps(
  workspaceRoot: string,
  missionId: string,
  manifest: unknown,
): Promise<OperationStep<unknown>[]> {
  const ctx = manifest as CloseStepCtx;
  const logger = ctx.context.logger;

  const steps: OperationStep<unknown>[] = [
    {
      name: "stop-dev-servers",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        if (await cc.context.io.exists(cc.workpieceDir)) {
          // Best-effort — a non-zero exit just means no server was running.
          await execOrThrow(cc.context.io, "pnpm", ["run", "stop"], {
            cwd: cc.workpieceDir,
          }).catch(() => {});
        }
      },
      verify: async () => true,
    },
    {
      name: "auto-commit-workpiece",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const workpieceCommit = await commitWorkpieceIfDirty(
          cc.workpieceDir,
          cc.missionId,
          undefined,
          cc.context.io,
        );
        if (workpieceCommit.committed) {
          logger.info(
            `  Auto-committed dirty workpiece (${workpieceCommit.commitSha?.slice(0, 8)}) before close`,
          );
          await updateReconcileReportHead(cc.evidenceDir, workpieceCommit.commitSha, cc.context.io);
        }
      },
    },
    {
      name: "behavior-snapshot-refresh",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        if (cc.skipBehaviorSnapshot) {
          logger.info("  [behavior-snapshot-refresh] Skipped by --skip-behavior-snapshot");
          return;
        }
        try {
          const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
          await executeKernelCommand({
            workspaceRoot: cc.workspaceRoot,
            commandName: "behavior.snapshot.generate",
            siteName: cc.manifest.systemId,
          });
          const snapshotCommit = await commitWorkpieceIfDirty(
            cc.workpieceDir,
            cc.missionId,
            "behavior-snapshot-refresh",
            cc.context.io,
          );
          if (snapshotCommit.committed) {
            await updateReconcileReportHead(
              cc.evidenceDir,
              snapshotCommit.commitSha,
              cc.context.io,
            );
          }
          logger.info("  [behavior-snapshot-refresh] Snapshot regenerated and committed");
        } catch (err) {
          logger.warn(
            `  [behavior-snapshot-refresh] Non-fatal: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    },
    {
      name: "zero-commit-guard",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        if (!cc.allowNoOp) {
          const operatorCommits = await countOperatorCommits(
            cc.workpieceDir,
            cc.manifest.migratedAt,
            cc.context.io,
          );
          if (!operatorCommits.hasOperatorCommits) {
            throw new Error(
              `[mission.close] ZERO-COMMIT-GUARD: Mission '${cc.missionId}' has zero operator commits since materialization.\n` +
                `  Brief: "${cc.manifest.brief}"\n` +
                `  If this is a legitimate no-op mission, re-run with --allow-no-op.`,
            );
          }
        }
      },
    },
    {
      name: "reconcile-freshness-check",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        if (!cc.skipReconcileCheck) {
          const reconcileReportPath = path.join(cc.evidenceDir, "reconciliation-report.json");
          let reconciledWorkpieceSha: string | null = null;
          try {
            const report = JSON.parse(await cc.context.io.readFile(reconcileReportPath));
            reconciledWorkpieceSha = report.workpieceHeadAtReconcile ?? null;
          } catch {
            throw new Error(
              `[mission.close] reconciliation report not found — re-run mission.reconcile or use --skip-reconcile-check`,
            );
          }
          if (!reconciledWorkpieceSha) {
            throw new Error(
              `[mission.close] reconciliation report missing workpieceHeadAtReconcile field`,
            );
          }
          cc.workpieceHead = await gitExec(cc.workpieceDir, "rev-parse HEAD");
          cc.reconciledSha = reconciledWorkpieceSha;
          if (cc.workpieceHead !== reconciledWorkpieceSha) {
            try {
              const countOutput = await gitExec(
                cc.workpieceDir,
                `rev-list --count ${reconciledWorkpieceSha}..${cc.workpieceHead}`,
              );
              cc.unreconciledCommits = parseInt(countOutput, 10);
            } catch {
              cc.unreconciledCommits = 0;
            }
            throw new Error(
              `[mission.close] mission '${cc.missionId}' has ${cc.unreconciledCommits} unreconciled commit(s)`,
            );
          }
          cc.freshnessChecked = true;
        }
      },
    },
    {
      name: "create-git-bundle",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        if (await cc.context.io.exists(path.join(cc.workpieceDir, ".git"))) {
          const bundlePath = path.join(cc.evidenceDir, "workpiece.git-bundle");
          try {
            await gitExec(
              cc.workpieceDir,
              `bundle create ${JSON.stringify(bundlePath)} --all`,
              undefined,
              cc.context.io,
            );
          } catch {
            // Non-fatal
          }
        }
      },
    },
    {
      name: "mirror-sync-check",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const config = await readSystemConfigSmart(cc.workspaceRoot, cc.manifest.systemId);
        if (config && config.mirrors.length > 1) {
          const preCheckSystemDir = await resolveCacheClonePath(
            cc.workspaceRoot,
            cc.manifest.systemId,
          );
          if (await cc.context.io.exists(path.join(preCheckSystemDir, ".git"))) {
            try {
              const branch = await gitExec(preCheckSystemDir, "rev-parse --abbrev-ref HEAD");
              await gitExec(preCheckSystemDir, `push origin ${JSON.stringify(branch)}`);
              logger.info(`  Pushed cache clone to origin before mirror sync check`);
            } catch (pushErr) {
              logger.warn(
                `  Could not push cache clone to origin: ${pushErr instanceof Error ? pushErr.message : String(pushErr)}`,
              );
            }
          }
          if (!cc.skipAutoSync && config.mirrors.length > 2) {
            try {
              const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
              logger.info(`  Syncing mirrors before mirror sync check…`);
              await executeKernelCommand({
                workspaceRoot: cc.workspaceRoot,
                commandName: "sternsystem.sync",
                argv: [`--id=${cc.manifest.systemId}`],
              });
            } catch (syncErr) {
              logger.warn(
                `  Pre-check mirror sync failed (non-fatal): ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
              );
            }
          }
          const bareMirror = config.mirrors[1];
          const bareRepoPath = resolveMirrorPath(cc.workspaceRoot, bareMirror.path);
          if (await cc.context.io.exists(bareRepoPath)) {
            try {
              let branch: string;
              try {
                branch = (
                  await gitExec(bareRepoPath, "symbolic-ref HEAD", undefined, cc.context.io)
                ).replace("refs/heads/", "");
              } catch {
                branch = "main";
              }
              try {
                cc.originSha = await gitExec(bareRepoPath, `rev-parse ${branch}`);
              } catch {
                cc.originSha = null;
              }
              if (config.mirrors.length > 2) {
                try {
                  cc.mirrorSha = await gitExec(bareRepoPath, `rev-parse refs/mirror/${branch}`);
                } catch {
                  cc.mirrorSha = null;
                }
              }
            } catch {
              // bare repo not accessible
            }
          }
          if (cc.originSha && cc.mirrorSha && cc.originSha !== cc.mirrorSha) {
            cc.mirrorInSync = false;
            cc.recommendation = `Run: sternsystem.sync --id ${cc.manifest.systemId}`;
          } else if (cc.originSha && cc.mirrorSha && cc.originSha === cc.mirrorSha) {
            cc.mirrorInSync = true;
          } else if (config.mirrors.length > 2 && !cc.mirrorSha) {
            cc.mirrorInSync = false;
            cc.recommendation = `Mirror ref not found. Run: sternsystem.sync --id ${cc.manifest.systemId}`;
          } else {
            cc.mirrorInSync = true;
          }
          if (config.mirrors.length > 2 && !cc.mirrorInSync) {
            throw new Error(
              `[mission.close] external mirrors are out of sync for system '${cc.manifest.systemId}'. ${cc.recommendation ?? ""}`,
            );
          }
        } else {
          cc.mirrorInSync = true;
        }
      },
    },
    {
      // ADR-0084: abandon every incomplete journal operation belonging to this
      // mission before the state transition — an op that outlives its mission
      // is definitionally stale and must not stay resumable.
      name: "abandon-incomplete-operations",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const systemDir = await resolveCacheClonePath(cc.workspaceRoot, cc.manifest.systemId);
        const operationsDir = path.join(systemDir, "operations");
        if (!(await cc.context.io.exists(operationsDir))) {
          return;
        }
        // Exclude ops still executing in this process — the sweep itself runs
        // inside leitstand.ship's journal op, and abandoning that live journal
        // marks the ship terminal mid-run (observed 2026-10-04: --resume then
        // reported "nothing to resume" for a genuinely failed certify-dev).
        const sweep = await abandonIncompleteOperationsForMission(
          operationsDir,
          cc.missionId,
          getActiveOpIds(),
        );
        // Fail closed when a journal file that may reference this mission is
        // unreadable — we cannot prove no resumable op remains.
        const blocking = sweep.unreadableFiles.filter((f) => referencesMissionId(f, cc.missionId));
        if (blocking.length > 0) {
          throw new Error(
            `[mission.close] cannot verify journal operations — unreadable file(s): ${blocking.join(", ")}`,
          );
        }
        for (const file of sweep.unreadableFiles) {
          logger.warn(`  [abandon-incomplete-operations] unreadable journal file skipped: ${file}`);
        }
        if (sweep.abandoned.length === 0) {
          return;
        }
        for (const op of sweep.abandoned) {
          logger.info(`  [abandon-incomplete-operations] abandoned ${op.op} (${op.opId})`);
        }
        try {
          const touched = [...new Set(sweep.abandoned.map((op) => op.journalPath))];
          for (const journalPath of touched) {
            await gitExec(
              systemDir,
              `add ${JSON.stringify(path.relative(systemDir, journalPath))}`,
            );
          }
          await cacheCloneCommit(
            systemDir,
            `journal: abandon incomplete operations for ${cc.missionId}`,
          );
        } catch (commitErr) {
          logger.warn(
            `  [abandon-incomplete-operations] could not commit journal updates (non-fatal): ${commitErr instanceof Error ? commitErr.message : String(commitErr)}`,
          );
        }
      },
      verify: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const systemDir = await resolveCacheClonePath(cc.workspaceRoot, cc.manifest.systemId);
        const operationsDir = path.join(systemDir, "operations");
        if (!(await cc.context.io.exists(operationsDir))) {
          return true;
        }
        try {
          const scan = await findIncompleteOperationsForMission(
            operationsDir,
            cc.missionId,
            cc.context.io,
            getActiveOpIds(),
          );
          return scan.incomplete.length === 0 && scan.unreadableFiles.length === 0;
        } catch {
          return false;
        }
      },
    },
    {
      name: "transition-state",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        cc.manifest.state = "closed";
        cc.manifest.closedAt = cc.now;
        cc.manifest.closedBy = cc.actor;
        cc.manifest.releaseId = cc.releaseId;
        await writeMissionManifest(cc.workspaceRoot, cc.manifest);
      },
      verify: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const reRead = await readMissionManifest(cc.workspaceRoot, cc.missionId);
        return reRead.state === "closed";
      },
    },
    {
      name: "bordbuch-validate-and-append",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const bordbuchCheck = await validateBordbuch(cc.workspaceRoot, cc.manifest.systemId);
        if (bordbuchCheck.violations.length > 0) {
          const violationLines = bordbuchCheck.violations
            .map((v) => `  [${v.rule}] ${v.message}`)
            .join("\n");
          throw new Error(
            `[mission.close] bordbuch has ${bordbuchCheck.violations.length} violation(s) — run bordbuch.repair first\n${violationLines}`,
          );
        }
        await appendAndCommitBordbuch(
          cc.workspaceRoot,
          cc.manifest.systemId,
          "mission-close",
          `Mission ${cc.missionId} closed`,
          cc.actor,
          {
            missionId: cc.missionId,
            releaseId: cc.releaseId,
            writerRole: "mission",
            metadata: cc.releaseId ? { releaseId: cc.releaseId } : undefined,
          },
          `Bordbuch: mission-close ${cc.missionId}`,
        );
      },
    },
    {
      name: "evidence-sync",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        if (cc.skipEvidenceSync) {
          logger.warn(
            `  Evidence sync skipped — local evidence will be lost when mission.cleanup runs`,
          );
          try {
            await appendAndCommitBordbuch(
              cc.workspaceRoot,
              cc.manifest.systemId,
              "mission-close",
              `mission-close-evidence-skipped: ${cc.missionId}`,
              cc.actor,
              {
                missionId: cc.missionId,
                writerRole: "mission",
                metadata: { evidenceSyncSkipped: true, reason: "operator-used-skip-evidence-sync" },
              },
              `Bordbuch: mission-close-evidence-skipped ${cc.missionId}`,
            );
          } catch (bordbuchErr) {
            logger.warn(
              `  Warning: failed to append evidence-skipped Bordbuch entry: ${bordbuchErr instanceof Error ? bordbuchErr.message : String(bordbuchErr)}`,
            );
          }
          return;
        }
        const axiomEvidenceDir = path.join(cc.missionDir, "evidence", "axiom");
        const metadataPath = path.join(axiomEvidenceDir, "evidence-metadata.json");
        if (
          (await cc.context.io.exists(axiomEvidenceDir)) &&
          (await cc.context.io.exists(metadataPath))
        ) {
          try {
            const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
            const syncResult = (await executeKernelCommand({
              workspaceRoot: cc.workspaceRoot,
              commandName: "evidence.sync",
              argv: [`--mission=${cc.missionId}`],
            })) as {
              data?: { r2KeyPrefix?: string; uploadedFiles?: string[] };
              exitCode?: number;
            };
            cc.evidenceSynced = true;
            const syncData = syncResult.data;
            if (syncData) {
              cc.evidenceSyncResult = {
                r2KeyPrefix: syncData.r2KeyPrefix ?? "",
                uploadedFiles: syncData.uploadedFiles?.length ?? 0,
              };
            }
            logger.info(`  Evidence synced to R2`);
          } catch (syncError) {
            logger.error(
              `  Evidence sync failed — mission cannot close without archiving evidence`,
            );
            throw new Error(
              `EVIDENCE_SYNC_FAILED: ${syncError instanceof Error ? syncError.message : String(syncError)}`,
            );
          }
        } else if (await cc.context.io.exists(axiomEvidenceDir)) {
          logger.warn(
            `  Evidence directory exists but evidence-metadata.json is missing — skipping sync`,
          );
        }
      },
    },
    {
      name: "passport-refresh",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const logger = cc.context.logger;
        try {
          const existingPassport = await readPassport(cc.workspaceRoot, cc.manifest.systemId);
          if (!existingPassport) {
            logger.info(
              `  [passport-refresh] No existing passport — skipping (run sternsystem.passport.generate to create)`,
            );
            return;
          }

          const privateKeyEnv = process.env.SIGNING_PRIVATE_KEY;
          const privateKeyPath = process.env.SIGNING_PRIVATE_KEY_PATH;
          if (!privateKeyEnv && !privateKeyPath) {
            logger.info(
              `  [passport-refresh] No signing key configured — skipping passport refresh`,
            );
            return;
          }

          let privateKeyBytes: Uint8Array;
          // Dynamic import avoids circular dependency at module load time
          const { loadPrivateKey } = await import("@warpgogol/werkstatt-engine/signing");
          const { buildPassportPayload, signPassport, derivePublicKey } =
            await import("../sternsystem/passport.ts");
          try {
            if (privateKeyEnv) {
              privateKeyBytes = await loadPrivateKey({ pem: privateKeyEnv });
            } else {
              privateKeyBytes = await loadPrivateKey({
                filePath: privateKeyPath!,
                encoding: "pem",
              });
            }
          } catch {
            logger.info(
              `  [passport-refresh] Failed to load signing key — skipping passport refresh`,
            );
            return;
          }

          const creatorPublicKey = await derivePublicKey(privateKeyBytes);
          const payload = await buildPassportPayload({
            systemId: cc.manifest.systemId,
            werkstattRoot: cc.workspaceRoot,
            creatorIdentity: existingPassport.payload.creator.identity,
            creatorPublicKey,
          });
          payload.provenance.createdAt = existingPassport.payload.provenance.createdAt;
          payload.provenance.generatedAt = existingPassport.payload.provenance.generatedAt;
          const { passportHash, signature } = await signPassport(payload, privateKeyBytes);

          if (passportHash === existingPassport.passportHash) {
            logger.info(`  [passport-refresh] Passport unchanged — no write needed`);
            return;
          }

          await writePassport(cc.workspaceRoot, cc.manifest.systemId, {
            payload,
            passportHash,
            signature,
          });
          // Stage passport.json so subsequent commit steps include it
          const cacheClonePath = resolveCacheClonePath(cc.workspaceRoot, cc.manifest.systemId);
          await execOrThrow(cc.context.io, "git", ["-C", cacheClonePath, "add", "passport.json"]);
          logger.success(`  [passport-refresh] Passport refreshed (hash: ${passportHash})`);
        } catch (err) {
          logger.warn(
            `  [passport-refresh] Non-fatal error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    },
    {
      name: "ownership-register",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const logger = cc.context.logger;
        try {
          const registryUrl = process.env.FLEET_OWNERSHIP_REGISTRY_URL;
          if (!registryUrl) {
            logger.info(
              `  [ownership-register] FLEET_OWNERSHIP_REGISTRY_URL not set — skipping ownership registration`,
            );
            return;
          }

          const { registerOwnership, OwnershipError } =
            await import("../fleet/ownership-registry.ts");
          try {
            const result = await registerOwnership({
              systemId: cc.manifest.systemId,
              werkstattRoot: cc.workspaceRoot,
              registryUrl,
            });

            if (!result.registered && result.conflict) {
              logger.warn(
                `  [ownership-register] Conflict: site already claimed by ${result.conflict.existingClaim?.instanceId ?? "unknown"} (OWNERSHIP-03)`,
              );
              return;
            }

            logger.success(
              `  [ownership-register] Site registered (hash: ${result.claim.passportHash})`,
            );
          } catch (err) {
            if (err instanceof OwnershipError) {
              logger.warn(`  [ownership-register] Non-fatal error (${err.code}): ${err.message}`);
            } else {
              throw err;
            }
          }
        } catch (err) {
          logger.warn(
            `  [ownership-register] Non-fatal error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    },
    {
      // RFC-1124: publish the signed fleet claim — the authoritative ownership
      // record. Non-fatal: workshops without werkstatt.fleet.json or a signing
      // key skip silently; push failure is retried by sternsystem.sync.
      name: "claims-publish",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const logger = cc.context.logger;
        try {
          const { loadFleetClaimsConfig, loadSigningKeyFromEnv, publishClaim } =
            await import("../fleet/claims-repo.ts");
          if (!(await loadFleetClaimsConfig(cc.workspaceRoot))) return;
          const signingKey = await loadSigningKeyFromEnv();
          if (!signingKey) return;
          const result = await publishClaim({
            systemId: cc.manifest.systemId,
            werkstattRoot: cc.workspaceRoot,
            signerPrivateKeyHex: signingKey.privateKeyHex,
            signerPublicKey: signingKey.publicKeyHex,
          });
          logger.success(
            `  [claims-publish] Fleet claim published (hash: ${result.claim.passportHash.slice(0, 16)}${result.pushed ? ", pushed" : ", local-only"})`,
          );
        } catch (err) {
          logger.warn(
            `  [claims-publish] Non-fatal error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    },
    {
      name: "write-close-report",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const systemDir = await resolveCacheClonePath(cc.workspaceRoot, cc.manifest.systemId);
        let dirtyFiles: string[] = [];
        try {
          const status = await gitExec(systemDir, "status --porcelain");
          dirtyFiles = status
            .split("\n")
            .filter((l) => l.trim().length > 0)
            .map((l) => l.slice(3));
        } catch {
          dirtyFiles = [];
        }
        const warnings: Array<{ rule: string; message: string }> = [];
        if (!cc.releaseId) {
          warnings.push({
            rule: "missing-release-id",
            message:
              "Mission closed without release — releaseId is null. Run release.prepare after close.",
          });
        }
        if (cc.skipReconcileCheck) {
          try {
            await appendAndCommitBordbuch(
              cc.workspaceRoot,
              cc.manifest.systemId,
              "mission-close",
              `mission-close-reconcile-check-skipped: ${cc.missionId}`,
              cc.actor,
              {
                missionId: cc.missionId,
                writerRole: "mission",
                metadata: {
                  reconcileCheckSkipped: true,
                  reason: "operator-used-skip-reconcile-check",
                },
              },
              `Bordbuch: mission-close-reconcile-check-skipped ${cc.missionId}`,
            );
          } catch (bordbuchErr) {
            logger.warn(
              `  Warning: failed to append reconcile-check-skipped Bordbuch entry: ${bordbuchErr instanceof Error ? bordbuchErr.message : String(bordbuchErr)}`,
            );
          }
        }
        cc.closeReport = {
          releaseId: cc.releaseId,
          git: {
            commitSha: null,
            pushed: false,
            pushError: null,
            dirtyFiles,
          },
          mirror: {
            originSha: cc.originSha,
            mirrorSha: cc.mirrorSha,
            inSync: cc.mirrorInSync,
            recommendation: cc.recommendation,
            synced: false,
            syncError: null,
          },
          reconcile: {
            reconciledAt: cc.manifest.reconciledAt ?? "",
            verified: true,
            freshnessChecked: cc.freshnessChecked,
            unreconciledCommits: cc.unreconciledCommits,
            workpieceHead: cc.workpieceHead,
            reconciledSha: cc.reconciledSha,
          },
          templateSync: cc.templateSyncResult,
          warnings,
        };
        const evidencePath = path.join(cc.missionDir, "evidence", "close-report.json");
        await atomicWriteFile(evidencePath, JSON.stringify(cc.closeReport, null, 2) + "\n");
      },
      verify: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        return await cc.context.io.exists(
          path.join(cc.missionDir, "evidence", "close-report.json"),
        );
      },
    },
    {
      name: "update-system-state",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const closeState = await readSystemState(cc.workspaceRoot, cc.manifest.systemId);
        if (closeState.currentMission === cc.missionId) {
          closeState.currentMission = null;
          await writeSystemState(cc.workspaceRoot, cc.manifest.systemId, closeState);
        }
      },
    },
    {
      name: "auto-pin-platform-version",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        try {
          const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
          const pinResult = (await executeKernelCommand({
            workspaceRoot: cc.workspaceRoot,
            commandName: "sternsystem.pin",
            argv: [`--id=${cc.manifest.systemId}`],
          })) as { exitCode?: number; summary?: string };
          const pinExitCode = pinResult.exitCode ?? 0;
          if (pinExitCode !== 0) {
            throw new Error(
              `sternsystem.pin failed with exitCode ${pinExitCode}: ${pinResult.summary ?? "no summary"}`,
            );
          }
          logger.info(`  Auto-pinned platform version for ${cc.manifest.systemId}`);
        } catch (pinError) {
          throw new Error(
            `[mission.close] sternsystem.pin failed: ${pinError instanceof Error ? pinError.message : String(pinError)}`,
          );
        }
        try {
          const systemDir = await resolveCacheClonePath(cc.workspaceRoot, cc.manifest.systemId);
          await gitExec(systemDir, "add system.pin.json system-config.yaml");
          await cacheCloneCommit(systemDir, `chore: auto-pin platform version for ${cc.missionId}`);
          logger.info(`  Committed system.pin.json to cache clone`);
        } catch (pinCommitError) {
          logger.warn(
            `  Could not commit system.pin.json: ${pinCommitError instanceof Error ? pinCommitError.message : String(pinCommitError)}`,
          );
        }
      },
    },
    {
      name: "commit-werkstatt-side-effects",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        await commitWerkstattSideEffects(
          cc.workspaceRoot,
          [
            path.join("missions", cc.missionId, "mission.yaml"),
            "packages/werkstatt-site/src/onboarding/templates/package.template.json",
          ],
          `werkstatt: mission.close ${cc.missionId}`,
        );
      },
    },
    {
      name: "sync-external-mirrors",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const config = await readSystemConfigSmart(cc.workspaceRoot, cc.manifest.systemId);
        if (config && config.mirrors.length > 2) {
          try {
            const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
            logger.info(`  Syncing external mirrors via sternsystem.sync…`);
            const syncResult = (await executeKernelCommand({
              workspaceRoot: cc.workspaceRoot,
              commandName: "sternsystem.sync",
              argv: [`--id=${cc.manifest.systemId}`],
            })) as { exitCode?: number; summary?: string };
            const syncExitCode = syncResult.exitCode ?? 0;
            if (syncExitCode !== 0) {
              const syncError =
                syncResult.summary ?? `sternsystem.sync exited with code ${syncExitCode}`;
              logger.warn(
                `[mission.close] sternsystem.sync failed — run manually: sternsystem.sync --id ${cc.manifest.systemId}`,
              );
              if (cc.closeReport) {
                cc.closeReport.mirror.synced = false;
                cc.closeReport.mirror.syncError = syncError;
              }
            } else {
              if (cc.closeReport) {
                cc.closeReport.mirror.synced = true;
                cc.closeReport.mirror.syncError = null;
              }
              logger.info(`  External mirrors synced`);
            }
          } catch (syncErr) {
            logger.warn(
              `[mission.close] sternsystem.sync threw — run manually: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
            );
            if (cc.closeReport) {
              cc.closeReport.mirror.synced = false;
              cc.closeReport.mirror.syncError =
                syncErr instanceof Error ? syncErr.message : String(syncErr);
            }
          }
        }
      },
    },
    {
      name: "write-materialization-state",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        try {
          const systemDir = await resolveCacheClonePath(cc.workspaceRoot, cc.manifest.systemId);
          let cacheCloneHead: string | null = null;
          try {
            cacheCloneHead = await gitExec(systemDir, "rev-parse HEAD", undefined, cc.context.io);
          } catch {
            // skip
          }
          if (cacheCloneHead) {
            const stateFile = {
              systemId: cc.manifest.systemId,
              cacheCloneHead,
              lastValidatedAt: cc.now,
              lastMissionId: cc.missionId,
            };
            await atomicWriteFile(
              path.join(systemDir, ".materialization-state.json"),
              JSON.stringify(stateFile, null, 2) + "\n",
            );
            logger.info(
              `  Wrote .materialization-state.json (HEAD: ${cacheCloneHead.slice(0, 12)})`,
            );
            try {
              await gitExec(systemDir, "add .materialization-state.json");
              await cacheCloneCommit(
                systemDir,
                `chore: update materialization state for ${cc.missionId}`,
              );
              logger.info(`  Committed .materialization-state.json to cache clone`);
            } catch {
              // non-fatal
            }
          }
          try {
            const envResult = await persistEnvFilesToCacheClone(cc.workpieceDir, systemDir);
            if (envResult.copied.length > 0) {
              logger.info(`  Persisted ${envResult.copied.length} .env file(s) to cache clone`);
            }
          } catch (envErr) {
            logger.warn(
              `  Warning: failed to persist .env files: ${envErr instanceof Error ? envErr.message : String(envErr)}`,
            );
          }
          try {
            const operatorConfigResult = await persistOperatorConfigFiles(
              cc.workpieceDir,
              systemDir,
            );
            if (operatorConfigResult.copied.length > 0) {
              logger.info(
                `  Persisted ${operatorConfigResult.copied.length} operator config file(s)`,
              );
            }
          } catch (operatorConfigErr) {
            logger.warn(
              `  Warning: failed to persist operator config files: ${operatorConfigErr instanceof Error ? operatorConfigErr.message : String(operatorConfigErr)}`,
            );
          }
          for (const cacheDir of MEDIA_CACHE_DIRS) {
            const srcCache = path.join(cc.workpieceDir, cacheDir);
            if (await cc.context.io.exists(srcCache)) {
              const destCache = path.join(systemDir, cacheDir);
              try {
                if (await cc.context.io.exists(destCache)) {
                  await cc.context.io.rm(destCache, { recursive: true });
                }
                await cc.context.io.mkdir(path.dirname(destCache));
                await copyDirRecursive(srcCache, destCache, cc.context.io);
                logger.info(`  Copied ${cacheDir} from workpiece to cache clone`);
              } catch (err) {
                logger.info(
                  `  Warning: failed to copy ${cacheDir}: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            }
          }
          if (!cc.skipContentRegression) {
            const contentRegressionSrc = path.join(
              cc.workpieceDir,
              ".cache",
              "content-regression",
              "current.snapshot.yaml",
            );
            if (await cc.context.io.exists(contentRegressionSrc)) {
              let currentHash: string | null = null;
              try {
                const raw = await cc.context.io.readFile(contentRegressionSrc);
                const parsed = yamlParse(raw) as { contentHash?: string };
                currentHash = parsed?.contentHash ?? null;
              } catch {
                // proceed
              }
              let goldenHash: string | null = null;
              const goldenSnapshotPath = path.join(
                systemDir,
                ".cache",
                "content-regression",
                `${cc.manifest.systemId}.snapshot.yaml`,
              );
              if (await cc.context.io.exists(goldenSnapshotPath)) {
                try {
                  const raw = await cc.context.io.readFile(goldenSnapshotPath);
                  const parsed = yamlParse(raw) as { contentHash?: string };
                  goldenHash = parsed?.contentHash ?? null;
                } catch {
                  // cold start
                }
              }
              if (currentHash && goldenHash && currentHash !== goldenHash) {
                const applyResultPath = path.join(
                  cc.missionDir,
                  "evidence",
                  "content-regression",
                  "apply-result.json",
                );
                let hasValidApplyResult = false;
                if (await cc.context.io.exists(applyResultPath)) {
                  try {
                    const raw = await cc.context.io.readFile(applyResultPath);
                    const result = JSON.parse(raw) as { pending?: number; errors?: string[] };
                    if ((result.pending ?? 0) === 0 && (result.errors?.length ?? 0) === 0) {
                      hasValidApplyResult = true;
                    }
                  } catch {
                    // not valid
                  }
                }
                if (!hasValidApplyResult) {
                  logger.warn(
                    `  [mission.close] CREG-05: Content drift detected. Review generation skipped — non-blocking.`,
                  );
                }
              }
            }
          }
          const contentRegressionSrc = path.join(
            cc.workpieceDir,
            ".cache",
            "content-regression",
            "current.snapshot.yaml",
          );
          if (await cc.context.io.exists(contentRegressionSrc)) {
            const contentRegressionDestDir = path.join(systemDir, ".cache", "content-regression");
            const contentRegressionDest = path.join(
              contentRegressionDestDir,
              `${cc.manifest.systemId}.snapshot.yaml`,
            );
            try {
              await cc.context.io.mkdir(contentRegressionDestDir);
              await cc.context.io.copyFile(contentRegressionSrc, contentRegressionDest);
              logger.info(
                `  Copied content regression snapshot → ${cc.manifest.systemId}.snapshot.yaml`,
              );
            } catch (err) {
              logger.warn(
                `  Warning: failed to copy content regression snapshot: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        } catch (err) {
          logger.info(
            `  Warning: failed to write materialization state or copy .cache/: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    },
    {
      name: "write-closed-sentinel",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        try {
          await cc.context.io.writeFile(path.join(cc.workpieceDir, ".closed"), `${cc.now}\n`);
        } catch (sentinelErr) {
          logger.warn(
            `  Warning: failed to write .closed sentinel: ${sentinelErr instanceof Error ? sentinelErr.message : String(sentinelErr)}`,
          );
        }
      },
      verify: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        return await cc.context.io.exists(path.join(cc.workpieceDir, ".closed"));
      },
    },
    {
      name: "remove-mission-overlay",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        removeOverlay(`mission-${cc.missionId}`);
      },
    },
    {
      name: "dispose-scope-registry",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        try {
          const scopeManager = getDefaultScopeManager();
          scopeManager.disposeRegistry({ scope: "per-mission", missionId: cc.missionId });
        } catch (scopeErr) {
          logger.warn(
            `  [dispose-scope-registry] Non-fatal: ${scopeErr instanceof Error ? scopeErr.message : String(scopeErr)}`,
          );
        }
      },
    },
  ];

  return steps;
}
