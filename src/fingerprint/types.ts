/*
<MODULE_CONTRACT>
<purpose>Maintains packages/fingerprint/src/types.ts as an authored fingerprint authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not implement hashing logic — that lives in fingerprint.ts.</item>
  <item>Do not define normalizer-specific types — those live in their respective normalizer files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0364: initial type definitions for fingerprint options and results.</item>
  <item>RFC-0656: add mode: "stable" for deterministic dist tree hashing with targeted normalization.</item>
</CHANGE_SUMMARY>
*/

export interface FingerprintOptions {
  mode: "byte" | "semantic" | "stable";
  root?: string;
  ignore?: string[];
}

export interface FingerprintFileResult {
  path: string;
  mode: "byte" | "semantic" | "stable";
  normalizer: string;
  hash: string;
}

export interface FingerprintResult {
  algorithm: "sha256";
  mode: "byte" | "semantic" | "stable";
  value: string;
  files: FingerprintFileResult[];
  warnings?: string[];
}
