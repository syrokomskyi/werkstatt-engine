/*
<MODULE_CONTRACT>
  <purpose>Maintains packages/os/site-kernel-integrity/src/signing.ts as an authored site-kernel-integrity authored module so agents can evolve it without rediscovering local boundaries.</purpose>
    <non-goals>
    <item>Do not handle non-cryptographic signing methods.</item>
    <item>Avoid managing non-build related artifacts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Migrated sha256StringHex from deleted ./hash.ts to byteHash from @warpgogol/fingerprint directly.</item>
  <item>RFC-0921: delegate signing/verification/keygen to shared signing core. Remove node:crypto sign/verify imports and canonicalJson function.</item>
  <item>RFC-0931: add signBuildIdentity, writeReleasePublicKey, verifyBuildIdentitySignature for Ed25519 signing of build-identity.json in deploy pipeline.</item>
</CHANGE_SUMMARY>

/**
 * Ed25519 cryptographic signing for build artifacts.
 * Provides key generation, payload signing, signature verification, and manifest handling.
 */

import path from "node:path";
import { byteHash } from "@warpgogol/werkstatt-engine/fingerprint";
import {
  generateKeyPair as signingGenerateKeyPair,
  toPem as signingToPem,
  toHex as signingToHex,
  getPublicKey as signingGetPublicKey,
  privateKeyPemToBytes,
  publicKeyPemToBytes,
  sign as signingSign,
  verify as signingVerify,
  canonicalBytes as signingCanonicalBytes,
  fromHex as signingFromHex,
} from "@warpgogol/werkstatt-engine/signing";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import { ensureDir, pathExists, readBuffer, readText, writeText } from "./fs.ts";
import { readJsonFile, stableStringify } from "./json.ts";
import {
  buildLatestDir,
  outputsPath,
  provenancePath,
  signedManifestPath,
  signatureBinaryPath,
  signatureHexPath,
} from "./paths.ts";
import type { BuildProvenance, OutputsFile, SignablePayload, SignedManifest } from "./types.ts";

let dotEnvLoadedForCwd: string | undefined;

export interface SigningKeyPairPem {
  privateKeyPem: string;
  publicKeyPem: string;
}

export interface ReleaseSignatureArtifacts {
  outputs: OutputsFile;
  provenance: BuildProvenance;
  payload: SignablePayload;
  payloadBytes: Buffer;
  signatureBuffer: Buffer;
  signatureHex: string;
  signedManifest: SignedManifest;
  reusedExistingSignature: boolean;
}

