/*
<MODULE_CONTRACT>
  <purpose>RFC-1065: lagebild.status command — read lagebild block from system-state.yaml, return connected boolean, no network calls.</purpose>
  <keywords>lagebild, status, state, read, RFC-1065</keywords>
  <responsibilities>
    <item>Read system-state.yaml via readSystemStateSmart (AC-7).</item>
    <item>Return connected: boolean from state.lagebild.connected (AC-8).</item>
    <item>Return apiUrl, tenantId, sourceSystemId, connectedAt, channel from lagebild block.</item>
    <item>Do NOT make any network calls (AC-9).</item>
  </responsibilities>
  <non-goals>
    <item>Do not spawn wrangler or fetch — state-only read.</item>
    <item>Do not modify system-state.yaml.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1065: initial lagebild.status command handler.</item>
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
