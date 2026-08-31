/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/mission/mission-close.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0355: initial mission.close command handler.</item>
  <item>RFC-0477: add reconciledAt guard, bordbuch commit+push, and close-report.json evidence.</item>
  <item>RFC-0480: create git bundle in evidence/ before closing; preserve workpiece for mission.preview.</item>
  <item>RFC-0480: add dirty workpiece guard to mission.close.</item>
  <item>RFC-0522: resolve releaseId with flag→manifest precedence; add warnings[] to CloseReport.</item>
  <item>RFC-0560: use resolveActor(input) for actor resolution with --actor-from-auth flag.</item>
  <item>RFC-0580: auto-commit werkstatt side-effects (registry.yaml, mission.yaml) after writeRegistry.</item>
  <item>RFC-0593: add mission.validate inline gate before lock acquisition; re-check state inside locks.</item>
  <item>RFC-0597: write .materialization-state.json and copy .cache/ from workpiece to cache clone as final step.</item>
  <item>ADR-0010: stop any running dev/preview server for the workpiece before closing the mission.</item>
  <item>RFC-0652: mandatory evidence.sync to R2 before writing close-report.json; --skip-evidence-sync escape hatch with Bordbuch audit entry.</item>
  <item>RFC-0655: add releaseId to CloseReport interface; pass releaseId as top-level option to appendBordbuchEntry.</item>
  <item>RFC-0658: validate bordbuch before appending close event (defense-in-depth for distribution-reuse skip path).</item>
  <item>RFC-0703: auto-pin platform version via sternsystem.pin after registry update, before werkstatt commit.</item>
  <item>RFC-0705: move mirror status gathering before state transition; add blocking check when external mirrors are desynced.</item>
  <item>RFC-0734: add CREG-05 enforcement — warn when content drift exists and no apply-result.json; add --skip-content-regression flag. ADR-0050: changed from blocking throw to non-blocking warning.</item>
  <item>RFC-0762: extend CloseReportMirror with synced/syncError; add post-close sternsystem.sync call before state file write.</item>
  <item>Bug fix: push cache clone to origin before mirror sync check to prevent false "out of sync" when commits were created between reconcile and close.</item>
  <item>RFC-0801: remove auto-archive from mission.close; remove CloseReportArchive interface and --skip-auto-archive flag.</item>
  <item>RFC-0797: replace dirty workpiece guard with commitWorkpieceIfDirty auto-commit; add pre-mirror-check sternsystem.sync inside lock with --skip-auto-sync flag.</item>
  <item>RFC-0820: add zero operator commit guard — block close when no commits since materialization; add --allow-no-op override flag.</item>
  <item>RFC-0822: persist .env* files to cache clone as final close step.</item>
  <item>RFC-0878: write .closed sentinel file to workpiece as final step before returning.</item>
  <item>RFC-0913: add reconcile-freshness gate — compare workpiece HEAD against workpieceHeadAtReconcile from reconciliation report; fail-closed on missing report; add --skip-reconcile-check escape hatch.</item>
  <item>RFC-0958: wrap post-lock lifecycle in runOperation with journal — each step records to journal.jsonl for crash-safe resume.</item>
  <item>RFC-0991: add behavior-snapshot-refresh step to buildCloseSteps for auto-generating behavior snapshot during mission close.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import { resolveActor } from "./actor-identity.ts";
import { persistEnvFilesToCacheClone } from "./env-persist.ts";
import { persistOperatorConfigFiles } from "./operator-config-files.ts";
import { readFileSync } from "node:fs";
import { runOperation } from "../journal/runner.ts";
import { checkDifferentKindOperation } from "../journal/index.ts";
import type { OperationStep, OperationDefinition } from "../journal/index.ts";

// RFC-0597: Media cache directories to persist across missions
const MEDIA_CACHE_DIRS = [".cache/video", ".cache/video-live"];

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
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

