/*
<MODULE_CONTRACT>
<purpose>RFC-0921: Barrel export for the shared Ed25519 signing core.</purpose>
<keywords>signing, ed25519, barrel, export</keywords>
<responsibilities>
  <item>Re-exports types, key management, and sign/verify primitives from the signing module.</item>
</responsibilities>
<non-goals>
  <item>Does not implement logic — only re-exports from types.ts, key.ts, and sign.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0921: initial signing barrel export.</item>
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
