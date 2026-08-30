/*
<MODULE_CONTRACT>
<purpose>RFC-0988: Unit tests for --dry-run flag on sternsystem.handover.prepare
and sternsystem.handover.complete. Verifies side-effect-free behavior, preview data,
and error cases.</purpose>
<keywords>RFC-0988, dry-run, handover, testing, side-effect-free</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0988: initial dry-run unit tests for handover prepare and complete.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { generateKeyPair, toHex, toPem } from "@warpgogol/werkstatt-engine/signing";
import { buildPassportPayload, signPassport, type SignedSitePassport } from "./passport.ts";
import { writePassport } from "./registry-io.ts";
import {
  signAuthorization,
  type HandoverAuthorizationV1,
  type SignedHandoverAuthorization,
} from "./handover.ts";
import { runSternsystemHandoverPrepare } from "./sternsystem-handover-prepare.ts";
import { runSternsystemHandoverComplete } from "./sternsystem-handover-complete.ts";
import { resolveAuthorizationPath } from "./handover.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "handover-dry-run-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return {
    flags: flags as Record<string, import("@warpgogol/werkstatt-engine/kernel").KernelFlagValue>,
    argv: [],
  };
}

function makeContext(root: string): KernelRuntimeContext {
  return {
    workspaceRoot: root,
    logger: {
      section: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
    dryRun: false,
  } as unknown as KernelRuntimeContext;
}

function setupSystem(root: string, systemId: string): void {
  const cacheDir = join(root, "..", "systems-cache", systemId);
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
    }) + "\n",
  );
}

async function setupPassport(
  root: string,
  systemId: string,
  keyPair: { publicKey: Uint8Array; privateKey: Uint8Array },
  identity: string,
): Promise<SignedSitePassport> {
  const payload = await buildPassportPayload({
    systemId,
    werkstattRoot: root,
    creatorIdentity: identity,
    creatorPublicKey: toHex(keyPair.publicKey),
  });
  const { passportHash, signature } = await signPassport(payload, keyPair.privateKey);
  const passport: SignedSitePassport = { payload, passportHash, signature };
  await writePassport(root, systemId, passport);
  return passport;
}

describe("RFC-0988: handover.prepare --dry-run", () => {
  test("returns SignedHandoverAuthorization without writing to disk", async () => {
    const systemId = "dry-run-prepare-site";
    const root = join(tmpDir, "werkstatt");
    mkdirSync(root, { recursive: true });
    setupSystem(root, systemId);

    const senderKeyPair = await generateKeyPair();
    const passport = await setupPassport(root, systemId, senderKeyPair, "human:sender");

    const recipientKeyPair = await generateKeyPair();
    const recipientPublicKeyHex = toHex(recipientKeyPair.publicKey);

    process.env.SIGNING_PRIVATE_KEY = toPem(senderKeyPair.privateKey, "private");

    const result = await runSternsystemHandoverPrepare(
      makeInput({
        id: systemId,
        "recipient-identity": "human:recipient",
        "recipient-public-key": recipientPublicKeyHex,
        "dry-run": true,
      }),
      makeContext(root),
    );

    expect(result.data!.dryRun).toBe(true);
    expect(result.data!.signedAuthorization).toBeDefined();
    expect(result.data!.signedAuthorization!.authorizationHash).toBeDefined();
    expect(result.data!.signedAuthorization!.signature).toBeDefined();
    expect(result.data!.signedAuthorization!.payload.recipient.identity).toBe("human:recipient");
    expect(result.data!.signedAuthorization!.payload.passportHash).toBe(passport.passportHash);

    const authPath = resolveAuthorizationPath(root, systemId);
    expect(existsSync(authPath)).toBe(false);

    delete process.env.SIGNING_PRIVATE_KEY;
  });

  test("non-dry-run still writes to disk", async () => {
    const systemId = "non-dry-run-prepare-site";
    const root = join(tmpDir, "werkstatt");
    mkdirSync(root, { recursive: true });
    setupSystem(root, systemId);

    const senderKeyPair = await generateKeyPair();
    await setupPassport(root, systemId, senderKeyPair, "human:sender");

    const recipientKeyPair = await generateKeyPair();
    const recipientPublicKeyHex = toHex(recipientKeyPair.publicKey);

    process.env.SIGNING_PRIVATE_KEY = toPem(senderKeyPair.privateKey, "private");

    const result = await runSternsystemHandoverPrepare(
      makeInput({
        id: systemId,
        "recipient-identity": "human:recipient",
        "recipient-public-key": recipientPublicKeyHex,
      }),
      makeContext(root),
    );

    expect(result.data!.dryRun).toBe(false);
    expect(result.data!.signedAuthorization).toBeUndefined();
    expect(result.data!.authorizationPath).not.toBe("");

    const authPath = resolveAuthorizationPath(root, systemId);
    expect(existsSync(authPath)).toBe(true);

    delete process.env.SIGNING_PRIVATE_KEY;
  });
});

describe("RFC-0988: handover.complete --dry-run", () => {
  async function setupCompleteScenario(
    root: string,
    systemId: string,
  ): Promise<{
    signedAuth: SignedHandoverAuthorization;
    recipientKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array };
  }> {
    mkdirSync(root, { recursive: true });
    setupSystem(root, systemId);

    const senderKeyPair = await generateKeyPair();
    const passport = await setupPassport(root, systemId, senderKeyPair, "human:sender");

    const recipientKeyPair = await generateKeyPair();
    const recipientPublicKeyHex = toHex(recipientKeyPair.publicKey);

    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const authPayload: HandoverAuthorizationV1 = {
      schema: "handover-authorization/v1",
      systemId,
      sender: { identity: "human:sender", publicKey: toHex(senderKeyPair.publicKey) },
      recipient: { identity: "human:recipient", publicKey: recipientPublicKeyHex },
      passportHash: passport.passportHash,
      bordbuchHead: "",
      authorizedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };

    const signedAuth = await signAuthorization(authPayload, senderKeyPair.privateKey);
    return { signedAuth, recipientKeyPair };
  }

  test("returns preview data without writing to disk", async () => {
    const systemId = "dry-run-complete-site";
    const root = join(tmpDir, "werkstatt");
    const { signedAuth, recipientKeyPair } = await setupCompleteScenario(root, systemId);

    process.env.SIGNING_PRIVATE_KEY = toPem(recipientKeyPair.privateKey, "private");

    const result = await runSternsystemHandoverComplete(
      makeInput({
        id: systemId,
        "dry-run": true,
        "authorization-data": JSON.stringify(signedAuth),
      }),
      makeContext(root),
    );

    expect(result.data!.dryRun).toBe(true);
    expect(result.data!.newPassportHashPreview).toBeDefined();
    expect(result.data!.bordbuchEventPreview).toBeDefined();
    expect(result.data!.bordbuchEventPreview!.kind).toBe("handover");
    expect(result.data!.bordbuchEventPreview!.metadata.authorizationHash).toBe(
      signedAuth.authorizationHash,
    );
    expect(result.data!.registryTransferPreview).toBeDefined();
    expect(result.data!.registryTransferPreview!.previousOwner).toBe("human:sender");
    expect(result.data!.registryTransferPreview!.newOwner).toBe("human:recipient");

    const authPath = resolveAuthorizationPath(root, systemId);
    expect(existsSync(authPath)).toBe(false);

    delete process.env.SIGNING_PRIVATE_KEY;
  });

  test("fails without --authorization-data", async () => {
    const systemId = "dry-run-no-auth-data-site";
    const root = join(tmpDir, "werkstatt");
    const { recipientKeyPair } = await setupCompleteScenario(root, systemId);

    process.env.SIGNING_PRIVATE_KEY = toPem(recipientKeyPair.privateKey, "private");

    await expect(
      runSternsystemHandoverComplete(
        makeInput({ id: systemId, "dry-run": true }),
        makeContext(root),
      ),
    ).rejects.toThrow(/authorization-data is required in dry-run mode/);

    delete process.env.SIGNING_PRIVATE_KEY;
  });

  test("fails with --source-locator", async () => {
    const systemId = "dry-run-source-locator-site";
    const root = join(tmpDir, "werkstatt");
    const { signedAuth, recipientKeyPair } = await setupCompleteScenario(root, systemId);

    process.env.SIGNING_PRIVATE_KEY = toPem(recipientKeyPair.privateKey, "private");

    await expect(
      runSternsystemHandoverComplete(
        makeInput({
          id: systemId,
          "dry-run": true,
          "authorization-data": JSON.stringify(signedAuth),
          "source-locator": "some-remote",
        }),
        makeContext(root),
      ),
    ).rejects.toThrow(/source-locator is incompatible with --dry-run/);

    delete process.env.SIGNING_PRIVATE_KEY;
  });

  test("fails with invalid JSON in --authorization-data", async () => {
    const systemId = "dry-run-invalid-json-site";
    const root = join(tmpDir, "werkstatt");
    const { recipientKeyPair } = await setupCompleteScenario(root, systemId);

    process.env.SIGNING_PRIVATE_KEY = toPem(recipientKeyPair.privateKey, "private");

    await expect(
      runSternsystemHandoverComplete(
        makeInput({ id: systemId, "dry-run": true, "authorization-data": "not-valid-json" }),
        makeContext(root),
      ),
    ).rejects.toThrow(/invalid authorization-data JSON/);

    delete process.env.SIGNING_PRIVATE_KEY;
  });

  test("fails with expired authorization (HANDOVER-02)", async () => {
    const systemId = "dry-run-expired-site";
    const root = join(tmpDir, "werkstatt");
    const { signedAuth, recipientKeyPair } = await setupCompleteScenario(root, systemId);

    const expiredAuth: SignedHandoverAuthorization = {
      ...signedAuth,
      payload: {
        ...signedAuth.payload,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    };

    process.env.SIGNING_PRIVATE_KEY = toPem(recipientKeyPair.privateKey, "private");

    await expect(
      runSternsystemHandoverComplete(
        makeInput({
          id: systemId,
          "dry-run": true,
          "authorization-data": JSON.stringify(expiredAuth),
        }),
        makeContext(root),
      ),
    ).rejects.toThrow(/HANDOVER-02/);

    delete process.env.SIGNING_PRIVATE_KEY;
  });

  test("fails with wrong recipient key (HANDOVER-04)", async () => {
    const systemId = "dry-run-wrong-key-site";
    const root = join(tmpDir, "werkstatt");
    const { signedAuth } = await setupCompleteScenario(root, systemId);

    const wrongKeyPair = await generateKeyPair();
    process.env.SIGNING_PRIVATE_KEY = toPem(wrongKeyPair.privateKey, "private");

    await expect(
      runSternsystemHandoverComplete(
        makeInput({
          id: systemId,
          "dry-run": true,
          "authorization-data": JSON.stringify(signedAuth),
        }),
        makeContext(root),
      ),
    ).rejects.toThrow(/HANDOVER-04/);

    delete process.env.SIGNING_PRIVATE_KEY;
  });
});
