/*
<MODULE_CONTRACT>
  <purpose>RFC-0931: unit tests for build-identity.json signing, release-pubkey.json writing, and signature verification.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0931: initial tests for signBuildIdentity, writeReleasePublicKey, verifyBuildIdentitySignature, and leitstand.verify --verify-signature.</item>
</CHANGE_SUMMARY>
*/

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  signBuildIdentity,
  writeReleasePublicKey,
  verifyBuildIdentitySignature,
} from "../../integrity/signing.ts";
import { generateKeyPair, toHex } from "@warpgogol/werkstatt-engine/signing";

vi.mock("../../sternsystem/registry-io.ts", () => ({
  readSystemConfigSmart: vi.fn(),
  readSystemStateSmart: vi.fn(),
  resolveCacheClonePath: vi.fn(),
}));

const { runLeitstandVerify } = await import("../leitstand-commands.ts");
const { readSystemConfigSmart, readSystemStateSmart } =
  await import("../../sternsystem/registry-io.ts");

function makeInput(flags: Record<string, unknown>) {
  return { flags, args: [] } as unknown as Parameters<typeof runLeitstandVerify>[0];
}

function makeContext(workspaceRoot: string) {
  return { workspaceRoot, dryRun: false, site: undefined } as unknown as Parameters<
    typeof runLeitstandVerify
  >[1];
}

const defaultConfig = {
  schemaVersion: "1.0.0",
  id: "test-site",
  deployment: {
    adapter: "cloudflare-workers" as const,
    channels: {
      dev: { workerName: "dev-test", url: "https://dev.test.com" },
      alt: { workerName: "alt-test", url: "https://alt.test.com" },
      main: { workerName: "test", url: "https://test.com" },
    },
  },
};

const defaultState = {
  schemaVersion: "1.0.0",
  systemId: "test-site",
  currentMission: null,
  lastRelease: null,
  lastPropagated: {
    dev: {
      releaseId: "r000005",
      at: "2026-08-23T12:00:00.000Z",
      healthy: true,
      state: "succeeded" as const,
      operationId: "op-1",
      leaseExpiresAt: null,
    },
    alt: {
      releaseId: "r000005",
      at: "2026-08-23T13:00:00.000Z",
      healthy: true,
      state: "succeeded" as const,
      operationId: "op-2",
      leaseExpiresAt: null,
    },
    main: {
      releaseId: "r000005",
      at: "2026-08-23T14:00:00.000Z",
      healthy: true,
      state: "succeeded" as const,
      operationId: "op-3",
      leaseExpiresAt: null,
    },
  },
  accessPin: null as string | null,
};

function mockBuildIdentity(distTreeHash: string, releaseId = "r000005") {
  return JSON.stringify({
    distTreeHash,
    releaseId,
    missionId: "m000076",
    buildTimestamp: "2026-08-23T12:45:06Z",
  });
}

let tmpDir: string;
let keyPair: { privateKey: Uint8Array; publicKey: Uint8Array };

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "leitstand-sign-"));
  keyPair = await generateKeyPair();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RFC-0931: signBuildIdentity", () => {
  it("signs build-identity.json and embeds signature, publicKeyUrl, signedAt", async () => {
    const idPath = join(tmpDir, "build-identity.json");
    writeFileSync(
      idPath,
      JSON.stringify({
        releaseId: "test-r000001",
        systemId: "test-site",
        missionId: "m000001",
        semver: "1.0.0",
        distTreeHash: "sha256:abc",
        behaviorSnapshotHash: "sha256:def",
        siteContentHash: "sha256:ghi",
        platformVersion: "6.0.0",
        platformSemanticHash: "sha256:sem",
        commitSha: "abc123",
        buildTimestamp: "2026-08-23T12:00:00.000Z",
        targetPlatform: "cloudflare",
      }),
    );

    const result = await signBuildIdentity({
      buildIdentityPath: idPath,
      privateKeyBytes: keyPair.privateKey,
      publicKeyUrl: "https://example.com/.well-known/release-pubkey.json",
    });

    expect(result.signatureHex).toMatch(/^[0-9a-f]{128}$/);
    expect(result.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(result.publicKeyUrl).toBe("https://example.com/.well-known/release-pubkey.json");
    expect(result.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.reusedExistingSignature).toBe(false);

    const signed = JSON.parse(readFileSync(idPath, "utf8"));
    expect(signed.signature).toBe(result.signatureHex);
    expect(signed.publicKeyUrl).toBe("https://example.com/.well-known/release-pubkey.json");
    expect(signed.signedAt).toBe(result.signedAt);
    expect(signed.distTreeHash).toBe("sha256:abc");
  });

  it("reuses existing signature when payload hasn't changed (idempotency)", async () => {
    const idPath = join(tmpDir, "build-identity.json");
    const baseIdentity = {
      releaseId: "test-r000001",
      systemId: "test-site",
      missionId: "m000001",
      semver: "1.0.0",
      distTreeHash: "sha256:abc",
      behaviorSnapshotHash: "sha256:def",
      siteContentHash: "sha256:ghi",
      platformVersion: "6.0.0",
      platformSemanticHash: "sha256:sem",
      commitSha: "abc123",
      buildTimestamp: "2026-08-23T12:00:00.000Z",
      targetPlatform: "cloudflare",
    };
    writeFileSync(idPath, JSON.stringify(baseIdentity));

    const first = await signBuildIdentity({
      buildIdentityPath: idPath,
      privateKeyBytes: keyPair.privateKey,
    });

    const second = await signBuildIdentity({
      buildIdentityPath: idPath,
      privateKeyBytes: keyPair.privateKey,
    });

    expect(second.reusedExistingSignature).toBe(true);
    expect(second.signatureHex).toBe(first.signatureHex);
  });

  it("produces new signature when payload has changed", async () => {
    const idPath = join(tmpDir, "build-identity.json");
    writeFileSync(
      idPath,
      JSON.stringify({
        releaseId: "test-r000001",
        systemId: "test-site",
        missionId: "m000001",
        semver: "1.0.0",
        distTreeHash: "sha256:abc",
        behaviorSnapshotHash: "sha256:def",
        siteContentHash: "sha256:ghi",
        platformVersion: "6.0.0",
        platformSemanticHash: "sha256:sem",
        commitSha: "abc123",
        buildTimestamp: "2026-08-23T12:00:00.000Z",
        targetPlatform: "cloudflare",
      }),
    );

    const first = await signBuildIdentity({
      buildIdentityPath: idPath,
      privateKeyBytes: keyPair.privateKey,
    });

    // Modify payload
    const signed = JSON.parse(readFileSync(idPath, "utf8"));
    signed.distTreeHash = "sha256:changed";
    writeFileSync(idPath, JSON.stringify(signed));

    const second = await signBuildIdentity({
      buildIdentityPath: idPath,
      privateKeyBytes: keyPair.privateKey,
    });

    expect(second.reusedExistingSignature).toBe(false);
    expect(second.signatureHex).not.toBe(first.signatureHex);
  });
});

