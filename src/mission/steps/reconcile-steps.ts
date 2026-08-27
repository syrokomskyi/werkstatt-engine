/*
<MODULE_CONTRACT>
  <purpose>RFC-0958: step definitions for mission.reconcile — delegates to buildReconcileSteps in mission-materialization-commands.ts.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial reconcile steps resolver — delegates to mission-materialization-commands.ts.</item>
</CHANGE_SUMMARY>
*/

import type { OperationStep } from "../../journal/index.ts";
import { buildReconcileSteps, type ReconcileStepCtx } from "../mission-materialization-commands.ts";

export { buildReconcileSteps, type ReconcileStepCtx };

export async function resolveReconcileSteps(
  workspaceRoot: string,
  missionId: string,
  ctx: ReconcileStepCtx,
): Promise<OperationStep<unknown>[]> {
  return buildReconcileSteps(workspaceRoot, missionId, ctx);
}
