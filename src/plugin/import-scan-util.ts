/*
<MODULE_CONTRACT>
<purpose>Re-export of scanDirectoryForImports from @warpgogol/werkstatt-shared/share/import-scan.
The canonical implementation lives in the shared package (RFC-0940) so that both
@warpgogol/werkstatt-engine and @warpgogol/forge can import it without forge depending on
the engine.</purpose>
<keywords>scan, import, utility, shared, validate, autonomy, re-export</keywords>
<non-goals>
  <item>Does not define what is forbidden or exempt — callers provide the pattern and filter.</item>
  <item>Does not scan test files — .test.ts and .spec.ts are always excluded.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0868: extract shared directory-scanning utility from autonomy-validate and shared-validate.</item>
  <item>RFC-0940: move canonical implementation to @warpgogol/werkstatt-shared/share/import-scan; this file is now a re-export.</item>
</CHANGE_SUMMARY>
*/

export {
  scanDirectoryForImports,
  type ImportViolation,
} from "@warpgogol/werkstatt-shared/share/import-scan";