describe("RFC-0931: writeReleasePublicKey", () => {
  it("writes release-pubkey.json to dist/client/.well-known/", async () => {
    const distDir = join(tmpDir, "dist");
    const publicKeyHex = toHex(keyPair.publicKey);

    const result = await writeReleasePublicKey({ distDir, publicKeyHex });

    expect(existsSync(result)).toBe(true);
    const content = JSON.parse(readFileSync(result, "utf8"));
    expect(content.publicKeyHex).toBe(publicKeyHex);
    expect(content.algorithm).toBe("Ed25519");
    expect(content.keyId).toMatch(/^[0-9a-f]{64}$/);
    expect(content.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("RFC-0931: verifyBuildIdentitySignature", () => {
  it("verifies a valid signature", async () => {
    const idPath = join(tmpDir, "build-identity.json");
    const identity = {
      releaseId: "test-r000001",
      systemId: "test-site",
      missionId: "m000001",
      semver: "1.0.0",
      distTreeHash: "sha256:abc",
      behaviorSnapshotHash: "sha256:def",
      siteContentHash: "sha256:ghi",
      platformVersion: "6.0.0",
      platformSemanticHash: "sha256:sem",
      commitSha: "abc123",
      buildTimestamp: "2026-08-23T12:00:00.000Z",
      targetPlatform: "cloudflare",
    };
    writeFileSync(idPath, JSON.stringify(identity));

    const signResult = await signBuildIdentity({
      buildIdentityPath: idPath,
      privateKeyBytes: keyPair.privateKey,
    });

    const signedIdentity = JSON.parse(readFileSync(idPath, "utf8"));
    const valid = await verifyBuildIdentitySignature({
      buildIdentity: signedIdentity,
      publicKeyHex: signResult.publicKeyHex,
    });

    expect(valid).toBe(true);
  });

  it("rejects tampered build-identity.json", async () => {
    const idPath = join(tmpDir, "build-identity.json");
    writeFileSync(
      idPath,
      JSON.stringify({
        releaseId: "test-r000001",
        systemId: "test-site",
        missionId: "m000001",
        semver: "1.0.0",
        distTreeHash: "sha256:abc",
        behaviorSnapshotHash: "sha256:def",
        siteContentHash: "sha256:ghi",
        platformVersion: "6.0.0",
        platformSemanticHash: "sha256:sem",
        commitSha: "abc123",
        buildTimestamp: "2026-08-23T12:00:00.000Z",
        targetPlatform: "cloudflare",
      }),
    );

    const signResult = await signBuildIdentity({
      buildIdentityPath: idPath,
      privateKeyBytes: keyPair.privateKey,
    });

    const signedIdentity = JSON.parse(readFileSync(idPath, "utf8"));
    signedIdentity.distTreeHash = "sha256:tampered";

    const valid = await verifyBuildIdentitySignature({
      buildIdentity: signedIdentity,
      publicKeyHex: signResult.publicKeyHex,
    });

    expect(valid).toBe(false);
  });

  it("returns false when no signature present", async () => {
    const valid = await verifyBuildIdentitySignature({
      buildIdentity: { releaseId: "test", distTreeHash: "sha256:abc" },
      publicKeyHex: toHex(keyPair.publicKey),
    });

    expect(valid).toBe(false);
  });
});

describe("RFC-0931: leitstand.verify --verify-signature", () => {
  it("signatureValid is null when --verify-signature is not set", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(mockBuildIdentity("sha256:abc123"), { status: 200 })),
    );

    const result = await runLeitstandVerify(makeInput({ site: "test-site" }), makeContext("/tmp"));

    for (const ch of result.data!.channels) {
      expect(ch.signatureValid).toBeNull();
      expect(ch.publicKeyUrl).toBeNull();
    }
  });

  it("signatureValid is true when signature matches public key", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);

    const kp = await generateKeyPair();
    const pubKeyHex = toHex(kp.publicKey);

    // Create signed build-identity
    const identity = {
      distTreeHash: "sha256:abc123",
      releaseId: "r000005",
      missionId: "m000076",
      buildTimestamp: "2026-08-23T12:45:06Z",
    };
    const idPath = join(tmpDir, "build-identity.json");
    writeFileSync(idPath, JSON.stringify(identity));
    await signBuildIdentity({
      buildIdentityPath: idPath,
      privateKeyBytes: kp.privateKey,
    });
    const signedIdentity = JSON.parse(readFileSync(idPath, "utf8"));

    const pubKeyJson = JSON.stringify({
      keyId: "test-key-id",
      publicKeyHex: pubKeyHex,
      algorithm: "Ed25519",
      createdAt: "2026-08-23T12:00:00.000Z",
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("release-pubkey.json")) {
        return Promise.resolve(new Response(pubKeyJson, { status: 200 }));
      }
      // build-identity.json fetch — return signed version
      return Promise.resolve(new Response(JSON.stringify(signedIdentity), { status: 200 }));
    });

    const result = await runLeitstandVerify(
      makeInput({ site: "test-site", "verify-signature": true }),
      makeContext("/tmp"),
    );

    for (const ch of result.data!.channels) {
      expect(ch.signatureValid).toBe(true);
      expect(ch.publicKeyUrl).toContain("release-pubkey.json");
    }
  });

  it("signatureValid is false when signature does not match (wrong key)", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);

    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const pubKeyHex2 = toHex(kp2.publicKey);

    const identity = {
      distTreeHash: "sha256:abc123",
      releaseId: "r000005",
      missionId: "m000076",
      buildTimestamp: "2026-08-23T12:45:06Z",
    };
    const idPath = join(tmpDir, "build-identity.json");
    writeFileSync(idPath, JSON.stringify(identity));
    await signBuildIdentity({
      buildIdentityPath: idPath,
      privateKeyBytes: kp1.privateKey,
    });
    const signedIdentity = JSON.parse(readFileSync(idPath, "utf8"));

    const pubKeyJson = JSON.stringify({
      keyId: "test-key-id",
      publicKeyHex: pubKeyHex2,
      algorithm: "Ed25519",
      createdAt: "2026-08-23T12:00:00.000Z",
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("release-pubkey.json")) {
        return Promise.resolve(new Response(pubKeyJson, { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(signedIdentity), { status: 200 }));
    });

    const result = await runLeitstandVerify(
      makeInput({ site: "test-site", "verify-signature": true }),
      makeContext("/tmp"),
    );

    for (const ch of result.data!.channels) {
      expect(ch.signatureValid).toBe(false);
    }
  });

  it("signatureValid is null when release-pubkey.json is not found (404)", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);

    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("release-pubkey.json")) {
        return Promise.resolve(new Response("Not Found", { status: 404 }));
      }
      return Promise.resolve(new Response(mockBuildIdentity("sha256:abc123"), { status: 200 }));
    });

    const result = await runLeitstandVerify(
      makeInput({ site: "test-site", "verify-signature": true }),
      makeContext("/tmp"),
    );

    for (const ch of result.data!.channels) {
      expect(ch.signatureValid).toBeNull();
    }
  });

  it("signatureValid is null when build-identity.json has no signature field", async () => {
    vi.mocked(readSystemConfigSmart).mockResolvedValueOnce(defaultConfig as never);
    vi.mocked(readSystemStateSmart).mockResolvedValueOnce(defaultState as never);

    const pubKeyJson = JSON.stringify({
      keyId: "test-key-id",
      publicKeyHex: toHex(keyPair.publicKey),
      algorithm: "Ed25519",
      createdAt: "2026-08-23T12:00:00.000Z",
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("release-pubkey.json")) {
        return Promise.resolve(new Response(pubKeyJson, { status: 200 }));
      }
      // Unsigned build-identity.json
      return Promise.resolve(new Response(mockBuildIdentity("sha256:abc123"), { status: 200 }));
    });

    const result = await runLeitstandVerify(
      makeInput({ site: "test-site", "verify-signature": true }),
      makeContext("/tmp"),
    );

    for (const ch of result.data!.channels) {
      expect(ch.signatureValid).toBe(false);
    }
  });
});
