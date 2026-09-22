/*
<MODULE_CONTRACT>
<purpose>RFC-0968/RFC-1124: tests for sternsystem.handover.complete — dry-run
shim plus the RFC-1124 Worker-unreachable path (handover completes, journaled
retry entry written).</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1124: AC-3/AC-7 coverage — Worker unreachable completes handover with journaled retry.</item>
</CHANGE_SUMMARY>
*/

import "./handover-dry-run.test.ts";

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-shared/kernel";
import { generateKeyPair, toHex, toPem } from "@warpgogol/werkstatt-engine/signing";
import { signAuthorization, writeAuthorization, type HandoverAuthorizationV1 } from "./handover.ts";
import { buildPassportPayload, signPassport, type SignedSitePassport } from "./passport.ts";
import { writePassport } from "./registry-io.ts";
import { runSternsystemHandoverComplete } from "./sternsystem-handover-complete.ts";

let tmpDir: string;
let recipientRoot: string;
const systemId = "handover-site";

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "handover-complete-"));
  // werkstatt root nested — systems-cache resolves as its sibling inside tmpDir.
  recipientRoot = join(tmpDir, "werkstatt");
  mkdirSync(recipientRoot, { recursive: true });
  for (const k of [
    "SIGNING_PRIVATE_KEY",
    "SIGNING_PRIVATE_KEY_PATH",
    "FLEET_OWNERSHIP_REGISTRY_URL",
  ]) {
    savedEnv[k] = process.env[k];
  }
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

function setupSystem(root: string, id: string): void {
  const cacheDir = join(root, "..", "systems-cache", id);
  mkdirSync(join(cacheDir, "missions"), { recursive: true });
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });
  writeFileSync(
    join(cacheDir, "system-config.yaml"),
    [
      `schemaVersion: system-config/v1`,
      `id: ${id}`,
      `cosmicStar: Vega`,
      `mirrors:`,
      `  - path: ../systems-cache/${id}`,
      `    storageType: non-bare`,
      `  - path: ../systems-git/${id}.git`,
      `    storageType: bare`,
      `pinnedPlatform: 6.0.0`,
      `status: active`,
      `registeredAt: "2026-01-01T00:00:00Z"`,
      `notes: ""`,
      ``,
    ].join("\n"),
  );
}

function mockContext(root: string): KernelRuntimeContext {
  const noop = () => {};
  return {
    workspaceRoot: root,
    logger: {
      info: noop,
      warn: noop,
      error: noop,
      success: noop,
      debug: noop,
      notice: noop,
    },
  } as unknown as KernelRuntimeContext;
}

describe("RFC-1124 AC-3/AC-7: handover.complete with unreachable Worker", () => {
  it("completes the handover and writes a journaled retry entry", async () => {
    setupSystem(recipientRoot, systemId);

    // Sender passport + signed authorization in the recipient's cache clone.
    const senderKeyPair = await generateKeyPair();
    const senderPayload = await buildPassportPayload({
      systemId,
      werkstattRoot: recipientRoot,
      creatorIdentity: "human:sender",
      creatorPublicKey: toHex(senderKeyPair.publicKey),
    });
    const senderSigned = await signPassport(senderPayload, senderKeyPair.privateKey);
    const senderPassport: SignedSitePassport = {
      payload: senderPayload,
      passportHash: senderSigned.passportHash,
      signature: senderSigned.signature,
    };
    await writePassport(recipientRoot, systemId, senderPassport);

    const recipientKeyPair = await generateKeyPair();
    const now = new Date();
    const authPayload: HandoverAuthorizationV1 = {
      schema: "handover-authorization/v1",
      systemId,
      sender: { identity: "human:sender", publicKey: toHex(senderKeyPair.publicKey) },
      recipient: { identity: "human:recipient", publicKey: toHex(recipientKeyPair.publicKey) },
      passportHash: senderPassport.passportHash,
      bordbuchHead: "",
      authorizedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const signedAuth = await signAuthorization(authPayload, senderKeyPair.privateKey);
    await writeAuthorization(recipientRoot, systemId, signedAuth);

    // Recipient key via env; Worker URL points at a dead port.
    process.env.SIGNING_PRIVATE_KEY = toPem(recipientKeyPair.privateKey, "private");
    process.env.FLEET_OWNERSHIP_REGISTRY_URL = "http://127.0.0.1:1/";

    const input: KernelCommandInput = {
      argv: [],
      flags: { id: systemId, actor: "human:recipient" },
    };
    const result = await runSternsystemHandoverComplete(input, mockContext(recipientRoot));

    // AC-3: handover completes despite Worker failure (no throw = success).
    expect(result.data?.ownershipRegistryUpdated).toBe(false);
    expect(result.data?.newCreator).toBe("human:recipient");

    // AC-7: journaled retry entry in the cache clone's operations/journal/.
    const journalDir = join(
      recipientRoot,
      "..",
      "systems-cache",
      systemId,
      "operations",
      "journal",
    );
    expect(existsSync(journalDir), "retry journal dir must exist").toBe(true);
    const journals = readdirSync(journalDir).filter((f) => f.endsWith(".jsonl"));
    expect(journals.length).toBeGreaterThan(0);
    const content = journals
      .map((f) => execFileSync("cat", [join(journalDir, f)], { encoding: "utf8" }))
      .join("");
    expect(content).toContain("fleet.ownership.transfer");
    expect(content).toContain("step-failed");
  });
});
