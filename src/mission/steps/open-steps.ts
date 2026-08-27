/*
<MODULE_CONTRACT>
  <purpose>RFC-0958: step definitions for mission.open — delegates to buildOpenSteps in mission-open.ts.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial open steps resolver — delegates to mission-open.ts.</item>
</CHANGE_SUMMARY>
*/

import type { OperationStep } from "../../journal/index.ts";
import { buildOpenSteps, type OpenStepCtx } from "../mission-open.ts";

export { buildOpenSteps, type OpenStepCtx };

export async function resolveOpenSteps(
  workspaceRoot: string,
  missionId: string,
  ctx: OpenStepCtx,
): Promise<OperationStep<unknown>[]> {
  return buildOpenSteps(workspaceRoot, missionId, ctx);
}
