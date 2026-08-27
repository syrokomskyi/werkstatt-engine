/*
<MODULE_CONTRACT>
  <purpose>RFC-0958: step definitions for mission.reconcile — stub, populated in step 5.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial stub — populated in step 5.</item>
</CHANGE_SUMMARY>
*/

import type { OperationStep } from "../../journal/index.ts";

export async function buildReconcileSteps(
  workspaceRoot: string,
  missionId: string,
  manifest: unknown,
): Promise<OperationStep<unknown>[]> {
  return [];
}
