/*
<MODULE_CONTRACT>
<purpose>RFC-0968: Unit tests for handover authorization logic — signing, verification,
file IO, expiry, hash determinism, forgery detection, and bordbuch duplicate rejection.</purpose>
<keywords>RFC-0968, handover, authorization, ed25519, unit test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0968: initial handover unit tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeAuthorizationHash,
  signAuthorization,
  verifyAuthorization,
  resolveAuthorizationPath,
  readAuthorization,
  writeAuthorization,
  removeAuthorization,
  isAuthorizationExpired,
  type HandoverAuthorizationV1,
} from "./handover.ts";
import { generateKeyPair, toHex } from "@warpgogol/werkstatt-engine/signing";
import { appendBordbuchEntry, readBordbuch } from "../bordbuch/bordbuch-io.ts";

let tmpDir: string;
let werkstattRoot: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "handover-test-"));
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

  return cacheDir;
}

function makePayload(overrides?: Partial<HandoverAuthorizationV1>): HandoverAuthorizationV1 {
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    schema: "handover-authorization/v1",
    systemId: "test-site",
    sender: {
      identity: "human:sender",
      publicKey: "aabbccdd",
    },
    recipient: {
      identity: "human:recipient",
      publicKey: "eeff0011",
    },
    passportHash: "sha256:abcdef",
    bordbuchHead: "sha256:head123",
    authorizedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    ...overrides,
  };
}

describe("RFC-0968: handover authorization core logic", () => {
  test("signAuthorization produces valid signed authorization", async () => {
    const keyPair = await generateKeyPair();
    const payload = makePayload({
      sender: { identity: "human:sender", publicKey: toHex(keyPair.publicKey) },
    });

    const doc = await signAuthorization(payload, keyPair.privateKey);

    expect(doc.authorizationHash).toMatch(/^sha256:/);
    expect(doc.signature).toMatch(/^[0-9a-f]+$/);
    expect(doc.payload).toEqual(payload);
  });

  test("verifyAuthorization succeeds with correct sender public key", async () => {
    const keyPair = await generateKeyPair();
    const payload = makePayload({
      sender: { identity: "human:sender", publicKey: toHex(keyPair.publicKey) },
    });

    const doc = await signAuthorization(payload, keyPair.privateKey);
    const result = await verifyAuthorization(doc, toHex(keyPair.publicKey));

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("forgery test: tampered authorization payload fails verification", async () => {
    const keyPair = await generateKeyPair();
    const payload = makePayload({
      sender: { identity: "human:sender", publicKey: toHex(keyPair.publicKey) },
    });

    const doc = await signAuthorization(payload, keyPair.privateKey);

    // Tamper with the payload
    const tampered: typeof doc = {
      ...doc,
      payload: { ...doc.payload, recipient: { identity: "human:attacker", publicKey: "deadbeef" } },
    };
    const result = await verifyAuthorization(tampered, toHex(keyPair.publicKey));

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("verifyAuthorization fails with wrong sender public key", async () => {
    const keyPair = await generateKeyPair();
    const wrongKeyPair = await generateKeyPair();
    const payload = makePayload({
      sender: { identity: "human:sender", publicKey: toHex(keyPair.publicKey) },
    });

    const doc = await signAuthorization(payload, keyPair.privateKey);
    const result = await verifyAuthorization(doc, toHex(wrongKeyPair.publicKey));

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("signature verification failed"))).toBe(true);
  });

  test("authorization hash determinism: same payload produces same hash", () => {
    const payload1 = makePayload();
    const payload2 = makePayload();

    // Same content (except timestamps which are the same since makePayload is deterministic within the same call)
    expect(computeAuthorizationHash(payload1)).toBe(computeAuthorizationHash(payload2));
  });

  test("authorization hash changes when payload changes", () => {
    const payload1 = makePayload();
    const payload2 = makePayload({ systemId: "different-site" });

    expect(computeAuthorizationHash(payload1)).not.toBe(computeAuthorizationHash(payload2));
  });

  test("isAuthorizationExpired returns false for future expiry", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isAuthorizationExpired(future)).toBe(false);
  });

  test("isAuthorizationExpired returns true for past expiry", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isAuthorizationExpired(past)).toBe(true);
  });
});

describe("RFC-0968: handover authorization file IO", () => {
  test("writeAuthorization + readAuthorization round-trip", async () => {
    const systemId = "test-site";
    setupSystem(systemId);
    const keyPair = await generateKeyPair();
    const payload = makePayload({
      systemId,
      sender: { identity: "human:sender", publicKey: toHex(keyPair.publicKey) },
    });
    const doc = await signAuthorization(payload, keyPair.privateKey);

    await writeAuthorization(werkstattRoot, systemId, doc);
    const read = await readAuthorization(werkstattRoot, systemId);

    expect(read).not.toBeNull();
    expect(read!.authorizationHash).toBe(doc.authorizationHash);
    expect(read!.payload.systemId).toBe(systemId);
  });

  test("readAuthorization returns null when file does not exist", async () => {
    setupSystem("test-site");
    const result = await readAuthorization(werkstattRoot, "test-site");
    expect(result).toBeNull();
  });

  test("removeAuthorization removes the file and returns true", async () => {
    const systemId = "test-site";
    setupSystem(systemId);
    const keyPair = await generateKeyPair();
    const payload = makePayload({ systemId });
    const doc = await signAuthorization(payload, keyPair.privateKey);

    await writeAuthorization(werkstattRoot, systemId, doc);
    expect(existsSync(resolveAuthorizationPath(werkstattRoot, systemId))).toBe(true);

    const removed = await removeAuthorization(werkstattRoot, systemId);
    expect(removed).toBe(true);
    expect(existsSync(resolveAuthorizationPath(werkstattRoot, systemId))).toBe(false);
  });

  test("removeAuthorization returns false when file does not exist", async () => {
    setupSystem("test-site");
    const removed = await removeAuthorization(werkstattRoot, "test-site");
    expect(removed).toBe(false);
  });
});

describe("RFC-0968: bordbuch duplicate handover rejection", () => {
  test("appendBordbuchEntry rejects duplicate handover with same authorizationHash", async () => {
    const systemId = "test-site";
    setupSystem(systemId);

    const metadata = {
      from: "human:sender",
      to: "human:recipient",
      authorizationHash: "sha256:auth123",
      newPassportHash: "sha256:passport456",
    };

    await appendBordbuchEntry(
      werkstattRoot,
      systemId,
      "handover",
      "handover from sender to recipient",
      "human:recipient",
      { missionId: null, releaseId: null, metadata: metadata as Record<string, unknown> },
    );

    await expect(
      appendBordbuchEntry(
        werkstattRoot,
        systemId,
        "handover",
        "handover from sender to recipient",
        "human:recipient",
        { missionId: null, releaseId: null, metadata: metadata as Record<string, unknown> },
      ),
    ).rejects.toThrow(/duplicate handover/);
  });

  test("appendBordbuchEntry allows handover with different authorizationHash", async () => {
    const systemId = "test-site";
    setupSystem(systemId);

    const metadata1 = {
      from: "human:sender",
      to: "human:recipient",
      authorizationHash: "sha256:auth1",
      newPassportHash: "sha256:passport1",
    };
    const metadata2 = {
      from: "human:recipient",
      to: "human:third",
      authorizationHash: "sha256:auth2",
      newPassportHash: "sha256:passport2",
    };

    await appendBordbuchEntry(
      werkstattRoot,
      systemId,
      "handover",
      "first handover",
      "human:recipient",
      { missionId: null, releaseId: null, metadata: metadata1 as Record<string, unknown> },
    );

    await appendBordbuchEntry(
      werkstattRoot,
      systemId,
      "handover",
      "second handover",
      "human:third",
      { missionId: null, releaseId: null, metadata: metadata2 as Record<string, unknown> },
    );

    const entries = await readBordbuch(werkstattRoot, systemId);
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("handover");
    expect(entries[1].kind).toBe("handover");
  });

  test("bordbuch chain integrity: handover entry has correct previousHash", async () => {
    const systemId = "test-site";
    setupSystem(systemId);

    await appendBordbuchEntry(
      werkstattRoot,
      systemId,
      "mission-open",
      "mission opened",
      "human:operator",
      { missionId: "test-site-m000001", releaseId: null },
    );

    const metadata = {
      from: "human:sender",
      to: "human:recipient",
      authorizationHash: "sha256:auth123",
      newPassportHash: "sha256:passport456",
    };

    const entry = await appendBordbuchEntry(
      werkstattRoot,
      systemId,
      "handover",
      "handover event",
      "human:recipient",
      { missionId: null, releaseId: null, metadata: metadata as Record<string, unknown> },
    );

    const entries = await readBordbuch(werkstattRoot, systemId);
    expect(entries).toHaveLength(2);
    expect(entry.previousHash).toBe(entries[0].hash);
    expect(entry.kind).toBe("handover");
    expect((entry.metadata as Record<string, unknown>).authorizationHash).toBe("sha256:auth123");
  });
});
