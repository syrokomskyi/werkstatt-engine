/*
<MODULE_CONTRACT>
<purpose>RFC-0968: Sternsystem handover protocol — authorization types, signing/verification,
and file IO helpers for cross-werkstatt site transfer. Uses canonical-JSON hashing (RFC-0849)
and Ed25519 signing (RFC-0931 helpers), same patterns as passport.ts.</purpose>
<keywords>handover, sternsystem, transfer, ed25519, canonical-json, authorization</keywords>
<responsibilities>
  <item>HandoverAuthorizationV1 and SignedHandoverAuthorization types for the signed transfer authorization.</item>
  <item>computeAuthorizationHash canonicalizes and hashes the authorization payload.</item>
  <item>signAuthorization signs the authorization hash with the sender's Ed25519 private key.</item>
  <item>verifyAuthorization verifies the signature against the sender's public key and recomputes the hash.</item>
  <item>readAuthorization/writeAuthorization/removeAuthorization manage the handover-authorization.json file in the cache clone.</item>
  <item>HandoverCompleteResult and HandoverEventMetadata types for the bordbuch event and command output.</item>
</responsibilities>
<non-goals>
  <item>Does not implement command logic — that lives in sternsystem-handover-prepare/complete/cancel.ts.</item>
  <item>Does not enforce HANDOVER validation rules — that lives in sternsystem-validate.ts.</item>
  <item>Does not manage key lifecycle or rotation.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0968: initial handover authorization types, signing/verification, and file IO helpers.</item>
  <item>RFC-0988: add Zod schema and parseAuthorizationData for --dry-run --authorization-data CLI input validation.</item>
</CHANGE_SUMMARY>
*/

import { readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  snapshotCanonicalJsonObjectV1,
  canonicalJsonHashV1,
} from "@warpgogol/werkstatt-engine/fingerprint";
import { signBytes, verifyBytes, toHex, fromHex } from "@warpgogol/werkstatt-engine/signing";
import { resolveCacheClonePath } from "./registry-io.ts";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import { z } from "zod";

export interface HandoverAuthorizationV1 {
  schema: "handover-authorization/v1";
  systemId: string;
  sender: {
    identity: string;
    publicKey: string;
  };
  recipient: {
    identity: string;
    publicKey: string;
  };
  passportHash: string;
  bordbuchHead: string;
  authorizedAt: string;
  expiresAt: string;
}

export interface SignedHandoverAuthorization {
  payload: HandoverAuthorizationV1;
  authorizationHash: string;
  signature: string;
}

export interface HandoverCompleteResult {
  systemId: string;
  previousCreator: string;
  newCreator: string;
  newPassportHash: string;
  bordbuchEventHash: string;
  ownershipRegistryUpdated: boolean;
}

export interface HandoverEventMetadata {
  from: string;
  to: string;
  authorizationHash: string;
  newPassportHash: string;
}

export function computeAuthorizationHash(payload: HandoverAuthorizationV1): string {
  const snapshot = snapshotCanonicalJsonObjectV1(payload);
  if (!snapshot.ok) {
    throw new Error(
      `CERT-CANONICAL-SNAPSHOT-01: failed to canonicalize authorization payload (${snapshot.code})`,
    );
  }
  return canonicalJsonHashV1(snapshot.value);
}

export async function signAuthorization(
  payload: HandoverAuthorizationV1,
  privateKeyBytes: Uint8Array,
): Promise<SignedHandoverAuthorization> {
  const authorizationHash = computeAuthorizationHash(payload);
  const hashBytes = new Uint8Array(Buffer.from(authorizationHash, "utf8"));
  const signatureBytes = await signBytes(privateKeyBytes, hashBytes);
  return {
    payload,
    authorizationHash,
    signature: toHex(signatureBytes),
  };
}

export async function verifyAuthorization(
  doc: SignedHandoverAuthorization,
  senderPublicKey: string,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  if (!doc.payload || typeof doc.payload !== "object") {
    return { valid: false, errors: ["payload is missing or not an object"] };
  }

  const snapshot = snapshotCanonicalJsonObjectV1(doc.payload);
  if (!snapshot.ok) {
    return {
      valid: false,
      errors: [`CERT-CANONICAL-SNAPSHOT-01: failed to canonicalize payload (${snapshot.code})`],
    };
  }

  const expectedHash = canonicalJsonHashV1(snapshot.value);
  if (doc.authorizationHash !== expectedHash) {
    errors.push(
      `authorizationHash mismatch: expected ${expectedHash}, got ${doc.authorizationHash}`,
    );
  }

  try {
    const publicKeyBytes = fromHex(senderPublicKey);
    const hashBytes = new Uint8Array(Buffer.from(doc.authorizationHash, "utf8"));
    const signatureBytes = fromHex(doc.signature);
    const sigValid = await verifyBytes(publicKeyBytes, hashBytes, signatureBytes);
    if (!sigValid) {
      errors.push(
        "Ed25519 signature verification failed — authorization may be tampered or signed by a different key",
      );
    }
  } catch (err) {
    errors.push(
      `Signature verification error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { valid: errors.length === 0, errors };
}

export function resolveAuthorizationPath(workspaceRoot: string, systemId: string): string {
  const cachePath = resolveCacheClonePath(workspaceRoot, systemId);
  return path.join(cachePath, "handover-authorization.json");
}

export async function readAuthorization(
  workspaceRoot: string,
  systemId: string,
): Promise<SignedHandoverAuthorization | null> {
  const filePath = resolveAuthorizationPath(workspaceRoot, systemId);
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as SignedHandoverAuthorization;
}

export async function writeAuthorization(
  workspaceRoot: string,
  systemId: string,
  doc: SignedHandoverAuthorization,
): Promise<string> {
  const filePath = resolveAuthorizationPath(workspaceRoot, systemId);
  const content = JSON.stringify(doc, null, 2) + "\n";
  await atomicWriteFile(filePath, content);
  return filePath;
}

export async function removeAuthorization(
  workspaceRoot: string,
  systemId: string,
): Promise<boolean> {
  const filePath = resolveAuthorizationPath(workspaceRoot, systemId);
  if (!existsSync(filePath)) return false;
  await unlink(filePath);
  return true;
}

export function isAuthorizationExpired(expiresAt: string, now: Date = new Date()): boolean {
  const expiry = new Date(expiresAt);
  return expiry.getTime() < now.getTime();
}

const handoverAuthorizationV1Schema = z.object({
  schema: z.literal("handover-authorization/v1"),
  systemId: z.string(),
  sender: z.object({
    identity: z.string(),
    publicKey: z.string(),
  }),
  recipient: z.object({
    identity: z.string(),
    publicKey: z.string(),
  }),
  passportHash: z.string(),
  bordbuchHead: z.string(),
  authorizedAt: z.string(),
  expiresAt: z.string(),
});

const signedHandoverAuthorizationSchema = z.object({
  payload: handoverAuthorizationV1Schema,
  authorizationHash: z.string(),
  signature: z.string(),
});

export function parseAuthorizationData(json: string): SignedHandoverAuthorization {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `[sternsystem.handover.complete] invalid authorization-data JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = signedHandoverAuthorizationSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(
      `[sternsystem.handover.complete] authorization-data validation failed: ${issues}`,
    );
  }
  return result.data as SignedHandoverAuthorization;
}
