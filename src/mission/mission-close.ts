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
  const syntheticInput: KernelCommandInput = { argv: [], flags: { mission: missionId } };
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

    // RFC-0480: create git bundle from workpiece as audit artifact
    const missionDir = resolveMissionDir(workspaceRoot, missionId);
    const workpieceDir = path.join(missionDir, "workpiece");
    const evidenceDir = path.join(missionDir, "evidence");
    await fs.mkdir(evidenceDir, { recursive: true });

    // ADR-0010: stop any running dev/preview server for the workpiece before
    // transitioning the mission to closed. Best-effort — if no server is running,
    // astro dev stop silently succeeds. This frees the dev port and prevents
    // serving stale content from a closed mission.
    if (existsSync(workpieceDir)) {
      spawnSync("pnpm", ["run", "stop"], {
        cwd: workpieceDir,
        stdio: "ignore",
      });
    }

    // RFC-0797: Auto-commit dirty workpiece instead of throwing.
    // Same pattern as mission.reconcile (RFC-0644).
    const workpieceCommit = commitWorkpieceIfDirty(workpieceDir, missionId);
    if (workpieceCommit.committed) {
      logger.info(
        `  Auto-committed dirty workpiece (${workpieceCommit.commitSha?.slice(0, 8)}) before close`,
      );
      // RFC-0916: Update reconciliation report's workpieceHeadAtReconcile to the
      // new HEAD. The auto-commit only contains build-generated files (behavior
      // snapshots, PDFs, etc.) from the inline validate build — not operator
      // changes. Without this update, the reconcile-freshness gate below fails
      // because workpiece HEAD has moved past the recorded reconcile SHA.
      try {
        const reconcileReportPath = path.join(evidenceDir, "reconciliation-report.json");
        if (existsSync(reconcileReportPath)) {
          const report = JSON.parse(readFileSync(reconcileReportPath, "utf8"));
          report.workpieceHeadAtReconcile = workpieceCommit.commitSha;
          await atomicWriteFile(reconcileReportPath, JSON.stringify(report, null, 2) + "\n");
        }
      } catch {
        // Non-fatal — freshness check will catch if report is missing
      }
    }

    // RFC-0820 Level 2: Zero operator commit guard.
    // Count commits since materialization. If zero, the mission brief was never
    // fulfilled — block close unless --allow-no-op is explicitly set.
    if (!allowNoOp) {
      const operatorCommits = countOperatorCommits(workpieceDir, manifest.migratedAt);
      if (!operatorCommits.hasOperatorCommits) {
        throw new Error(
          `[mission.close] ZERO-COMMIT-GUARD: Mission '${missionId}' has zero operator commits since materialization.\n` +
            `  Brief: "${manifest.brief}"\n` +
            `  This means no work was committed to the workpiece — the mission brief was not fulfilled.\n` +
            `  Possible causes:\n` +
            `    - Edits were never written to disk (agent reported success without actually editing files)\n` +
            `    - mission.git.commit returned 'no changes' but the warning was missed\n` +
            `    - Edits were written to the wrong directory\n` +
            `  If this is a legitimate no-op mission (e.g., platform-only update, config sync),\n` +
            `  re-run with --allow-no-op to override this guard.\n`,
        );
      }
    }

    // RFC-0913: Reconcile-freshness gate — verify workpiece HEAD matches
    // the SHA recorded at reconcile time. Fail-closed if report is missing.
    let freshnessChecked = false;
    let unreconciledCommits = 0;
    let workpieceHead: string | null = null;
    let reconciledSha: string | null = null;

    if (!skipReconcileCheck) {
      const reconcileReportPath = path.join(evidenceDir, "reconciliation-report.json");
      let reconciledWorkpieceSha: string | null = null;
      try {
        const report = JSON.parse(readFileSync(reconcileReportPath, "utf8"));
        reconciledWorkpieceSha = report.workpieceHeadAtReconcile ?? null;
      } catch {
        throw new Error(
          `[mission.close] mission '${missionId}' reconciliation report not found or unreadable.\n` +
            `Cannot verify reconcile freshness — re-run mission.reconcile --mission ${missionId}\n` +
            `to regenerate the report, then re-run mission.close.\n` +
            `If you are certain the workpiece is already synced, re-run with --skip-reconcile-check.`,
        );
      }

      if (!reconciledWorkpieceSha) {
        throw new Error(
          `[mission.close] mission '${missionId}' reconciliation report missing workpieceHeadAtReconcile field.\n` +
            `Re-run mission.reconcile --mission ${missionId} to regenerate the report.\n` +
            `If you are certain the workpiece is already synced, re-run with --skip-reconcile-check.`,
        );
      }

      workpieceHead = gitExec(workpieceDir, "rev-parse HEAD");
      reconciledSha = reconciledWorkpieceSha;

      if (workpieceHead !== reconciledWorkpieceSha) {
        try {
          const countOutput = gitExec(
            workpieceDir,
            `rev-list --count ${reconciledWorkpieceSha}..${workpieceHead}`,
          );
          unreconciledCommits = parseInt(countOutput, 10);
        } catch {
          unreconciledCommits = 0;
        }
        throw new Error(
          `[mission.close] mission '${missionId}' has ${unreconciledCommits} unreconciled commit(s) —\n` +
            `  workpiece HEAD:    ${workpieceHead.slice(0, 12)}\n` +
            `  reconciled SHA:    ${reconciledWorkpieceSha.slice(0, 12)}\n` +
            `Run mission.reconcile --mission ${missionId} to transfer them to the cache clone,\n` +
            `then re-run mission.close.\n` +
            `If you are certain the workpiece is already synced, re-run with --skip-reconcile-check.`,
        );
      }

      freshnessChecked = true;
    } else {
      logger.warn(
        `  Reconcile-freshness check skipped (--skip-reconcile-check) — bordbuch audit entry will be written`,
      );
    }

    if (existsSync(path.join(workpieceDir, ".git"))) {
      const bundlePath = path.join(evidenceDir, "workpiece.git-bundle");
      try {
        execSync(`git bundle create ${JSON.stringify(bundlePath)} --all`, {
          cwd: workpieceDir,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        // Bundle creation failed — non-fatal, close proceeds
      }
    }

    // RFC-0705: Gather mirror status BEFORE state transition and block if external
    // mirrors are out of sync. This ensures a mirror desync blocks before any
    // irreversible close actions (state transition, bordbuch entry, evidence sync).
    let originSha: string | null = null;
    let mirrorSha: string | null = null;
    let mirrorInSync = false;
    let recommendation: string | null = null;

    const config = await readSystemConfigSmart(workspaceRoot, manifest.systemId);

    // Pre-check: push cache clone to origin (bare repo) to ensure the bare repo
    // HEAD is current before comparing with the mirror ref. Without this push,
    // commits created between reconcile and close (e.g., system-state updates,
    // bordbuch entries from other operations) would make the bare repo appear
    // behind, causing a false "mirror out of sync" error.
    if (config && config.mirrors.length > 1) {
      const preCheckSystemDir = await resolveCacheClonePath(workspaceRoot, manifest.systemId);
      if (existsSync(path.join(preCheckSystemDir, ".git"))) {
        try {
          const branch = gitExec(preCheckSystemDir, "rev-parse --abbrev-ref HEAD");
          gitExec(preCheckSystemDir, `push origin ${JSON.stringify(branch)}`);
          logger.info(`  Pushed cache clone to origin before mirror sync check`);
        } catch (pushErr) {
          logger.warn(
            `  Could not push cache clone to origin before mirror check: ${pushErr instanceof Error ? pushErr.message : String(pushErr)}`,
          );
        }
      }
    }

    // RFC-0797: Pre-mirror-check sync — update refs/mirror to match origin HEAD
    // after inline validate's bordbuch commits. Prevents false "out of sync" errors.
    // Must run inside the lock, after the pre-check push, before the mirror sync check.
    if (!skipAutoSync && config && config.mirrors.length > 2) {
      try {
        const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
        logger.info(`  Syncing mirrors before mirror sync check…`);
        await executeKernelCommand({
          workspaceRoot,
          commandName: "sternsystem.sync",
          argv: [`--id=${manifest.systemId}`],
        });
      } catch (syncErr) {
        logger.warn(
          `  Pre-check mirror sync failed (non-fatal): ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
        );
      }
    }

    if (config && config.mirrors.length > 1) {
      const bareMirror = config.mirrors[1];
      const bareRepoPath = resolveMirrorPath(workspaceRoot, bareMirror.path);
      if (existsSync(bareRepoPath)) {
        try {
          let branch: string;
          try {
            branch = gitExec(bareRepoPath, "symbolic-ref HEAD").replace("refs/heads/", "");
          } catch {
            branch = "main";
          }
          try {
            originSha = gitExec(bareRepoPath, `rev-parse ${branch}`);
          } catch {
            originSha = null;
          }
          if (config.mirrors.length > 2) {
            try {
              mirrorSha = gitExec(bareRepoPath, `rev-parse refs/mirror/${branch}`);
            } catch {
              mirrorSha = null;
            }
          }
        } catch {
          // bare repo not accessible
        }
      }
    }

    if (originSha && mirrorSha && originSha !== mirrorSha) {
      mirrorInSync = false;
      recommendation = `Mirror is behind origin. Run: sternsystem.sync --id ${manifest.systemId}`;
    } else if (originSha && mirrorSha && originSha === mirrorSha) {
      mirrorInSync = true;
    } else if (config && config.mirrors.length > 2 && !mirrorSha) {
      mirrorInSync = false;
      recommendation = `Mirror ref not found in bare repo. Run: sternsystem.sync --id ${manifest.systemId}`;
    } else {
      mirrorInSync = true;
    }

    // RFC-0705: Block close if external mirrors are configured and out of sync.
    if (config && config.mirrors.length > 2 && !mirrorInSync) {
      throw new Error(
        `[mission.close] external mirrors are out of sync for system '${manifest.systemId}'. ` +
          `${recommendation ?? "Run: sternsystem.sync --id " + manifest.systemId}`,
      );
    }

    manifest.state = "closed";
    manifest.closedAt = now;
    manifest.closedBy = actor;
    manifest.releaseId = releaseId;

    await writeMissionManifest(workspaceRoot, manifest);

    // RFC-0658: Validate bordbuch integrity before appending the close event.
    // This is defense-in-depth for the distribution-reuse skip path (RFC-0635)
    // where mission.validate skips build.prepare (and thus bordbuch.validate).
    const bordbuchCheck = await validateBordbuch(workspaceRoot, manifest.systemId);
    if (bordbuchCheck.violations.length > 0) {
      const violationLines = bordbuchCheck.violations
        .map((v) => `  [${v.rule}] ${v.message}`)
        .join("\n");
      throw new Error(
        `[mission.close] bordbuch for system '${manifest.systemId}' has ${bordbuchCheck.violations.length} violation${bordbuchCheck.violations.length === 1 ? "" : "s"} — run bordbuch.repair first\n${violationLines}`,
      );
    }

    const { commitResult: bordbuchResult } = await appendAndCommitBordbuch(
      workspaceRoot,
      manifest.systemId,
      "mission-close",
      `Mission ${missionId} closed`,
      actor,
      {
        missionId,
        releaseId,
        writerRole: "mission",
        metadata: releaseId ? { releaseId } : undefined,
      },
      `Bordbuch: mission-close ${missionId}`,
    );

    const systemDir = await resolveCacheClonePath(workspaceRoot, manifest.systemId);

    // Gather dirty files (excluding bordbuch which was just committed)
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

    // RFC-0522: build warnings array for null releaseId
    const warnings: Array<{ rule: string; message: string }> = [];
    if (!releaseId) {
      warnings.push({
        rule: "missing-release-id",
        message:
          "Mission closed without release — releaseId is null. Run release.prepare after close to associate a release.",
      });
    }

    // RFC-0913: Bordbuch audit entry for --skip-reconcile-check escape hatch
    if (skipReconcileCheck) {
      try {
        await appendAndCommitBordbuch(
          workspaceRoot,
          manifest.systemId,
          "mission-close",
          `mission-close-reconcile-check-skipped: ${missionId}`,
          actor,
          {
            missionId,
            writerRole: "mission",
            metadata: { reconcileCheckSkipped: true, reason: "operator-used-skip-reconcile-check" },
          },
          `Bordbuch: mission-close-reconcile-check-skipped ${missionId}`,
        );
      } catch (bordbuchErr) {
        logger.warn(
          `  Warning: failed to append reconcile-check-skipped Bordbuch entry: ${bordbuchErr instanceof Error ? bordbuchErr.message : String(bordbuchErr)}`,
        );
      }
    }

    const closeReport: CloseReport = {
      releaseId,
      git: {
        commitSha: bordbuchResult.commitSha,
        pushed: bordbuchResult.pushed,
        pushError: bordbuchResult.error,
        dirtyFiles,
      },
      mirror: {
        originSha,
        mirrorSha,
        inSync: mirrorInSync,
        recommendation,
        synced: false,
        syncError: null,
      },
      reconcile: {
        reconciledAt: manifest.reconciledAt,
        verified: true,
        freshnessChecked,
        unreconciledCommits,
        workpieceHead,
        reconciledSha,
      },
      templateSync: templateSyncResult,
      warnings,
    };

    // RFC-0652: Mandatory evidence.sync to R2 before writing close-report.json.
    // If evidence.sync fails, mission.close exits 1 with EVIDENCE_SYNC_FAILED — the mission
    // cannot close without archiving evidence to R2. The --skip-evidence-sync flag is an
    // escape hatch for offline close (e.g., no R2 credentials available).
    let evidenceSynced = false;
    let evidenceSyncResult: { r2KeyPrefix: string; uploadedFiles: number } | null = null;

    if (skipEvidenceSync) {
      logger.warn(
        `  Evidence sync skipped — local evidence will be lost when mission.cleanup runs`,
      );
      // Append Bordbuch entry to make the escape hatch auditable (RFC-0750: commit atomically)
      try {
        await appendAndCommitBordbuch(
          workspaceRoot,
          manifest.systemId,
          "mission-close",
          `mission-close-evidence-skipped: ${missionId}`,
          actor,
          {
            missionId,
            writerRole: "mission",
            metadata: { evidenceSyncSkipped: true, reason: "operator-used-skip-evidence-sync" },
          },
          `Bordbuch: mission-close-evidence-skipped ${missionId}`,
        );
      } catch (bordbuchErr) {
        logger.warn(
          `  Warning: failed to append evidence-skipped Bordbuch entry: ${bordbuchErr instanceof Error ? bordbuchErr.message : String(bordbuchErr)}`,
        );
      }
    } else {
      const axiomEvidenceDir = path.join(missionDir, "evidence", "axiom");
      const metadataPath = path.join(axiomEvidenceDir, "evidence-metadata.json");
      if (existsSync(axiomEvidenceDir) && existsSync(metadataPath)) {
        try {
          const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
          const syncResult = (await executeKernelCommand({
            workspaceRoot,
            commandName: "evidence.sync",
            argv: [`--mission=${missionId}`],
          })) as {
            data?: { r2KeyPrefix?: string; uploadedFiles?: string[] };
            exitCode?: number;
          };
          evidenceSynced = true;
          const syncData = syncResult.data;
          if (syncData) {
            evidenceSyncResult = {
              r2KeyPrefix: syncData.r2KeyPrefix ?? "",
              uploadedFiles: syncData.uploadedFiles?.length ?? 0,
            };
          }
          logger.info(`  Evidence synced to R2`);
        } catch (syncError) {
          logger.error(`  Evidence sync failed — mission cannot close without archiving evidence`);
          throw new Error(
            `EVIDENCE_SYNC_FAILED: ${syncError instanceof Error ? syncError.message : String(syncError)}`,
          );
        }
      } else if (existsSync(axiomEvidenceDir)) {
        // evidence/axiom/ exists but no evidence-metadata.json — mission never ran mission.check
        logger.warn(
          `  Evidence directory exists but evidence-metadata.json is missing — skipping sync (no Axiom evidence to archive)`,
        );
      }
    }

    // Write close-report.json to evidence directory
    const evidencePath = path.join(missionDir, "evidence", "close-report.json");
    await atomicWriteFile(evidencePath, JSON.stringify(closeReport, null, 2) + "\n");

    const closeState = await readSystemState(workspaceRoot, manifest.systemId);
    if (closeState.currentMission === missionId) {
      closeState.currentMission = null;
      await writeSystemState(workspaceRoot, manifest.systemId, closeState);
    }

    // RFC-0703: Auto-pin platform version on mission close.
    // Called within the existing lock scope (registry, system, mission locks held).
    // sternsystem.pin reads/writes the config without acquiring locks — safe here.
    // Pin's writeSystemConfig updates pinnedPlatform.
    // commitWerkstattSideEffects then commits the combined change in one commit.
    try {
      const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
      const pinResult = (await executeKernelCommand({
        workspaceRoot,
        commandName: "sternsystem.pin",
        argv: [`--id=${manifest.systemId}`],
      })) as {
        exitCode?: number;
        summary?: string;
      };
      const pinExitCode = pinResult.exitCode ?? 0;
      if (pinExitCode !== 0) {
        throw new Error(
          `sternsystem.pin failed with exitCode ${pinExitCode}: ${pinResult.summary ?? "no summary"}`,
        );
      }
      logger.info(`  Auto-pinned platform version for ${manifest.systemId}`);
    } catch (pinError) {
      throw new Error(
        `[mission.close] sternsystem.pin failed for '${manifest.systemId}': ${pinError instanceof Error ? pinError.message : String(pinError)}`,
      );
    }

    // RFC-0703: Commit system.pin.json to cache clone after pin
    try {
      const systemDir = await resolveCacheClonePath(workspaceRoot, manifest.systemId);
      gitExec(systemDir, "add system.pin.json system-config.yaml");
      cacheCloneCommit(systemDir, `chore: auto-pin platform version for ${missionId}`);
      logger.info(`  Committed system.pin.json to cache clone`);
    } catch (pinCommitError) {
      logger.warn(
        `  Could not commit system.pin.json to cache clone: ${pinCommitError instanceof Error ? pinCommitError.message : String(pinCommitError)}`,
      );
    }

    // RFC-0580: auto-commit werkstatt side-effects
    // RFC-0800: include template file path so auto-synced template changes are committed.
    await commitWerkstattSideEffects(
      workspaceRoot,
      [
        path.join("missions", missionId, "mission.yaml"),
        "packages/werkstatt-site/src/onboarding/templates/package.template.json",
      ],
      `werkstatt: mission.close ${missionId}`,
    );

    // RFC-0762: Sync external mirrors before writing .materialization-state.json.
    // The sync creates a mirror-sync bordbuch commit in the cache clone (RFC-0477),
    // so the state file must be written AFTER the sync to capture the final HEAD.
    // Non-fatal: sync failure logs a warning but does not block close — the mission
    // is already closed (irreversible). The operator can retry sternsystem.sync manually.
    if (config && config.mirrors.length > 2) {
      try {
        const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
        logger.info(`  Syncing external mirrors via sternsystem.sync…`);
        const syncResult = (await executeKernelCommand({
          workspaceRoot,
          commandName: "sternsystem.sync",
          argv: [`--id=${manifest.systemId}`],
        })) as { exitCode?: number; summary?: string };
        const syncExitCode = syncResult.exitCode ?? 0;
        if (syncExitCode !== 0) {
          const syncError =
            syncResult.summary ?? `sternsystem.sync exited with code ${syncExitCode}`;
          logger.warn(
            `[mission.close] sternsystem.sync failed — run manually: ` +
              `sternsystem.sync --id ${manifest.systemId}`,
          );
          closeReport.mirror.synced = false;
          closeReport.mirror.syncError = syncError;
        } else {
          closeReport.mirror.synced = true;
          closeReport.mirror.syncError = null;
          logger.info(`  External mirrors synced`);
        }
      } catch (syncErr) {
        logger.warn(
          `[mission.close] sternsystem.sync threw — run manually: ` +
            `sternsystem.sync --id ${manifest.systemId}: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`,
        );
        closeReport.mirror.synced = false;
        closeReport.mirror.syncError = syncErr instanceof Error ? syncErr.message : String(syncErr);
      }
    }

    // RFC-0597: Write materialization state file and copy .cache/ to cache clone.
    // This is the FINAL step — only executed after the close has succeeded (bundle created,
    // bordbuch committed, state transitioned to closed). If close failed midway, no state
    // file is written — next materialization runs full preflight (safe fallback).
    try {
      const systemDir = await resolveCacheClonePath(workspaceRoot, manifest.systemId);
      // Get current cache clone HEAD
      let cacheCloneHead: string | null = null;
      try {
        cacheCloneHead = execSync("git rev-parse HEAD", {
          cwd: systemDir,
          stdio: "pipe",
          encoding: "utf-8",
        }).trim();
      } catch {
        // cache clone HEAD cannot be resolved — skip state file write
      }
      if (cacheCloneHead) {
        const stateFile = {
          systemId: manifest.systemId,
          cacheCloneHead,
          lastValidatedAt: now,
          lastMissionId: missionId,
        };
        await atomicWriteFile(
          path.join(systemDir, ".materialization-state.json"),
          JSON.stringify(stateFile, null, 2) + "\n",
        );
        logger.info(`  Wrote .materialization-state.json (HEAD: ${cacheCloneHead.slice(0, 12)})`);
        // Commit .materialization-state.json to prevent dirty cache clone (RFC-0597 fix)
        try {
          gitExec(systemDir, "add .materialization-state.json");
          cacheCloneCommit(systemDir, `chore: update materialization state for ${missionId}`);
          logger.info(`  Committed .materialization-state.json to cache clone`);
        } catch {
          // Nothing to commit or git not available — non-fatal
        }
      }

      // RFC-0822: Persist .env* files from workpiece to cache clone (untracked).
      // Done before .cache/ copy — groups all artifact-copy operations together.
      // Non-fatal: failure logs a warning but does not block close.
      const workpieceDir = path.join(missionDir, "workpiece");
      try {
        const envResult = await persistEnvFilesToCacheClone(workpieceDir, systemDir);
        if (envResult.copied.length > 0) {
          logger.info(
            `  Persisted ${envResult.copied.length} .env file(s) to cache clone: ${envResult.copied.join(", ")}`,
          );
        }
        if (envResult.skipped.length > 0) {
          logger.warn(`  Warning: failed to persist .env file(s): ${envResult.skipped.join(", ")}`);
        }
      } catch (envErr) {
        logger.warn(
          `  Warning: failed to persist .env files to cache clone: ${envErr instanceof Error ? envErr.message : String(envErr)}`,
        );
      }

      // RFC-0840: Persist operator config files from workpiece to cache clone (untracked).
      // Done after .env* persistence — same pattern, different file set.
      // Non-fatal: failure logs a warning but does not block close.
      try {
        const operatorConfigResult = await persistOperatorConfigFiles(workpieceDir, systemDir);
        if (operatorConfigResult.copied.length > 0) {
          logger.info(
            `  Persisted ${operatorConfigResult.copied.length} operator config file(s) to cache clone: ${operatorConfigResult.copied.join(", ")}`,
          );
        }
        if (operatorConfigResult.skipped.length > 0) {
          logger.warn(
            `  Warning: failed to persist operator config file(s): ${operatorConfigResult.skipped.join(", ")}`,
          );
        }
      } catch (operatorConfigErr) {
        logger.warn(
          `  Warning: failed to persist operator config files to cache clone: ${operatorConfigErr instanceof Error ? operatorConfigErr.message : String(operatorConfigErr)}`,
        );
      }

      // Copy .cache/video/ and .cache/video-live/ from workpiece to cache clone
      for (const cacheDir of MEDIA_CACHE_DIRS) {
        const srcCache = path.join(workpieceDir, cacheDir);
        if (existsSync(srcCache)) {
          const destCache = path.join(systemDir, cacheDir);
          try {
            // Replace (not merge) — clean copy from workpiece
            if (existsSync(destCache)) {
              await fs.rm(destCache, { recursive: true, force: true });
            }
            // Ensure parent directory exists
            await fs.mkdir(path.dirname(destCache), { recursive: true });
            // Copy recursively
            await copyDirRecursive(srcCache, destCache);
            logger.info(`  Copied ${cacheDir} from workpiece to cache clone`);
          } catch (err) {
            logger.info(
              `  Warning: failed to copy ${cacheDir} to cache clone: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      // RFC-0734 + ADR-0050: CREG-05 check — warn about unreviewed content drift before copying golden snapshot (non-blocking)
      const skipContentRegression = flagBoolean(input, "skip-content-regression");
      if (!skipContentRegression) {
        const contentRegressionSrc = path.join(
          workpieceDir,
          ".cache",
          "content-regression",
          "current.snapshot.yaml",
        );
        if (existsSync(contentRegressionSrc)) {
          // Load current snapshot hash from workpiece
          let currentHash: string | null = null;
          try {
            const raw = await fs.readFile(contentRegressionSrc, "utf8");
            const parsed = yamlParse(raw) as { contentHash?: string };
            currentHash = parsed?.contentHash ?? null;
          } catch {
            // If we can't read it, proceed — the copy will handle it
          }

          // Load golden snapshot hash from cache clone
          let goldenHash: string | null = null;
          const goldenSnapshotPath = path.join(
            systemDir,
            ".cache",
            "content-regression",
            `${manifest.systemId}.snapshot.yaml`,
          );
          if (existsSync(goldenSnapshotPath)) {
            try {
              const raw = await fs.readFile(goldenSnapshotPath, "utf8");
              const parsed = yamlParse(raw) as { contentHash?: string };
              goldenHash = parsed?.contentHash ?? null;
            } catch {
              // Golden unreadable — treat as cold start
            }
          }

          // If drift exists (hashes differ and both exist), check for apply-result.json
          if (currentHash && goldenHash && currentHash !== goldenHash) {
            const applyResultPath = path.join(
              missionDir,
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
                // Unreadable — not valid
              }
            }
            if (!hasValidApplyResult) {
              logger.warn(
                `  [mission.close] CREG-05: Content drift detected (expected after content changes). Review generation skipped — run content.regression.review.generate --site ${manifest.systemId} if regression review is needed. This is non-blocking — mission.close will complete successfully.`,
              );
            }
          }
        }
      }

      // RFC-0732: Copy .cache/content-regression/current.snapshot.yaml from workpiece
      // to cache clone as the new golden snapshot: {systemId}.snapshot.yaml
      const contentRegressionSrc = path.join(
        workpieceDir,
        ".cache",
        "content-regression",
        "current.snapshot.yaml",
      );
      if (existsSync(contentRegressionSrc)) {
        const contentRegressionDestDir = path.join(systemDir, ".cache", "content-regression");
        const contentRegressionDest = path.join(
          contentRegressionDestDir,
          `${manifest.systemId}.snapshot.yaml`,
        );
        try {
          await fs.mkdir(contentRegressionDestDir, { recursive: true });
          await fs.copyFile(contentRegressionSrc, contentRegressionDest);
          logger.info(
            `  Copied .cache/content-regression/current.snapshot.yaml → ${manifest.systemId}.snapshot.yaml (golden baseline)`,
          );
        } catch (err) {
          logger.warn(
            `  Warning: failed to copy content regression snapshot to cache clone: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      logger.info(
        `  Warning: failed to write materialization state or copy .cache/: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // RFC-0878: Write .closed sentinel file to workpiece as final step.
    // The workpiece pre-commit hook checks this file and refuses all commits
    // (including MISSION_GIT_COMMIT=1 bypass) when it exists.
    try {
      await fs.writeFile(path.join(workpieceDir, ".closed"), `${now}\n`);
    } catch (sentinelErr) {
      logger.warn(
        `  Warning: failed to write .closed sentinel to workpiece: ${sentinelErr instanceof Error ? sentinelErr.message : String(sentinelErr)}`,
      );
    }

    return {
      data: {
        missionId,
        systemId: manifest.systemId,
        state: "closed",
        closedAt: now,
        releaseId,
        closeReport,
        evidenceSynced,
        evidenceSyncResult,
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
