/*
<MODULE_CONTRACT>
  <purpose>RFC-0851: Shared test helper for asserting CERT-TRANSITION-01 block results from Leitstand handlers.</purpose>

<non-goals>
  <item>Do not use in production — these helpers exist for handoff tests only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0851: initial expectTransitionBlock helper for Leitstand handler tests.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
