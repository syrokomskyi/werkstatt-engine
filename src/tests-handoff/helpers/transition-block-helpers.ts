/*
<MODULE_CONTRACT>
  <purpose>RFC-0851: Shared test helper for asserting CERT-TRANSITION-01 block results from Leitstand handlers.</purpose>

</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0851: initial expectTransitionBlock helper for Leitstand handler tests.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
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
