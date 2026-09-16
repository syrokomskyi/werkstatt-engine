/*
<MODULE_CONTRACT>
<purpose>Facilitates changelog operations by exporting command functions for generation, index rebuilding, and backfilling.</purpose>
<non-goals>
  <item>Do not implement changelog parsing logic.</item>
  <item>Do not manage changelog storage or retrieval.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

export {
  runChangelogGenerate,
  runChangelogRebuildIndex,
  runChangelogBackfill,
} from "./changelog-command.ts";
