/*
<MODULE_CONTRACT>
<purpose>RFC-0921: Shared Ed25519 key management — generation, loading, saving, and encoding helpers.</purpose>
<keywords>ed25519, key, generate, hex, pem, encoding</keywords>
<responsibilities>
  <item>Generates Ed25519 keypairs using @noble/ed25519.</item>
  <item>Loads private and public keys from hex strings, PEM strings, or file paths.</item>
  <item>Saves keypairs to disk in hex or PEM encoding.</item>
  <item>Provides encoding helpers: toHex, fromHex, toPem, fromPem.</item>
</responsibilities>
<non-goals>
  <item>Does not implement signing or verification — those live in sign.ts.</item>
  <item>Does not manage key publication or key rotation — domain-specific concerns belong in consumers.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0921: initial signing key management module.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createPrivateKey, createPublicKey } from "node:crypto";
import * as ed from "@noble/ed25519";
import type { KeyEncoding, SigningKeyPair } from "./types.ts";

export async function generateKeyPair(): Promise<SigningKeyPair> {
  const privateKey = ed.utils.randomSecretKey();
  const publicKey = await getPublicKey(privateKey);
  return { privateKey, publicKey };
}

export async function getPublicKey(privateKey: Uint8Array): Promise<Uint8Array> {
  return ed.getPublicKeyAsync(privateKey);
}

export async function loadPrivateKey(
  source: { pem: string } | { hex: string } | { filePath: string; encoding: KeyEncoding },
): Promise<Uint8Array> {
  if ("pem" in source) {
    return fromPem(source.pem);
  }
  if ("hex" in source) {
    return fromHex(source.hex);
  }
  const raw = (await fs.readFile(source.filePath, "utf8")).trim();
  if (source.encoding === "pem") {
    return fromPem(raw);
  }
  return fromHex(raw);
}

export async function loadPublicKey(
  source: { pem: string } | { hex: string } | { filePath: string; encoding: KeyEncoding },
): Promise<Uint8Array> {
  if ("pem" in source) {
    return fromPem(source.pem);
  }
  if ("hex" in source) {
    return fromHex(source.hex);
  }
  const raw = (await fs.readFile(source.filePath, "utf8")).trim();
  if (source.encoding === "pem") {
    return fromPem(raw);
  }
  return fromHex(raw);
}

export async function saveKeyPair(
  keyPair: SigningKeyPair,
  outputDir: string,
  encoding: KeyEncoding,
): Promise<{ privateKeyPath: string; publicKeyPath: string }> {
  await fs.mkdir(outputDir, { recursive: true });

  const privateKeyPath = path.join(outputDir, `signing.key${encoding === "pem" ? ".pem" : ""}`);
  const publicKeyPath = path.join(outputDir, `signing.key.pub${encoding === "pem" ? ".pem" : ""}`);

  if (encoding === "pem") {
    await fs.writeFile(privateKeyPath, toPem(keyPair.privateKey, "private"), "utf8");
    await fs.writeFile(publicKeyPath, toPem(keyPair.publicKey, "public"), "utf8");
  } else {
    await fs.writeFile(privateKeyPath, toHex(keyPair.privateKey), "utf8");
    await fs.writeFile(publicKeyPath, toHex(keyPair.publicKey), "utf8");
  }

  return { privateKeyPath, publicKeyPath };
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

export function toPem(bytes: Uint8Array, type: "private" | "public"): string {
  const label = type === "private" ? "PRIVATE KEY" : "PUBLIC KEY";
  const base64 = Buffer.from(bytes).toString("base64");
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export function fromPem(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  return new Uint8Array(Buffer.from(base64, "base64"));
}

export function privateKeyPemToBytes(pem: string): Uint8Array {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(
      `Wrong private key type: ${key.asymmetricKeyType ?? "unknown"}. Expected ed25519.`,
    );
  }
  const jwk = key.export({ format: "jwk" }) as { d: string };
  return new Uint8Array(Buffer.from(jwk.d, "base64url"));
}

export function publicKeyPemToBytes(pem: string): Uint8Array {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(
      `Wrong public key type: ${key.asymmetricKeyType ?? "unknown"}. Expected ed25519.`,
    );
  }
  const jwk = key.export({ format: "jwk" }) as { x: string };
  return new Uint8Array(Buffer.from(jwk.x, "base64url"));
}

export function keyExists(filePath: string): boolean {
  return existsSync(filePath);
}
