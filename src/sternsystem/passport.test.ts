/*
<MODULE_CONTRACT>
<purpose>RFC-0966: Unit tests for passport core logic — buildPassportPayload,
signPassport, verifyPassport, computePassportHash, derivePublicKey.</purpose>
<keywords>RFC-0966, passport, signing, ed25519, unit test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0966: initial passport unit tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPassportPayload,
  signPassport,
  verifyPassport,
  computePassportHash,
  derivePublicKey,
  type SitePassportV1,
  type SignedSitePassport,
} from "./passport.ts";
import { generateKeyPair, toHex } from "@warpgogol/werkstatt-engine/signing";
import { writePassport, readPassport, resolvePassportPath } from "./registry-io.ts";

let tmpDir: string;
let werkstattRoot: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "passport-test-"));
  werkstattRoot = join(tmpDir, "werkstatt");
  mkdirSync(werkstattRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function setupSystem(systemId: string): string {
  const cacheDir = join(tmpDir, "systems-cache", systemId);
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(join(cacheDir, "missions"), { recursive: true });
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });

  writeFileSync(
    join(cacheDir, "system-config.yaml"),
    [
      `schemaVersion: system-config/v1`,
      `id: ${systemId}`,
      `cosmicStar: Vega`,
      `mirrors:`,
      `  - path: ../systems-cache/${systemId}`,
      `    storageType: non-bare`,
      `  - path: ../systems-git/${systemId}.git`,
      `    storageType: bare`,
      `pinnedPlatform: 6.0.0`,
      `status: active`,
      `registeredAt: "2026-01-01T00:00:00Z"`,
      `notes: ""`,
      ``,
    ].join("\n"),
  );

  writeFileSync(
    join(cacheDir, "system.pin.json"),
    JSON.stringify({
      platform: {
        version: "6.0.0",
        platformSemanticHash:
          "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      },
    }),
  );

  writeFileSync(
    join(cacheDir, ".env.example"),
    ["# Example env", "API_KEY=your-key-here", "DATABASE_URL=postgres://localhost/db", ""].join(
      "\n",
    ),
  );

  return cacheDir;
}

describe("RFC-0966: passport core logic", () => {
  test("buildPassportPayload assembles correct payload from system files", async () => {
    const systemId = "test-site";
    setupSystem(systemId);

    const keyPair = await generateKeyPair();
    const publicKeyHex = toHex(keyPair.publicKey);

    const payload = await buildPassportPayload({
      systemId,
      werkstattRoot: werkstattRoot,
      creatorIdentity: "human:operator",
      creatorPublicKey: publicKeyHex,
    });

    expect(payload.schema).toBe("site-passport/v1");
    expect(payload.systemId).toBe(systemId);
    expect(payload.creator.identity).toBe("human:operator");
    expect(payload.creator.publicKey).toBe(publicKeyHex);
    expect(payload.platform.version).toBe("6.0.0");
    expect(payload.provenance.bordbuchHead).toBeNull();
    expect(payload.provenance.missionCounter).toBe(0);
    expect(payload.resources.secretNames).toEqual(["API_KEY", "DATABASE_URL"]);
    expect(payload.resources.customDomains).toEqual([]);
    expect(payload.resources.vectorizeIndexes).toEqual([]);
    expect(payload.resources.r2Prefixes).toEqual([]);
    expect(payload.mirrors).toHaveLength(2);
    expect(payload.mirrors[0].role).toBe("cache");
    expect(payload.mirrors[1].role).toBe("bare");
  });

  test("signPassport produces deterministic hash and valid signature", async () => {
    const systemId = "test-sign";
    setupSystem(systemId);

    const keyPair = await generateKeyPair();
    const publicKeyHex = toHex(keyPair.publicKey);

    const payload = await buildPassportPayload({
      systemId,
      werkstattRoot: werkstattRoot,
      creatorIdentity: "human:operator",
      creatorPublicKey: publicKeyHex,
    });

    const { passportHash, signature } = await signPassport(payload, keyPair.privateKey);

    expect(passportHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(signature).toMatch(/^[0-9a-f]+$/);

    const { passportHash: hash2 } = await signPassport(payload, keyPair.privateKey);
    expect(hash2).toBe(passportHash);
  });

  test("verifyPassport succeeds for valid signed passport", async () => {
    const systemId = "test-verify";
    setupSystem(systemId);

    const keyPair = await generateKeyPair();
    const publicKeyHex = toHex(keyPair.publicKey);

    const payload = await buildPassportPayload({
      systemId,
      werkstattRoot: werkstattRoot,
      creatorIdentity: "human:operator",
      creatorPublicKey: publicKeyHex,
    });

    const { passportHash, signature } = await signPassport(payload, keyPair.privateKey);

    const doc: SignedSitePassport = { payload, passportHash, signature };
    const result = await verifyPassport(doc);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("verifyPassport fails for tampered payload", async () => {
    const systemId = "test-tamper";
    setupSystem(systemId);

    const keyPair = await generateKeyPair();
    const publicKeyHex = toHex(keyPair.publicKey);

    const payload = await buildPassportPayload({
      systemId,
      werkstattRoot: werkstattRoot,
      creatorIdentity: "human:operator",
      creatorPublicKey: publicKeyHex,
    });

    const { passportHash, signature } = await signPassport(payload, keyPair.privateKey);

    const tamperedPayload: SitePassportV1 = {
      ...payload,
      creator: { ...payload.creator, identity: "human:attacker" },
    };

    const doc: SignedSitePassport = { payload: tamperedPayload, passportHash, signature };
    const result = await verifyPassport(doc);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("verifyPassport fails for wrong signature key", async () => {
    const systemId = "test-wrong-key";
    setupSystem(systemId);

    const keyPair1 = await generateKeyPair();
    const keyPair2 = await generateKeyPair();
    const publicKeyHex = toHex(keyPair1.publicKey);

    const payload = await buildPassportPayload({
      systemId,
      werkstattRoot: werkstattRoot,
      creatorIdentity: "human:operator",
      creatorPublicKey: publicKeyHex,
    });

    const { passportHash } = await signPassport(payload, keyPair1.privateKey);
    const { signature } = await signPassport(payload, keyPair2.privateKey);

    const doc: SignedSitePassport = { payload, passportHash, signature };
    const result = await verifyPassport(doc);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("signature"))).toBe(true);
  });

  test("computePassportHash is deterministic", async () => {
    const systemId = "test-hash";
    setupSystem(systemId);

    const keyPair = await generateKeyPair();
    const publicKeyHex = toHex(keyPair.publicKey);

    const payload = await buildPassportPayload({
      systemId,
      werkstattRoot: werkstattRoot,
      creatorIdentity: "human:operator",
      creatorPublicKey: publicKeyHex,
    });

    const hash1 = computePassportHash(payload);
    const hash2 = computePassportHash(payload);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("derivePublicKey matches getPublicKey", async () => {
    const keyPair = await generateKeyPair();
    const derivedHex = await derivePublicKey(keyPair.privateKey);
    const expectedHex = toHex(keyPair.publicKey);
    expect(derivedHex).toBe(expectedHex);
  });

  test("mirror locators with credentials are sanitized", async () => {
    const systemId = "test-sanitize";
    const cacheDir = setupSystem(systemId);

    writeFileSync(
      join(cacheDir, "system-config.yaml"),
      [
        `schemaVersion: system-config/v1`,
        `id: ${systemId}`,
        `cosmicStar: Vega`,
        `mirrors:`,
        `  - path: ../systems-cache/${systemId}`,
        `    storageType: non-bare`,
        `  - path: https://user:pass@git.example.com/repo.git`,
        `    storageType: bare`,
        `pinnedPlatform: 6.0.0`,
        `status: active`,
        `registeredAt: "2026-01-01T00:00:00Z"`,
        `notes: ""`,
        ``,
      ].join("\n"),
    );

    const keyPair = await generateKeyPair();
    const publicKeyHex = toHex(keyPair.publicKey);

    const payload = await buildPassportPayload({
      systemId,
      werkstattRoot: werkstattRoot,
      creatorIdentity: "human:operator",
      creatorPublicKey: publicKeyHex,
    });

    expect(payload.mirrors[1].locator).toBe("https://git.example.com/repo.git");
    expect(payload.mirrors[1].locator).not.toContain("user:pass");
  });

  test("writePassport + readPassport round-trip", async () => {
    const systemId = "test-roundtrip";
    setupSystem(systemId);

    const keyPair = await generateKeyPair();
    const publicKeyHex = toHex(keyPair.publicKey);

    const payload = await buildPassportPayload({
      systemId,
      werkstattRoot: werkstattRoot,
      creatorIdentity: "human:operator",
      creatorPublicKey: publicKeyHex,
    });

    const { passportHash, signature } = await signPassport(payload, keyPair.privateKey);
    const doc: SignedSitePassport = { payload, passportHash, signature };

    const writtenPath = await writePassport(werkstattRoot, systemId, doc);
    expect(writtenPath).toBe(resolvePassportPath(werkstattRoot, systemId));

    const readDoc = await readPassport(werkstattRoot, systemId);
    expect(readDoc).not.toBeNull();
    expect(readDoc!.passportHash).toBe(passportHash);
    expect(readDoc!.signature).toBe(signature);
    expect(readDoc!.payload.systemId).toBe(systemId);

    const verifyResult = await verifyPassport(readDoc!);
    expect(verifyResult.valid).toBe(true);
  });

  test("readPassport returns null when passport.json does not exist", async () => {
    const systemId = "test-no-passport";
    setupSystem(systemId);

    const result = await readPassport(werkstattRoot, systemId);
    expect(result).toBeNull();
  });
});
