/*
<MODULE_CONTRACT>
  <purpose>RFC-0958: step definitions for mission.close — delegates to buildCloseSteps in mission-close.ts.</purpose>
<non-goals>
  <item>Do not implement step logic here — step definitions are data consumed by the resolver.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial close steps resolver — delegates to mission-close.ts.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
