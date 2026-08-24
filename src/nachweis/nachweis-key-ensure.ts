/*
<MODULE_CONTRACT>
<purpose>RFC-0715/RFC-0921: nachweis.key.ensure command handler — generates an Ed25519 keypair for Nachweis operator signatures via shared signing core.</purpose>
<keywords>nachweis, key, ed25519, signing, crypto</keywords>
<responsibilities>
  <item>Generates a new Ed25519 keypair using the shared signing core (RFC-0921).</item>
  <item>Writes private key as hex to the specified key file path (outside repo).</item>
  <item>Writes public key as hex to <path>.pub.</item>
  <item>Computes keyId as SHA-256 of the public key bytes.</item>
  <item>Refuses to overwrite existing key file without --force.</item>
  <item>Publishes public key JSON to public/.well-known/nachweis-pubkey.json when resolvable.</item>
</responsibilities>
<non-goals>
  <item>Does not implement key rotation — that is a future RFC.</item>
  <item>Does not use multibase encoding — intentionally hex for simplicity (differs from passport).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0715: initial nachweis.key.ensure command handler.</item>
  <item>RFC-0715 review fix: import flagString/flagBool from nachweis-n3-types.ts.</item>
  <item>RFC-0921: delegate key generation to shared signing core (generateKeyPair, toHex). Remove @noble/ed25519 import.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { byteHash } from "@warpgogol/werkstatt-engine/fingerprint";
import { writeFileIfChanged } from "@warpgogol/werkstatt-engine/kernel";
import { generateKeyPair, toHex } from "@warpgogol/werkstatt-engine/signing";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { flagString, flagBool } from "./nachweis-n3-types.ts";

export interface NachweisKeyEnsureResult {
  keyFilePath: string;
  publicKeyFilePath: string;
  publicKeyHex: string;
  keyId: string;
}

export interface NachweisPublicKeyEntry {
  keyId: string;
  publicKeyHex: string;
  status: "current" | "retired";
  createdAt: string;
}

export async function ensureNachweisKey(
  keyFilePath: string,
  force: boolean,
): Promise<NachweisKeyEnsureResult> {
  if (existsSync(keyFilePath) && !force) {
    throw new Error(
      `[nachweis.key.ensure] KEY_FILE_EXISTS: '${keyFilePath}' already exists. Use --force to overwrite.`,
    );
  }

  const keyPair = await generateKeyPair();
  const privateKeyBytes = keyPair.privateKey;
  const publicKeyBytes = keyPair.publicKey;

  const privateKeyHex = toHex(privateKeyBytes);
  const publicKeyHex = toHex(publicKeyBytes);

  const keyId = byteHash(Buffer.from(publicKeyHex, "hex")).replace("sha256:", "");

  await fs.mkdir(path.dirname(keyFilePath), { recursive: true });
  await fs.writeFile(keyFilePath, privateKeyHex, "utf8");

  const publicKeyFilePath = `${keyFilePath}.pub`;
  await fs.writeFile(publicKeyFilePath, publicKeyHex, "utf8");

  return {
    keyFilePath,
    publicKeyFilePath,
    publicKeyHex,
    keyId,
  };
}

export async function writePublicKeyJson(
  workpiecePublicDir: string,
  keyId: string,
  publicKeyHex: string,
): Promise<string> {
  const wellKnownDir = path.join(workpiecePublicDir, ".well-known");
  const pubKeyPath = path.join(wellKnownDir, "nachweis-pubkey.json");

  const existing: NachweisPublicKeyEntry[] = existsSync(pubKeyPath)
    ? safeReadJson<NachweisPublicKeyEntry[]>(pubKeyPath, [])
    : [];

  const updated: NachweisPublicKeyEntry[] = existing.map((e) => ({
    ...e,
    status: "retired" as const,
  }));
  updated.push({
    keyId,
    publicKeyHex,
    status: "current" as const,
    createdAt: new Date().toISOString(),
  });

  await fs.mkdir(wellKnownDir, { recursive: true });
  await writeFileIfChanged(pubKeyPath, JSON.stringify(updated, null, 2) + "\n");
  return pubKeyPath;
}

function safeReadJson<T>(filePath: string, fallback: T): T {
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function runNachweisKeyEnsure(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisKeyEnsureResult>> {
  const keyFilePath = flagString(input, "key-file");
  const force = flagBool(input, "force");

  if (!keyFilePath) throw new Error("[nachweis.key.ensure] --key-file is required");

  const result = await ensureNachweisKey(keyFilePath, force);

  const workpieceDir = context.site?.directory
    ? path.join(context.workspaceRoot, context.site.directory)
    : null;

  let pubKeyJsonPath: string | null = null;
  if (workpieceDir && existsSync(workpieceDir)) {
    const workpiecePublicDir = path.join(workpieceDir, "public");
    if (existsSync(workpiecePublicDir)) {
      pubKeyJsonPath = await writePublicKeyJson(
        workpiecePublicDir,
        result.keyId,
        result.publicKeyHex,
      );
    }
  }

  return {
    data: result,
    exitCode: 0,
    summary: `[nachweis.key.ensure] generated Ed25519 keypair (keyId: ${result.keyId.slice(0, 12)}…) → ${keyFilePath}${pubKeyJsonPath ? `, published to ${pubKeyJsonPath}` : ""}`,
  };
}
