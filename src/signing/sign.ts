/*
<MODULE_CONTRACT>
<purpose>RFC-0921: Shared Ed25519 sign/verify primitives — canonicalization, raw byte signing, and convenience wrappers.</purpose>


<non-goals>
  <item>Does not implement key generation or loading — those live in key.ts.</item>
  <item>Does not implement multibase encoding — that is a Cosmic Passport concern.</item>
  <item>Does not implement Bordbuch or manifest storage — those are consumer concerns.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0921: initial signing primitives module.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import * as ed from "@noble/ed25519";
import {
  snapshotCanonicalJsonObjectV1,
  canonicalJsonBytesV1,
} from "@warpgogol/werkstatt-engine/fingerprint";
import type { SignablePayload } from "./types.ts";

export function canonicalBytes(payload: SignablePayload): Uint8Array {
  const snapshot = snapshotCanonicalJsonObjectV1(payload);
  if (!snapshot.ok) {
    throw new Error(
      `CERT-CANONICAL-SNAPSHOT-01: failed to canonicalize payload (${snapshot.code})`,
    );
  }
  return canonicalJsonBytesV1(snapshot.value);
}

export async function signBytes(privateKey: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  return ed.signAsync(message, privateKey);
}

export async function verifyBytes(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}

export async function sign(privateKey: Uint8Array, payload: SignablePayload): Promise<Uint8Array> {
  return signBytes(privateKey, canonicalBytes(payload));
}

export async function verify(
  publicKey: Uint8Array,
  payload: SignablePayload,
  signature: Uint8Array,
): Promise<boolean> {
  return verifyBytes(publicKey, canonicalBytes(payload), signature);
}
