/*
<MODULE_CONTRACT>
  <purpose>RFC-0958: step definitions for mission.abort — stub, populated in step 6.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial stub — populated in step 6.</item>
</CHANGE_SUMMARY>
*/

import type { OperationStep } from "../../journal/index.ts";

export async function buildAbortSteps(
  workspaceRoot: string,
  missionId: string,
  manifest: unknown,
): Promise<OperationStep<unknown>[]> {
  return [];
}
