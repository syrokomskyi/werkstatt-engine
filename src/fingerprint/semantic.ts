/*
<MODULE_CONTRACT>
<purpose>RFC-0364: Semantic entry point — file and tree fingerprinting with parser-backed normalizers. Loads all parser dependencies.</purpose>
<non-goals>
  <item>Do not export byte-level primitives — those live in the root entry point (@warpgogol/fingerprint).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

export { fingerprintFile, fingerprintTree } from "./fingerprint.ts";
export type { FingerprintOptions, FingerprintFileResult, FingerprintResult } from "./types.ts";
