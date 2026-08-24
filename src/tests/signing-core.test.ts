/*
<MODULE_CONTRACT>
<purpose>RFC-0921: Unit tests for the shared signing core — sign/verify round-trip, key generation, canonicalization.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0921: initial signing core unit tests.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  toHex,
  fromHex,
  toPem,
  fromPem,
  canonicalBytes,
  signBytes,
  verifyBytes,
  sign,
  verify,
} from "../signing/index.ts";

describe("signing core — key generation", () => {
  it("generates a valid Ed25519 keypair (32-byte private + 32-byte public)", async () => {
    const keyPair = await generateKeyPair();
    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.privateKey.length).toBe(32);
    expect(keyPair.publicKey.length).toBe(32);
  });

  it("generates unique keypairs on each call", async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    expect(toHex(a.privateKey)).not.toBe(toHex(b.privateKey));
    expect(toHex(a.publicKey)).not.toBe(toHex(b.publicKey));
  });
});

describe("signing core — encoding helpers", () => {
  it("toHex / fromHex round-trip", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 64]);
    const hex = toHex(bytes);
    expect(hex).toBe("000102ff8040");
    expect(fromHex(hex)).toEqual(bytes);
  });

  it("toPem / fromPem round-trip for private key", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const pem = toPem(bytes, "private");
    expect(pem).toContain("-----BEGIN PRIVATE KEY-----");
    expect(pem).toContain("-----END PRIVATE KEY-----");
    expect(fromPem(pem)).toEqual(bytes);
  });

  it("toPem / fromPem round-trip for public key", () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const pem = toPem(bytes, "public");
    expect(pem).toContain("-----BEGIN PUBLIC KEY-----");
    expect(pem).toContain("-----END PUBLIC KEY-----");
    expect(fromPem(pem)).toEqual(bytes);
  });
});

describe("signing core — sign/verify", () => {
  it("sign and verify round-trip with payload", async () => {
    const keyPair = await generateKeyPair();
    const payload = { buildId: "test-123", signedAt: "2026-08-22T00:00:00Z", outputsDigest: "abc" };
    const signature = await sign(keyPair.privateKey, payload);
    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(64);

    const valid = await verify(keyPair.publicKey, payload, signature);
    expect(valid).toBe(true);
  });

  it("verification fails with tampered payload", async () => {
    const keyPair = await generateKeyPair();
    const payload = { buildId: "test-123", signedAt: "2026-08-22" };
    const signature = await sign(keyPair.privateKey, payload);

    const tampered = { buildId: "tampered", signedAt: "2026-08-22" };
    const valid = await verify(keyPair.publicKey, tampered, signature);
    expect(valid).toBe(false);
  });

  it("verification fails with wrong public key", async () => {
    const keyPairA = await generateKeyPair();
    const keyPairB = await generateKeyPair();
    const payload = { test: "data" };
    const signature = await sign(keyPairA.privateKey, payload);

    const valid = await verify(keyPairB.publicKey, payload, signature);
    expect(valid).toBe(false);
  });

  it("signBytes / verifyBytes round-trip with raw message", async () => {
    const keyPair = await generateKeyPair();
    const message = new TextEncoder().encode("hello world");
    const signature = await signBytes(keyPair.privateKey, message);
    expect(signature.length).toBe(64);

    const valid = await verifyBytes(keyPair.publicKey, message, signature);
    expect(valid).toBe(true);
  });

  it("verifyBytes returns false on invalid signature (not throw)", async () => {
    const keyPair = await generateKeyPair();
    const message = new TextEncoder().encode("test");
    const badSignature = new Uint8Array(64);
    const valid = await verifyBytes(keyPair.publicKey, message, badSignature);
    expect(valid).toBe(false);
  });
});

describe("signing core — canonicalBytes", () => {
  it("produces deterministic bytes regardless of key order", () => {
    const a = canonicalBytes({ b: 2, a: 1, c: 3 });
    const b = canonicalBytes({ a: 1, c: 3, b: 2 });
    expect(a).toEqual(b);
  });

  it("produces different bytes for different payloads", () => {
    const a = canonicalBytes({ a: 1 });
    const b = canonicalBytes({ a: 2 });
    expect(a).not.toEqual(b);
  });
});
