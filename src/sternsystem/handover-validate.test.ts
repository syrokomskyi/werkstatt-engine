/*
<MODULE_CONTRACT>
<purpose>RFC-0968: Unit tests for HANDOVER-01/02/03/04/05 validation rules in sternsystem.validate.</purpose>
<keywords>RFC-0968, handover, validate, HANDOVER, unit test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0968: initial handover validate unit tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSternsystemValidate } from "./sternsystem-validate.ts";
import { makeInput, makeContext, writeSystemConfig, BASE_SETUP } from "./test-helpers.ts";
import { writeAuthorization } from "./handover.ts";
import { generateKeyPair, toHex } from "@warpgogol/werkstatt-engine/signing";
import {
  buildPassportPayload,
  signPassport,
  derivePublicKey,
  type SignedSitePassport,
} from "./passport.ts";
import { writePassport } from "./registry-io.ts";
import { appendBordbuchEntry } from "../bordbuch/bordbuch-io.ts";
import type { HandoverAuthorizationV1 } from "./handover.ts";

let testRoot: string;
let workspaceRoot: string;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "handover-validate-test-"));
  workspaceRoot = join(testRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  await BASE_SETUP(workspaceRoot);
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

async function setupSystemWithPassport(
  root: string,
  systemId: string,
): Promise<{ passport: SignedSitePassport; keyPair: { privateKey: Uint8Array; publicKey: Uint8Array } }> {
  await writeSystemConfig(root, [{ path: "./systems/test-bundle", storageType: "non-bare" }]);

  const keyPair = await generateKeyPair();
  const publicKeyHex = toHex(keyPair.publicKey);

  const payload = await buildPassportPayload({
    systemId,
    werkstattRoot: root,
    creatorIdentity: "human:sender",
    creatorPublicKey: publicKeyHex,
  });

  const { passportHash, signature } = await signPassport(payload, keyPair.privateKey);
  const passport: SignedSitePassport = { payload, passportHash, signature };
  await writePassport(root, systemId, passport);

  return { passport, keyPair };
}

async function writeAuthFile(
  root: string,
  systemId: string,
  overrides?: Partial<HandoverAuthorizationV1>,
): Promise<{ authorizationHash: string }> {
  const senderKeyPair = await generateKeyPair();
  const recipientKeyPair = await generateKeyPair();

  const passport = await buildPassportPayload({
    systemId,
    werkstattRoot: root,
    creatorIdentity: "human:sender",
    creatorPublicKey: toHex(senderKeyPair.publicKey),
  });
  const { passportHash, signature } = await signPassport(passport, senderKeyPair.privateKey);
  await writePassport(root, systemId, { payload: passport, passportHash, signature });

  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const payload: HandoverAuthorizationV1 = {
    schema: "handover-authorization/v1",
    systemId,
    sender: {
      identity: "human:sender",
      publicKey: toHex(senderKeyPair.publicKey),
    },
    recipient: {
      identity: "human:recipient",
      publicKey: toHex(recipientKeyPair.publicKey),
    },
    passportHash,
    bordbuchHead: "",
    authorizedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    ...overrides,
  };

  const { signAuthorization } = await import("./handover.ts");
  const doc = await signAuthorization(payload, senderKeyPair.privateKey);
  await writeAuthorization(root, systemId, doc);

  return { authorizationHash: doc.authorizationHash };
}

test("HANDOVER-01: authorization file exists → validate reports HANDOVER-01", async () => {
  await setupSystemWithPassport(workspaceRoot, "test-bundle");
  await writeAuthFile(workspaceRoot, "test-bundle");

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const handover01 = result.data!.violations.filter((v) => v.rule === "HANDOVER-01");
  expect(handover01).toHaveLength(1);
  expect(handover01[0].message).toContain("pending handover");
});

test("HANDOVER-02: expired authorization → validate reports HANDOVER-02", async () => {
  await setupSystemWithPassport(workspaceRoot, "test-bundle");
  const pastDate = new Date(Date.now() - 60_000).toISOString();
  await writeAuthFile(workspaceRoot, "test-bundle", { expiresAt: pastDate });

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const handover02 = result.data!.violations.filter((v) => v.rule === "HANDOVER-02");
  expect(handover02).toHaveLength(1);
  expect(handover02[0].message).toContain("expired");
});

test("HANDOVER-03: passport hash mismatch → validate reports HANDOVER-03", async () => {
  await setupSystemWithPassport(workspaceRoot, "test-bundle");
  await writeAuthFile(workspaceRoot, "test-bundle", {
    passportHash: "sha256:wronghash",
  });

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const handover03 = result.data!.violations.filter((v) => v.rule === "HANDOVER-03");
  expect(handover03).toHaveLength(1);
  expect(handover03[0].message).toContain("passport changed");
});

test("HANDOVER-05: passport hash mismatch with bordbuch handover event → validate reports HANDOVER-05", async () => {
  await setupSystemWithPassport(workspaceRoot, "test-bundle");

  // Append a handover bordbuch event with a specific newPassportHash
  const metadata = {
    from: "human:sender",
    to: "human:recipient",
    authorizationHash: "sha256:auth123",
    newPassportHash: "sha256:expected-hash",
  };
  await appendBordbuchEntry(
    workspaceRoot,
    "test-bundle",
    "handover",
    "handover from sender to recipient",
    "human:recipient",
    { missionId: null, releaseId: null, metadata: metadata as Record<string, unknown> },
  );

  // The current passport has a different hash than what's in the bordbuch event
  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const handover05 = result.data!.violations.filter((v) => v.rule === "HANDOVER-05");
  expect(handover05).toHaveLength(1);
  expect(handover05[0].message).toContain("incomplete handover");
});

test("clean state: no authorization file, no handover bordbuch event → no HANDOVER violations", async () => {
  await setupSystemWithPassport(workspaceRoot, "test-bundle");

  const result = await runSternsystemValidate(makeInput({}), makeContext(workspaceRoot));
  const handoverViolations = result.data!.violations.filter((v) =>
    v.rule.startsWith("HANDOVER"),
  );
  expect(handoverViolations).toHaveLength(0);
});
