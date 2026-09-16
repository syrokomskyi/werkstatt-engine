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
  <item>TODO: record current design decisions</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0556: moved canonical implementation to @warpgogol/forge, this file is now a re-export.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

export { resolveCompassScanRoot } from "@warpgogol/forge/os/compass";
