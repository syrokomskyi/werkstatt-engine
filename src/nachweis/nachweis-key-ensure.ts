/*
<MODULE_CONTRACT>
<purpose>RFC-0715/RFC-0921: nachweis.key.ensure command handler — generates an Ed25519 keypair for Nachweis operator signatures via shared signing core.</purpose>


<non-goals>
  <item>Does not implement key rotation — that is a future RFC.</item>
  <item>Does not use multibase encoding — intentionally hex for simplicity (differs from passport).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0715: initial nachweis.key.ensure command handler.</item>
  <item>RFC-0715 review fix: import flagString/flagBool from nachweis-n3-types.ts.</item>
  <item>RFC-0921: delegate key generation to shared signing core (generateKeyPair, toHex). Remove @noble/ed25519 import.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
