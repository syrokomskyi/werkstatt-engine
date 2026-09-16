/*
<MODULE_CONTRACT>
<purpose>RFC-0921: Shared Ed25519 signing core types — used by Nachweis, Integrity, and Cosmic Passport.</purpose>


<non-goals>
  <item>Does not implement signing or key generation logic — those live in sign.ts and key.ts.</item>
  <item>Does not define domain-specific payload shapes — consumers define their own and pass them as Record&lt;string, unknown&gt;.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0921: initial signing core types module.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

export type KeyEncoding = "pem" | "hex";

export interface SigningKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export type SignablePayload = Record<string, unknown>;
