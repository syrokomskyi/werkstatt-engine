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
</CHANGE_SUMMARY>
*/

import type { KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";

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