function gitExec(cwd: string, args: string, options?: { env?: NodeJS.ProcessEnv }): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 30_000,
    ...(options?.env ? { env: options.env } : {}),
  }).trim();
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
    const missionDir = resolveMissionDir(workspaceRoot, missionId);
    const workpieceDir = path.join(missionDir, "workpiece");
    const evidenceDir = path.join(missionDir, "evidence");
    await fs.mkdir(evidenceDir, { recursive: true });

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
        if (existsSync(cc.workpieceDir)) {
          spawnSync("pnpm", ["run", "stop"], { cwd: cc.workpieceDir, stdio: "ignore" });
        }
      },
      verify: async () => true,
    },
    {
      name: "auto-commit-workpiece",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const workpieceCommit = commitWorkpieceIfDirty(cc.workpieceDir, cc.missionId);
        if (workpieceCommit.committed) {
          logger.info(
            `  Auto-committed dirty workpiece (${workpieceCommit.commitSha?.slice(0, 8)}) before close`,
          );
          try {
            const reconcileReportPath = path.join(cc.evidenceDir, "reconciliation-report.json");
            if (existsSync(reconcileReportPath)) {
              const report = JSON.parse(readFileSync(reconcileReportPath, "utf8"));
              report.workpieceHeadAtReconcile = workpieceCommit.commitSha;
              await atomicWriteFile(reconcileReportPath, JSON.stringify(report, null, 2) + "\n");
            }
          } catch {
            // Non-fatal
          }
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
          commitWorkpieceIfDirty(cc.workpieceDir, cc.missionId, "behavior-snapshot-refresh");
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
          const operatorCommits = countOperatorCommits(cc.workpieceDir, cc.manifest.migratedAt);
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
            const report = JSON.parse(readFileSync(reconcileReportPath, "utf8"));
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
          cc.workpieceHead = gitExec(cc.workpieceDir, "rev-parse HEAD");
          cc.reconciledSha = reconciledWorkpieceSha;
          if (cc.workpieceHead !== reconciledWorkpieceSha) {
            try {
              const countOutput = gitExec(
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
        if (existsSync(path.join(cc.workpieceDir, ".git"))) {
          const bundlePath = path.join(cc.evidenceDir, "workpiece.git-bundle");
          try {
            execSync(`git bundle create ${JSON.stringify(bundlePath)} --all`, {
              cwd: cc.workpieceDir,
              stdio: ["pipe", "pipe", "pipe"],
            });
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
          if (existsSync(path.join(preCheckSystemDir, ".git"))) {
            try {
              const branch = gitExec(preCheckSystemDir, "rev-parse --abbrev-ref HEAD");
              gitExec(preCheckSystemDir, `push origin ${JSON.stringify(branch)}`);
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
          if (existsSync(bareRepoPath)) {
            try {
              let branch: string;
              try {
                branch = gitExec(bareRepoPath, "symbolic-ref HEAD").replace("refs/heads/", "");
              } catch {
                branch = "main";
              }
              try {
                cc.originSha = gitExec(bareRepoPath, `rev-parse ${branch}`);
              } catch {
                cc.originSha = null;
              }
              if (config.mirrors.length > 2) {
                try {
                  cc.mirrorSha = gitExec(bareRepoPath, `rev-parse refs/mirror/${branch}`);
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
        if (existsSync(axiomEvidenceDir) && existsSync(metadataPath)) {
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
        } else if (existsSync(axiomEvidenceDir)) {
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
          const { execFileSync } = await import("node:child_process");
          const cacheClonePath = resolveCacheClonePath(cc.workspaceRoot, cc.manifest.systemId);
          execFileSync("git", ["-C", cacheClonePath, "add", "passport.json"], { stdio: "pipe" });
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
      name: "write-close-report",
      run: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        const systemDir = await resolveCacheClonePath(cc.workspaceRoot, cc.manifest.systemId);
        let dirtyFiles: string[] = [];
        try {
          const status = gitExec(systemDir, "status --porcelain");
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
        return existsSync(path.join(cc.missionDir, "evidence", "close-report.json"));
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
          gitExec(systemDir, "add system.pin.json system-config.yaml");
          cacheCloneCommit(systemDir, `chore: auto-pin platform version for ${cc.missionId}`);
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
            cacheCloneHead = execSync("git rev-parse HEAD", {
              cwd: systemDir,
              stdio: "pipe",
              encoding: "utf-8",
            }).trim();
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
              gitExec(systemDir, "add .materialization-state.json");
              cacheCloneCommit(
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
            if (existsSync(srcCache)) {
              const destCache = path.join(systemDir, cacheDir);
              try {
                if (existsSync(destCache)) {
                  await fs.rm(destCache, { recursive: true, force: true });
                }
                await fs.mkdir(path.dirname(destCache), { recursive: true });
                await copyDirRecursive(srcCache, destCache);
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
            if (existsSync(contentRegressionSrc)) {
              let currentHash: string | null = null;
              try {
                const raw = await fs.readFile(contentRegressionSrc, "utf8");
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
              if (existsSync(goldenSnapshotPath)) {
                try {
                  const raw = await fs.readFile(goldenSnapshotPath, "utf8");
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
                if (existsSync(applyResultPath)) {
                  try {
                    const raw = await fs.readFile(applyResultPath, "utf8");
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
          if (existsSync(contentRegressionSrc)) {
            const contentRegressionDestDir = path.join(systemDir, ".cache", "content-regression");
            const contentRegressionDest = path.join(
              contentRegressionDestDir,
              `${cc.manifest.systemId}.snapshot.yaml`,
            );
            try {
              await fs.mkdir(contentRegressionDestDir, { recursive: true });
              await fs.copyFile(contentRegressionSrc, contentRegressionDest);
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
          await fs.writeFile(path.join(cc.workpieceDir, ".closed"), `${cc.now}\n`);
        } catch (sentinelErr) {
          logger.warn(
            `  Warning: failed to write .closed sentinel: ${sentinelErr instanceof Error ? sentinelErr.message : String(sentinelErr)}`,
          );
        }
      },
      verify: async (c: unknown) => {
        const cc = c as CloseStepCtx;
        return existsSync(path.join(cc.workpieceDir, ".closed"));
      },
    },
  ];

  return steps;
}