function pemFromBase64(label: "PRIVATE KEY" | "PUBLIC KEY", base64Value: string): string {
  const normalized = base64Value.replace(/\s+/g, "");
  const lines = normalized.match(/.{1,64}/g) ?? [normalized];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

function normalizePemLikeValue(value: string, label: "PRIVATE KEY" | "PUBLIC KEY"): string {
  const trimmed = value.trim();
  if (trimmed.includes("-----BEGIN")) {
    return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  }
  return pemFromBase64(label, trimmed);
}

async function loadDotEnv(cwd: string): Promise<void> {
  if (dotEnvLoadedForCwd === cwd) {
    return;
  }

  const envPath = path.join(cwd, ".env");
  if (!(await pathExists(envPath))) {
    dotEnvLoadedForCwd = cwd;
    return;
  }

  const envText = await readText(envPath);
  for (const rawLine of envText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    value = value.replace(/\\n/g, "\n");
    process.env[key] = value;
  }

  dotEnvLoadedForCwd = cwd;
}

export async function requireEnv(name: string, cwd = process.cwd()): Promise<string> {
  await loadDotEnv(cwd);
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set.`);
  }
  return value;
}

export async function optionalEnv(name: string, cwd = process.cwd()): Promise<string | undefined> {
  await loadDotEnv(cwd);
  return process.env[name] ?? undefined;
}

export async function generateSigningKeyPairPemAsync(): Promise<SigningKeyPairPem> {
  const keyPair = await signingGenerateKeyPair();
  return {
    privateKeyPem: signingToPem(keyPair.privateKey, "private"),
    publicKeyPem: signingToPem(keyPair.publicKey, "public"),
  };
}

export async function loadBuildArtifactsForSigning(cwd: string): Promise<{
  outputs: OutputsFile;
  outputsRaw: string;
  provenance: BuildProvenance;
  provenanceRaw: string;
}> {
  const [outputsRaw, provenanceRaw, outputs, provenance] = await Promise.all([
    readText(outputsPath(cwd)),
    readText(provenancePath(cwd)),
    readJsonFile<OutputsFile>(outputsPath(cwd)),
    readJsonFile<BuildProvenance>(provenancePath(cwd)),
  ]);

  return {
    outputs,
    outputsRaw,
    provenance,
    provenanceRaw,
  };
}

export function createSignablePayload(args: {
  buildId: string;
  outputsRaw: string;
  provenanceRaw: string;
  signedAt?: string;
}): SignablePayload {
  return {
    payloadVersion: "1",
    buildId: args.buildId,
    signedAt: args.signedAt ?? new Date().toISOString(),
    outputsDigest: byteHash(args.outputsRaw).slice("sha256:".length),
    provenanceDigest: byteHash(args.provenanceRaw).slice("sha256:".length),
  };
}

export async function signJsonPayloadAsync(
  privateKeyPem: string,
  payload: Record<string, unknown>,
): Promise<{
  payloadBytes: Buffer;
  signatureBuffer: Buffer;
  signatureHex: string;
  signatureBase64: string;
}> {
  const privateKeyBytes = privateKeyPemToBytes(privateKeyPem);
  const payloadBytes = Buffer.from(signingCanonicalBytes(payload));
  const signatureBytes = await signingSign(privateKeyBytes, payload);
  const signatureBuffer = Buffer.from(signatureBytes);
  return {
    payloadBytes,
    signatureBuffer,
    signatureHex: signatureBuffer.toString("hex"),
    signatureBase64: signatureBuffer.toString("base64"),
  };
}

export async function signLatestBuildArtifacts(args: {
  cwd: string;
  privateKeyPem: string;
  publicKeyUrl?: string;
}): Promise<ReleaseSignatureArtifacts> {
  const { outputs, outputsRaw, provenance, provenanceRaw } = await loadBuildArtifactsForSigning(
    args.cwd,
  );

  if (!provenance.buildId) {
    throw new Error("build-provenance.json is missing buildId. Run integrity:build-record again.");
  }

  const nextPayload = createSignablePayload({
    buildId: provenance.buildId,
    outputsRaw,
    provenanceRaw,
  });

  const existingManifestPath = signedManifestPath(args.cwd);
  if (await pathExists(existingManifestPath)) {
    const existingManifest = await readJsonFile<SignedManifest>(existingManifestPath);
    const digestsMatch =
      existingManifest.buildId === nextPayload.buildId &&
      existingManifest.payload.outputsDigest === nextPayload.outputsDigest &&
      existingManifest.payload.provenanceDigest === nextPayload.provenanceDigest;

    if (digestsMatch) {
      const existingPayloadBytes = Buffer.from(
        signingCanonicalBytes(existingManifest.payload as unknown as Record<string, unknown>),
      );
      const existingSignatureBuffer = Buffer.from(existingManifest.signatureHex, "hex");

      return {
        outputs,
        provenance,
        payload: existingManifest.payload,
        payloadBytes: existingPayloadBytes,
        signatureBuffer: existingSignatureBuffer,
        signatureHex: existingManifest.signatureHex,
        signedManifest: existingManifest,
        reusedExistingSignature: true,
      };
    }
  }

  const signed = await signJsonPayloadAsync(
    args.privateKeyPem,
    nextPayload as unknown as Record<string, unknown>,
  );

  const signedManifest: SignedManifest = {
    buildId: nextPayload.buildId,
    signedAt: nextPayload.signedAt,
    algorithm: "Ed25519",
    payloadVersion: "1",
    payload: nextPayload,
    signatureHex: signed.signatureHex,
    signatureBase64: signed.signatureBase64,
    publicKeyUrl: args.publicKeyUrl,
  };

  await ensureDir(buildLatestDir(args.cwd));
  await Promise.all([
    writeText(signatureHexPath(args.cwd), `${signed.signatureHex}\n`),
    writeText(signedManifestPath(args.cwd), stableStringify(signedManifest)),
  ]);
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(signatureBinaryPath(args.cwd), signed.signatureBuffer),
  );

  return {
    outputs,
    provenance,
    payload: nextPayload,
    payloadBytes: signed.payloadBytes,
    signatureBuffer: signed.signatureBuffer,
    signatureHex: signed.signatureHex,
    signedManifest,
    reusedExistingSignature: false,
  };
}

export async function loadSignedManifest(manifestSource: string): Promise<SignedManifest> {
  if (manifestSource.startsWith("https://") || manifestSource.startsWith("http://")) {
    const response = await fetch(manifestSource);
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} while fetching signed manifest from ${manifestSource}`,
      );
    }
    return (await response.json()) as SignedManifest;
  }

  return readJsonFile<SignedManifest>(manifestSource);
}

