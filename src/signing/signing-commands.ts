/*
<MODULE_CONTRACT>
<purpose>RFC-0921: signing.key.generate command handler — generates Ed25519 keypairs and saves them to disk.</purpose>


<non-goals>
  <item>Does not publish keys — that is a consumer concern (Nachweis, Integrity).</item>
  <item>Does not compute key IDs — that is domain-specific.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0921: initial signing.key.generate command handler.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { generateKeyPair, saveKeyPair, keyExists, toHex } from "./index.ts";
import type { KeyEncoding } from "./types.ts";

export interface SigningKeyGenerateResult {
  privateKeyPath: string;
  publicKeyPath: string;
  publicKeyHex: string;
  encoding: KeyEncoding;
}

function flagString(input: KernelCommandInput, name: string): string | undefined {
  const v = input.flags[name];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, name: string): boolean {
  const v = input.flags[name];
  return v === true || v === "true";
}

export async function runSigningKeyGenerate(
  input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelCommandResult<SigningKeyGenerateResult>> {
  const outputDir = flagString(input, "output-dir");
  const encoding = (flagString(input, "encoding") ?? "hex") as KeyEncoding;
  const force = flagBool(input, "force");

  if (!outputDir) throw new Error("[signing.key.generate] --output-dir is required");
  if (encoding !== "hex" && encoding !== "pem") {
    throw new Error(`[signing.key.generate] --encoding must be "hex" or "pem", got "${encoding}"`);
  }

  if (keyExists(`${outputDir}/signing.key${encoding === "pem" ? ".pem" : ""}`) && !force) {
    throw new Error(
      `[signing.key.generate] KEY_FILE_EXISTS: key file already exists in '${outputDir}'. Use --force to overwrite.`,
    );
  }

  const keyPair = await generateKeyPair();
  const { privateKeyPath, publicKeyPath } = await saveKeyPair(keyPair, outputDir, encoding);

  return {
    data: {
      privateKeyPath,
      publicKeyPath,
      publicKeyHex: toHex(keyPair.publicKey),
      encoding,
    },
    exitCode: 0,
    summary: `[signing.key.generate] generated Ed25519 keypair (${encoding}) → ${outputDir}`,
  };
}
