/*
<MODULE_CONTRACT>
<purpose>Re-export runtime commands from {{PACKAGE_NAME}}.</purpose>
<non-goals>
  <item>Do not implement logic locally — this file is a thin proxy.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>TODO: record current design decisions</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/
export {
  {{EXPORTS_LIST}}
} from "{{PACKAGE_NAME}}";
