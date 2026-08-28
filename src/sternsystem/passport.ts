/*
<MODULE_CONTRACT>
<purpose>RFC-0966: Signed site passport — payload builder, signer, verifier.
Provides SitePassportV1 and SignedSitePassport types, buildPassportPayload,
signPassport, and verifyPassport functions. Uses canonical-JSON hashing
(RFC-0849) and Ed25519 signing (RFC-0931/RFC-0921 helpers).</purpose>
<keywords>passport, sternsystem, identity, ed25519, canonical-json, signing</keywords>
<responsibilities>
  <item>buildPassportPayload reads system-config.yaml, system.pin.json, .env.example, bordbuch ledger, and mission count to assemble SitePassportV1.</item>
  <item>signPassport computes canonicalJsonHashV1 over the payload and signs the hash bytes with Ed25519.</item>
  <item>verifyPassport recomputes the payload hash and verifies the signature against the embedded creator.publicKey.</item>
  <item>Mirror locators are sanitized to strip embedded credentials per RFC-0574 rules.</item>
  <item>Secret names are parsed from .env.example KEY= lines — values are never read.</item>
</responsibilities>
<non-goals>
  <item>Does not perform file IO for writing passport.json — use readPassport/writePassport in registry-io.ts.</item>
  <item>Does not manage key lifecycle or rotation — see RFC-0966 Key rotation section.</item>
  <item>Does not enforce single-creator invariant — that is sternsystem.validate PASSPORT-02.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0966: initial passport types, builder, signer, verifier.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  snapshotCanonicalJsonObjectV1,
  canonicalJsonHashV1,
} from "@warpgogol/werkstatt-engine/fingerprint";
import {
  signBytes,
  verifyBytes,
  toHex,
  fromHex,
  getPublicKey,
} from "@warpgogol/werkstatt-engine/signing";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";
import { resolveCacheClonePath, readSystemConfig } from "./registry-io.ts";
import { z } from "zod";
import type { SystemConfig } from "@warpgogol/werkstatt-engine/schemas";

export interface SitePassportV1 {
  schema: "site-passport/v1";
  systemId: string;
  creator: {
    identity: string;
    publicKey: string;
  };
  platform: {
    version: string;
    semanticHash: string;
  };
  provenance: {
    createdAt: string;
    generatedAt: string;
    bordbuchHead: string | null;
    missionCounter: number;
  };
  resources: {
    channels: Record<"dev" | "alt" | "main", { workerName: string; url: string }>;
    customDomains: string[];
    vectorizeIndexes: string[];
    r2Prefixes: string[];
    secretNames: string[];
  };
  mirrors: Array<{ role: "cache" | "bare" | "external"; locator: string }>;
}

export interface SignedSitePassport {
  payload: SitePassportV1;
  passportHash: string;
  signature: string;
}

const partialPinSchema = z.object({
  platform: z.object({
    version: z.string().min(1),
    platformSemanticHash: z.string().min(1),
  }),
});

const CREDENTIAL_RE = /^https?:\/\/[^:]+:[^@]+@/;

function sanitizeLocator(locator: string): string {
  if (CREDENTIAL_RE.test(locator)) {
    return locator.replace(/^https?:\/\/[^@]+@/, (match) => {
      const scheme = match.startsWith("https") ? "https://" : "http://";
      return scheme;
    });
  }
  return locator;
}

function mirrorRole(index: number): "cache" | "bare" | "external" {
  if (index === 0) return "cache";
  if (index === 1) return "bare";
  return "external";
}

function parseSecretNames(envExampleContent: string): string[] {
  const names: string[] = [];
  for (const line of envExampleContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key) names.push(key);
  }
  return [...new Set(names)].sort();
}

function countMissions(cacheClonePath: string): number {
  const missionsDir = path.join(cacheClonePath, "missions");
  if (!existsSync(missionsDir)) return 0;
  try {
    const entries = readdirSync(missionsDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

function extractChannels(
  config: SystemConfig,
): Record<"dev" | "alt" | "main", { workerName: string; url: string }> {
  const channels = config.deployment?.channels;
  return {
    dev: { workerName: channels?.dev?.workerName ?? "", url: channels?.dev?.url ?? "" },
    alt: { workerName: channels?.alt?.workerName ?? "", url: channels?.alt?.url ?? "" },
    main: { workerName: channels?.main?.workerName ?? "", url: channels?.main?.url ?? "" },
  };
}

export async function buildPassportPayload(input: {
  systemId: string;
  werkstattRoot: string;
  creatorIdentity: string;
  creatorPublicKey: string;
}): Promise<SitePassportV1> {
  const { systemId, werkstattRoot, creatorIdentity, creatorPublicKey } = input;
  const cacheClonePath = resolveCacheClonePath(werkstattRoot, systemId);

  const config = await readSystemConfig(werkstattRoot, systemId);

  const pinPath = path.join(cacheClonePath, "system.pin.json");
  let platformVersion = "0.0.0";
  let platformSemanticHash =
    "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  if (existsSync(pinPath)) {
    const pinRaw = await fs.readFile(pinPath, "utf8");
    const pinParsed = partialPinSchema.safeParse(JSON.parse(pinRaw));
    if (pinParsed.success) {
      platformVersion = pinParsed.data.platform.version;
      platformSemanticHash = pinParsed.data.platform.platformSemanticHash;
    }
  }

  const envExamplePath = path.join(cacheClonePath, ".env.example");
  let secretNames: string[] = [];
  if (existsSync(envExamplePath)) {
    const envContent = await fs.readFile(envExamplePath, "utf8");
    secretNames = parseSecretNames(envContent);
  }

  let bordbuchHead: string | null = null;
  try {
    const entries = await readBordbuch(werkstattRoot, systemId);
    if (entries.length > 0) {
      bordbuchHead = entries[entries.length - 1].hash;
    }
  } catch {
    // Bordbuch not readable — treat as null
  }

  const missionCounter = countMissions(cacheClonePath);

  const mirrors: Array<{ role: "cache" | "bare" | "external"; locator: string }> =
    config.mirrors.map((m, i) => ({
      role: mirrorRole(i),
      locator: sanitizeLocator(m.path),
    }));

  const now = new Date().toISOString();

  return {
    schema: "site-passport/v1",
    systemId,
    creator: {
      identity: creatorIdentity,
      publicKey: creatorPublicKey,
    },
    platform: {
      version: platformVersion,
      semanticHash: platformSemanticHash,
    },
    provenance: {
      createdAt: now,
      generatedAt: now,
      bordbuchHead,
      missionCounter,
    },
    resources: {
      channels: extractChannels(config),
      customDomains: [],
      vectorizeIndexes: [],
      r2Prefixes: [],
      secretNames,
    },
    mirrors,
  };
}

export async function signPassport(
  payload: SitePassportV1,
  privateKeyBytes: Uint8Array,
): Promise<{ passportHash: string; signature: string }> {
  const snapshot = snapshotCanonicalJsonObjectV1(payload);
  if (!snapshot.ok) {
    throw new Error(
      `CERT-CANONICAL-SNAPSHOT-01: failed to canonicalize passport payload (${snapshot.code})`,
    );
  }
  const passportHash = canonicalJsonHashV1(snapshot.value);
  const hashBytes = new Uint8Array(Buffer.from(passportHash, "utf8"));
  const signatureBytes = await signBytes(privateKeyBytes, hashBytes);
  return {
    passportHash,
    signature: toHex(signatureBytes),
  };
}

export async function verifyPassport(
  doc: SignedSitePassport,
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
  if (doc.passportHash !== expectedHash) {
    errors.push(`passportHash mismatch: expected ${expectedHash}, got ${doc.passportHash}`);
  }

  try {
    const publicKeyBytes = fromHex(doc.payload.creator.publicKey);
    const hashBytes = new Uint8Array(Buffer.from(doc.passportHash, "utf8"));
    const signatureBytes = fromHex(doc.signature);
    const sigValid = await verifyBytes(publicKeyBytes, hashBytes, signatureBytes);
    if (!sigValid) {
      errors.push(
        "Ed25519 signature verification failed — passport may be tampered or signed by a different key",
      );
    }
  } catch (err) {
    errors.push(
      `Signature verification error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { valid: errors.length === 0, errors };
}

export async function derivePublicKey(privateKeyBytes: Uint8Array): Promise<string> {
  const pubKey = await getPublicKey(privateKeyBytes);
  return toHex(pubKey);
}

export function computePassportHash(payload: SitePassportV1): string {
  const snapshot = snapshotCanonicalJsonObjectV1(payload);
  if (!snapshot.ok) {
    throw new Error(
      `CERT-CANONICAL-SNAPSHOT-01: failed to canonicalize passport payload (${snapshot.code})`,
    );
  }
  return canonicalJsonHashV1(snapshot.value);
}
