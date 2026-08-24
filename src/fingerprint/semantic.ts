/*
<MODULE_CONTRACT>
<purpose>RFC-0364: Semantic entry point — file and tree fingerprinting with parser-backed normalizers. Loads all parser dependencies.</purpose>
<non-goals>
  <item>Do not export byte-level primitives — those live in the root entry point (@warpgogol/fingerprint).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Split from root entry point: semantic functions moved here so primitive consumers do not transitively load parser packages.</item>
</CHANGE_SUMMARY>
*/

export { fingerprintFile, fingerprintTree } from "./fingerprint.ts";
export type { FingerprintOptions, FingerprintFileResult, FingerprintResult } from "./types.ts";
