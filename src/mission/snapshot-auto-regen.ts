/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/mission/snapshot-auto-regen.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not add build pipeline orchestration logic — this helper only handles SNAP-01 detection, snapshot regeneration, git commit, and optional rebuild via dependency injection.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0689: extract shared autoRegenerateSnapshotOnSnap01 helper from mission-materialization-commands.ts (RFC-0615) for reuse by leitstand.dev-deploy.</item>
  <item>RFC-0697: add orchestrateSnap01Recovery shared helper encapsulating detect → regenerate → (optional) rebuild orchestration, replacing duplicated inline logic in leitstand.dev-deploy and mission.validate.</item>
  <item>ADR-0085: guard autoRegenerateSnapshotOnSnap01 against closed workpieces — the direct executeKernelCommand path bypasses the pipeline-level .closed skip, so regeneration would write a tracked file that RFC-0878 can never commit.</item>
  <item>ADR-0087: replace hand-rolled .closed sentinel check with isClosedWorkpiece from kernel/runtime/closed-workpiece.ts — the executor now enforces the same guard, this early-exit remains for a clear orchestrator result.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type { KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import { isClosedWorkpiece } from "../kernel/runtime/closed-workpiece.ts";
import { resolveMissionDir } from "./mission-io.ts";

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
  const workpieceDir = path.join(resolveMissionDir(workspaceRoot, missionId), "workpiece");
  if (isClosedWorkpiece(workpieceDir)) {
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
