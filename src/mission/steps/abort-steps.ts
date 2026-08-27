/*
<MODULE_CONTRACT>
  <purpose>RFC-0958: step definitions for mission.abort — delegates to buildAbortSteps in mission-abort.ts.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial abort steps resolver — delegates to mission-abort.ts.</item>
</CHANGE_SUMMARY>
*/

import type { OperationStep } from "../../journal/index.ts";
import { buildAbortSteps, type AbortStepCtx } from "../mission-abort.ts";

export { buildAbortSteps, type AbortStepCtx };

export async function resolveAbortSteps(
  workspaceRoot: string,
  missionId: string,
  ctx: AbortStepCtx,
): Promise<OperationStep<unknown>[]> {
  return buildAbortSteps(workspaceRoot, missionId, ctx);
}