export async function loadPublicKeyPem(args: {
  manifest: SignedManifest;
  publicKeyPemPath?: string;
  publicKeyUrl?: string;
}): Promise<string> {
  if (args.publicKeyPemPath) {
    return normalizePemLikeValue(await readText(path.resolve(args.publicKeyPemPath)), "PUBLIC KEY");
  }

  const publicKeyUrl = args.publicKeyUrl ?? args.manifest.publicKeyUrl;
  if (!publicKeyUrl) {
    throw new Error(
      "No public key source provided. Set PUBLIC_KEY_PEM_PATH, PUBLIC_KEY_URL, or embed publicKeyUrl in signed-manifest.json.",
    );
  }

  const response = await fetch(publicKeyUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching public key from ${publicKeyUrl}`);
  }

  return normalizePemLikeValue(await response.text(), "PUBLIC KEY");
}

export function verifyManifestSignature(args: {
  manifest: SignedManifest;
  publicKeyPem: string;
}): Promise<boolean> {
  return verifyJsonSignatureAsync({
    payload: args.manifest.payload as unknown as Record<string, unknown>,
    signatureHex: args.manifest.signatureHex,
    publicKeyPem: args.publicKeyPem,
  });
}

export async function verifyJsonSignatureAsync(args: {
  payload: Record<string, unknown>;
  signatureHex: string;
  publicKeyPem: string;
}): Promise<boolean> {
  const publicKeyBytes = publicKeyPemToBytes(args.publicKeyPem);
  const signatureBytes = signingFromHex(args.signatureHex);
  return signingVerify(publicKeyBytes, args.payload, signatureBytes);
}

export async function compareManifestWithLocalArtifacts(
  cwd: string,
  manifest: SignedManifest,
): Promise<{
  outputsDigestActual: string;
  provenanceDigestActual: string;
  outputsDigestMatches: boolean;
  provenanceDigestMatches: boolean;
}> {
  const [outputsRaw, provenanceRaw] = await Promise.all([
    readText(outputsPath(cwd)),
    readText(provenancePath(cwd)),
  ]);

  const outputsDigestActual = byteHash(outputsRaw).slice("sha256:".length);
  const provenanceDigestActual = byteHash(provenanceRaw).slice("sha256:".length);

  return {
    outputsDigestActual,
    provenanceDigestActual,
    outputsDigestMatches: outputsDigestActual === manifest.payload.outputsDigest,
    provenanceDigestMatches: provenanceDigestActual === manifest.payload.provenanceDigest,
  };
}

export async function readSignatureBinary(cwd: string): Promise<Buffer> {
  return readBuffer(signatureBinaryPath(cwd));
}

/* --- RFC-0931: build-identity.json signing --- */

const SIGNATURE_FIELDS = ["signature", "publicKeyUrl", "signedAt"] as const;

export interface BuildIdentitySignResult {
  signatureHex: string;
  publicKeyHex: string;
  publicKeyUrl: string | null;
  signedAt: string;
  reusedExistingSignature: boolean;
}

export async function signBuildIdentity(args: {
  buildIdentityPath: string;
  privateKeyBytes: Uint8Array;
  publicKeyUrl?: string;
}): Promise<BuildIdentitySignResult> {
  const raw = await readText(args.buildIdentityPath);
  const identity = JSON.parse(raw) as Record<string, unknown>;

  const signablePayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(identity)) {
    if (!SIGNATURE_FIELDS.includes(key as (typeof SIGNATURE_FIELDS)[number])) {
      signablePayload[key] = value;
    }
  }

  const existingSignature = typeof identity.signature === "string" ? identity.signature : null;
  const existingSignedAt = typeof identity.signedAt === "string" ? identity.signedAt : null;
  const existingPublicKeyUrl =
    typeof identity.publicKeyUrl === "string" ? identity.publicKeyUrl : null;

  if (existingSignature && existingSignedAt) {
    const publicKeyBytes = await signingGetPublicKey(args.privateKeyBytes);
    const signatureBytes = signingFromHex(existingSignature);
    const isValid = await signingVerify(publicKeyBytes, signablePayload, signatureBytes);

    if (isValid) {
      const publicKeyHex = signingToHex(publicKeyBytes);
      return {
        signatureHex: existingSignature,
        publicKeyHex,
        publicKeyUrl: existingPublicKeyUrl ?? args.publicKeyUrl ?? null,
        signedAt: existingSignedAt,
        reusedExistingSignature: true,
      };
    }
  }

  const signatureBytes = await signingSign(args.privateKeyBytes, signablePayload);
  const signatureHex = Buffer.from(signatureBytes).toString("hex");
  const publicKeyHex = signingToHex(await signingGetPublicKey(args.privateKeyBytes));
  const signedAt = new Date().toISOString();

  const signed: Record<string, unknown> = {
    ...signablePayload,
    signature: signatureHex,
    publicKeyUrl: args.publicKeyUrl ?? null,
    signedAt,
  };

  await atomicWriteFile(args.buildIdentityPath, JSON.stringify(signed, null, 2));

  return {
    signatureHex,
    publicKeyHex,
    publicKeyUrl: args.publicKeyUrl ?? null,
    signedAt,
    reusedExistingSignature: false,
  };
}

export async function writeReleasePublicKey(args: {
  distDir: string;
  publicKeyHex: string;
}): Promise<string> {
  const wellKnownDir = path.join(args.distDir, "client", ".well-known");
  await ensureDir(wellKnownDir);
  const pubKeyPath = path.join(wellKnownDir, "release-pubkey.json");
  const keyId = byteHash(args.publicKeyHex).slice("sha256:".length);
  const content = {
    keyId,
    publicKeyHex: args.publicKeyHex,
    algorithm: "Ed25519",
    createdAt: new Date().toISOString(),
  };
  await atomicWriteFile(pubKeyPath, JSON.stringify(content, null, 2));
  return pubKeyPath;
}

export async function verifyBuildIdentitySignature(args: {
  buildIdentity: Record<string, unknown>;
  publicKeyHex: string;
}): Promise<boolean> {
  const signature =
    typeof args.buildIdentity.signature === "string" ? args.buildIdentity.signature : null;
  if (!signature) return false;

  const signablePayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args.buildIdentity)) {
    if (!SIGNATURE_FIELDS.includes(key as (typeof SIGNATURE_FIELDS)[number])) {
      signablePayload[key] = value;
    }
  }

  const publicKeyBytes = signingFromHex(args.publicKeyHex);
  const signatureBytes = signingFromHex(signature);
  return signingVerify(publicKeyBytes, signablePayload, signatureBytes);
}
