/*
<MODULE_CONTRACT>
  <purpose>RFC-0851: Shared test helper for asserting CERT-TRANSITION-01 block results from Leitstand handlers.</purpose>
  <keywords>RFC-0851, CERT-TRANSITION-01, transition-block, test-helper</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0851: initial expectTransitionBlock helper for Leitstand handler tests.</item>
</CHANGE_SUMMARY>
*/

import type { KernelCommandResult } from "@warpgogol/werkstatt-engine/kernel";

export function expectTransitionBlock<T>(
  result: KernelCommandResult<T>,
  command: string,
): void {
  if (result.exitCode !== 1) {
    throw new Error(
      `expected exitCode 1 for ${command} (transition block), got ${result.exitCode} (summary: ${result.summary ?? "<none>"})`,
    );
  }
  if (!result.summary?.includes("blocked") || !result.summary?.includes("CERT-TRANSITION-01")) {
    throw new Error(
      `expected summary to contain "blocked" and "CERT-TRANSITION-01" for ${command}, got: ${result.summary ?? "<none>"}`,
    );
  }
}
