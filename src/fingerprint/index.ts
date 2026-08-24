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
  <item>Split public API: root entry point now exports primitives only. Semantic functions moved to @warpgogol/werkstatt-engine/fingerprint/semantic.</item>
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
