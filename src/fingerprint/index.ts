/*
<MODULE_CONTRACT>
  <purpose>fingerprint index — barrel export for the fingerprint surface. Hashing primitives and canonical JSON sunk to @warpgogol/werkstatt-shared/fingerprint per RFC-1104; html normalizer and fingerprint types stay engine-local.</purpose>
  <non-goals>
    <item>Do not export semantic fingerprint functions — those live in @warpgogol/werkstatt-engine/fingerprint/semantic.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1104: primitives + canonical-json re-exported from werkstatt-shared/fingerprint; hashHtml + types remain engine-local.</item>
</CHANGE_SUMMARY>
*/

export {
  byteHash,
  byteHashFile,
  stableStringify,
  stableJsonHash,
  isSha256Digest,
} from "@warpgogol/werkstatt-shared/fingerprint";
export type { Sha256Digest } from "@warpgogol/werkstatt-shared/fingerprint";
export {
  CANONICAL_JSON_V1,
  snapshotCanonicalJsonObjectV1,
  isCanonicalJsonObjectV1,
  canonicalJsonBytesV1,
  canonicalJsonHashV1,
  CanonicalJsonInvariantError,
} from "@warpgogol/werkstatt-shared/fingerprint";
export type {
  CanonicalJsonObjectV1,
  CanonicalJsonPathSegmentV1,
  CanonicalJsonFailureCodeV1,
  CanonicalJsonFailureV1,
  CanonicalJsonSuccessV1,
  CanonicalJsonObjectSnapshotResultV1,
} from "@warpgogol/werkstatt-shared/fingerprint";
export { hashHtml } from "./normalizers/html.ts";
export type { FingerprintOptions, FingerprintFileResult, FingerprintResult } from "./types.ts";
