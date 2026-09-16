/*
<MODULE_CONTRACT>
<purpose>Re-export of scanDirectoryForImports from @warpgogol/werkstatt-shared/share/import-scan.
The canonical implementation lives in the shared package (RFC-0940) so that both
@warpgogol/werkstatt-engine and @warpgogol/forge can import it without forge depending on
the engine.</purpose>

<non-goals>
  <item>Does not define what is forbidden or exempt — callers provide the pattern and filter.</item>
  <item>Does not scan test files — .test.ts and .spec.ts are always excluded.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0868: extract shared directory-scanning utility from autonomy-validate and shared-validate.</item>
  <item>RFC-0940: move canonical implementation to @warpgogol/werkstatt-shared/share/import-scan; this file is now a re-export.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

export {
  scanDirectoryForImports,
  type ImportViolation,
} from "@warpgogol/werkstatt-shared/share/import-scan";
