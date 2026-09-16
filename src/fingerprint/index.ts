/*
<MODULE_CONTRACT>
<purpose>RFC-0364: Lightweight entry point — byte hashing and stable JSON hashing only. No parser dependencies are loaded.</purpose>
<non-goals>
  <item>Do not export semantic fingerprint functions — those live in @warpgogol/werkstatt-engine/fingerprint/semantic.</item>
  <item>Do not implement command runners — those live in site-kernel-checks.</item>
  <item>Do not define validation rules — those live in the lint/validate command modules.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

export {
  byteHash,
  byteHashFile,
  stableStringify,
  stableJsonHash,
  isSha256Digest,
} from "./primitives.ts";
export type { Sha256Digest } from "./primitives.ts";
export {
  CANONICAL_JSON_V1,
  snapshotCanonicalJsonObjectV1,
  isCanonicalJsonObjectV1,
  canonicalJsonBytesV1,
  canonicalJsonHashV1,
  CanonicalJsonInvariantError,
} from "./canonical-json.ts";
export type {
  CanonicalJsonObjectV1,
  CanonicalJsonPathSegmentV1,
  CanonicalJsonFailureCodeV1,
  CanonicalJsonFailureV1,
  CanonicalJsonSuccessV1,
  CanonicalJsonObjectSnapshotResultV1,
} from "./canonical-json.ts";
export { hashHtml } from "./normalizers/html.ts";
export type { FingerprintOptions, FingerprintFileResult, FingerprintResult } from "./types.ts";
