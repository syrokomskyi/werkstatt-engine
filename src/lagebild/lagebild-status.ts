/*
<MODULE_CONTRACT>
  <purpose>RFC-1065: lagebild.status command — read lagebild block from system-state.yaml, return connected boolean, no network calls.</purpose>


  <non-goals>
    <item>Do not spawn wrangler or fetch — state-only read.</item>
    <item>Do not modify system-state.yaml.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1065: initial lagebild.status command handler.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { readSystemStateSmart } from "../sternsystem/registry-io.ts";

function flagString(input: KernelCommandInput, name: string): string | undefined {
  const v = input.flags[name];
  return typeof v === "string" ? v : undefined;
}

export async function runLagebildStatus(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<
  KernelCommandResult<{
    site: string;
    connected: boolean;
    apiUrl?: string;
    tenantId?: string;
    sourceSystemId?: string;
    connectedAt?: string;
    channel?: string;
  }>
> {
  const systemId = flagString(input, "site");
  if (!systemId) throw new Error("[lagebild.status] --site is required");

  const workspaceRoot = context.workspaceRoot;

  const state = await readSystemStateSmart(workspaceRoot, systemId);
  const lagebild = state.lagebild;

  return {
    data: {
      site: systemId,
      connected: lagebild?.connected ?? false,
      apiUrl: lagebild?.apiUrl,
      tenantId: lagebild?.tenantId,
      sourceSystemId: lagebild?.sourceSystemId,
      connectedAt: lagebild?.connectedAt,
      channel: lagebild?.channel,
    },
  };
}
