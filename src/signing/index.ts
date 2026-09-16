/*
<MODULE_CONTRACT>
<purpose>RFC-0921: Barrel export for the shared Ed25519 signing core.</purpose>


<non-goals>
  <item>Does not implement logic — only re-exports from types.ts, key.ts, and sign.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0921: initial signing barrel export.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

export type { KeyEncoding, SigningKeyPair, SignablePayload } from "./types.ts";
export {
  generateKeyPair,
  getPublicKey,
  loadPrivateKey,
  loadPublicKey,
  saveKeyPair,
  toHex,
  fromHex,
  toPem,
  fromPem,
  privateKeyPemToBytes,
  publicKeyPemToBytes,
  keyExists,
} from "./key.ts";
export { canonicalBytes, signBytes, verifyBytes, sign, verify } from "./sign.ts";
