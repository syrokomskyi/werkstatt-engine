/*
<MODULE_CONTRACT>
<purpose>Compass scan-root resolution. Canonical implementation now lives
in @warpgogol/forge/os/compass/handlers/resolve-scan-root.ts (RFC-0556 dependency inversion).
This file re-exports it for backward-compatible imports from @warpgogol/site-kernel.</purpose>
<non-goals>
  <item>Do not duplicate the implementation — always re-export from forge.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Canonical implementation lives in @warpgogol/forge — this is a compatibility re-export.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0556: moved canonical implementation to @warpgogol/forge, this file is now a re-export.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export { resolveCompassScanRoot } from "@warpgogol/forge/os/compass";
