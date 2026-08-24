/*
<MODULE_CONTRACT>
<purpose>RFC-0921: Shared Ed25519 signing core types — used by Nachweis, Integrity, and Cosmic Passport.</purpose>
<keywords>signing, ed25519, types, key, payload</keywords>
<responsibilities>
  <item>Defines SigningKeyPair as raw Uint8Array fields.</item>
  <item>Defines KeyEncoding union for hex and PEM formats.</item>
  <item>Defines SignablePayload as Record&lt;string, unknown&gt; for canonical JSON signing.</item>
</responsibilities>
<non-goals>
  <item>Does not implement signing or key generation logic — those live in sign.ts and key.ts.</item>
  <item>Does not define domain-specific payload shapes — consumers define their own and pass them as Record&lt;string, unknown&gt;.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0921: initial signing core types module.</item>
</CHANGE_SUMMARY>
*/

export type KeyEncoding = "pem" | "hex";

export interface SigningKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export type SignablePayload = Record<string, unknown>;
