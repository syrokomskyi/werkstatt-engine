/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/mission/snapshot-auto-regen.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not add build pipeline orchestration logic — this helper only handles SNAP-01 detection, snapshot regeneration, git commit, and optional rebuild via dependency injection.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0085: guard autoRegenerateSnapshotOnSnap01 against closed workpieces — the direct executeKernelCommand path bypasses the pipeline-level .closed skip, so regeneration would write a tracked file that RFC-0878 can never commit.</item>
  <item>ADR-0087: replace hand-rolled .closed sentinel check with isClosedWorkpiece from kernel/runtime/closed-workpiece.ts — the executor now enforces the same guard, this early-exit remains for a clear orchestrator result.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
  <item>ADR-0096: bootstrapCommittedSnapshot — committed-presence pre-check + scoped bookkeeping commit before build.post to prevent SNAP-02 deadlock</item>
  <item>ADR-0096: bootstrap committed behavior snapshot before build.post</item>
  <history>RFC-0689, RFC-0697</history>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type { KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import { isClosedWorkpiece } from "../kernel/runtime/closed-workpiece.ts";
import { resolveMissionDir } from "./mission-io.ts";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

interface SnapshotDiagnostics {
  diagnostics?: { ruleId: string }[];
}

export interface AutoRegenerateOptions {
  workspaceRoot: string;
  systemId: string;
  missionId: string;
  logger: { info: (msg: string) => void; warn?: (msg: string) => void };
  context?: KernelRuntimeContext;
}

export const SNAPSHOT_FILENAME = "behavior.snapshot.generated.yaml";

export interface AutoRegenerateResult {
  regenerated: boolean;
  error?: string;
}

export function detectSnap01(data: unknown): boolean {
  const diagnostics = (data as SnapshotDiagnostics | undefined)?.diagnostics;
  if (!diagnostics || !Array.isArray(diagnostics)) return false;
  return diagnostics.some((d) => d.ruleId === "SNAP-01");
}

export async function autoRegenerateSnapshotOnSnap01(
  opts: AutoRegenerateOptions,
): Promise<AutoRegenerateResult> {
  const { workspaceRoot, systemId, missionId, logger } = opts;

  // ADR-0085/0087: a closed workpiece is immutable — regeneration would write
  // a tracked file that RFC-0878 can never commit, producing pure churn.
  // executeRegisteredCommand enforces the same guard (ADR-0087); this early
  // exit stays so the orchestrator gets a clear `regenerated: false` result
  // instead of a skipped-report chain through behavior.snapshot.generate.
  const io = opts.context?.io ?? createDefaultIO().io;
  const workpieceDir = path.join(
    await resolveMissionDir(workspaceRoot, missionId, io),
    "workpiece",
  );
  if (await isClosedWorkpiece(workpieceDir, io)) {
    const error =
      `snapshot auto-regeneration skipped: workpiece is closed (ADR-0085) — ` +
      `mission '${missionId}' cannot accept commits`;
    logger.info(`  ${error}`);
    return { regenerated: false, error };
  }

  logger.info(`  SNAP-01 detected — auto-regenerating behavior snapshot…`);
  try {
    await executeKernelCommand({
      workspaceRoot,
      commandName: "behavior.snapshot.generate",
      siteName: systemId,
    });

    await executeKernelCommand({
      workspaceRoot,
      commandName: "mission.git.commit",
      argv: [`--mission=${missionId}`, "--message=chore: auto-regenerate behavior snapshot"],
    });

    logger.info(`  Behavior snapshot regenerated and committed`);
    return { regenerated: true };
  } catch (regenErr) {
    const error = `snapshot auto-regeneration failed: ${regenErr instanceof Error ? regenErr.message : String(regenErr)}`;
    logger.info(`  ${error}`);
    return { regenerated: false, error };
  }
}

export interface Snap01OrchestrationOptions {
  workspaceRoot: string;
  systemId: string;
  missionId: string;
  logger: { info: (msg: string) => void; warn?: (msg: string) => void };
  validateFn: () => Promise<unknown>;
  rebuildFn?: () => Promise<void>;
}

export interface Snap01OrchestrationResult {
  regenerated: boolean;
  rebuildSucceeded?: boolean;
  error?: string;
}

export async function orchestrateSnap01Recovery(
  opts: Snap01OrchestrationOptions,
): Promise<Snap01OrchestrationResult> {
  const { workspaceRoot, systemId, missionId, logger, validateFn, rebuildFn } = opts;

  try {
    const validateData = await validateFn();
    if (!detectSnap01(validateData)) {
      return { regenerated: false };
    }

    const regenResult = await autoRegenerateSnapshotOnSnap01({
      workspaceRoot,
      systemId,
      missionId,
      logger,
    });

    if (!regenResult.regenerated) {
      return { regenerated: false, error: regenResult.error };
    }

    if (rebuildFn) {
      try {
        await rebuildFn();
        return { regenerated: true, rebuildSucceeded: true };
      } catch (rebuildErr) {
        const error = `rebuild failed after snapshot regeneration: ${rebuildErr instanceof Error ? rebuildErr.message : String(rebuildErr)}`;
        logger.info(`  ${error}`);
        return { regenerated: true, rebuildSucceeded: false, error };
      }
    }

    return { regenerated: true };
  } catch (validateErr) {
    const error = `SNAP-01 validation check failed: ${validateErr instanceof Error ? validateErr.message : String(validateErr)}`;
    logger.info(`  ${error}`);
    return { regenerated: false, error };
  }
}

export interface SnapshotBootstrapResult {
  /** True when a bookkeeping commit created the committed snapshot baseline. */
  committed: boolean;
  /** True when the snapshot was already committed — no action taken. */
  alreadyCommitted?: boolean;
  error?: string;
}

/**
 * ADR-0096: ensure a git-committed `behavior.snapshot.generated.yaml` exists in
 * the workpiece before `build.post` runs — `behavior.snapshot.validate` diffs
 * against the committed baseline and emits SNAP-02 when none exists, deadlocking
 * first-time sites. The bookkeeping commit is scoped via `mission.git.commit
 * --scope-files` so it stages only the snapshot file and cannot be blocked by
 * unrelated dirty content.
 */
export async function bootstrapCommittedSnapshot(
  opts: AutoRegenerateOptions,
): Promise<SnapshotBootstrapResult> {
  const { workspaceRoot, systemId, missionId, logger } = opts;
  const io = opts.context?.io ?? createDefaultIO().io;
  const workpieceDir = path.join(
    await resolveMissionDir(workspaceRoot, missionId, io),
    "workpiece",
  );

  // ADR-0085/0087: closed workpieces are immutable — bootstrap is only
  // meaningful while the mission is open and can accept commits.
  if (await isClosedWorkpiece(workpieceDir, io)) {
    return { committed: false };
  }

  const lsResult = await io.exec("git", ["ls-files", "--error-unmatch", SNAPSHOT_FILENAME], {
    cwd: workpieceDir,
  });
  if (lsResult.exitCode === 0) {
    return { committed: false, alreadyCommitted: true };
  }

  logger.info(`  No committed ${SNAPSHOT_FILENAME} — bootstrapping committed baseline (ADR-0096)…`);
  try {
    await executeKernelCommand({
      workspaceRoot,
      commandName: "behavior.snapshot.generate",
      siteName: systemId,
    });

    const commitResult = await executeKernelCommand({
      workspaceRoot,
      commandName: "mission.git.commit",
      argv: [
        `--mission=${missionId}`,
        "--message=chore: bootstrap committed behavior snapshot (ADR-0096)",
        `--scope-files=${SNAPSHOT_FILENAME}`,
      ],
    });
    const commitSingle = Array.isArray(commitResult) ? commitResult[0] : commitResult;
    if (commitSingle && commitSingle.ok === false) {
      const error = `snapshot bootstrap commit failed: ${commitSingle.summary ?? "unknown error"}`;
      logger.info(`  ${error}`);
      return { committed: false, error };
    }

    logger.info(`  Committed ${SNAPSHOT_FILENAME} baseline`);
    return { committed: true };
  } catch (err) {
    const error = `snapshot bootstrap failed: ${err instanceof Error ? err.message : String(err)}`;
    logger.info(`  ${error}`);
    return { committed: false, error };
  }
}
