/*
<MODULE_CONTRACT>
  <purpose>RFC-0958: step definitions for mission.close — delegates to buildCloseSteps in mission-close.ts.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial close steps resolver — delegates to mission-close.ts.</item>
</CHANGE_SUMMARY>
*/

import type { OperationStep } from "../../journal/index.ts";
import { buildCloseSteps, type CloseStepCtx } from "../mission-close.ts";

export { buildCloseSteps, type CloseStepCtx };

export async function resolveCloseSteps(
  workspaceRoot: string,
  missionId: string,
  ctx: CloseStepCtx,
): Promise<OperationStep<unknown>[]> {
  return buildCloseSteps(workspaceRoot, missionId, ctx);
}
