/*
<MODULE_CONTRACT>
<purpose>RFC-0968: End-to-end handover test simulating two werkstatt instances
(sender + recipient) performing a full prepare → complete cycle.</purpose>
<keywords>RFC-0968, handover, e2e, integration, cross-instance</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0968: initial E2E handover test.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  signAuthorization,
  writeAuthorization,
  readAuthorization,
  removeAuthorization,
  verifyAuthorization,
  isAuthorizationExpired,
  computeAuthorizationHash,
  type HandoverAuthorizationV1,
} from "./handover.ts";
import {
  buildPassportPayload,
  signPassport,
  verifyPassport,
  derivePublicKey,
  computePassportHash,
  type SignedSitePassport,
} from "./passport.ts";
import { writePassport, readPassport } from "./registry-io.ts";
import { appendBordbuchEntry, readBordbuch } from "../bordbuch/bordbuch-io.ts";
import { generateKeyPair, toHex } from "@warpgogol/werkstatt-engine/signing";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "handover-e2e-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

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

  writeFileSync(
    join(cacheDir, ".env.example"),
    ["# Example env", "API_KEY=your-key-here", ""].join("\n"),
  );
}

describe("RFC-0968: E2E handover cycle", () => {
  test("full prepare → complete cycle: sender prepares, recipient completes", async () => {
    const systemId = "transfer-site";
    const senderRoot = join(tmpDir, "sender", "werkstatt");
    const recipientRoot = join(tmpDir, "recipient", "werkstatt");
    mkdirSync(senderRoot, { recursive: true });
    mkdirSync(recipientRoot, { recursive: true });

    // Both instances share the same systems-cache (simulating mirror sync)
    setupSystem(senderRoot, systemId);
    setupSystem(recipientRoot, systemId);

    // --- Sender side: generate passport + prepare handover ---
    const senderKeyPair = await generateKeyPair();
    const senderPublicKeyHex = toHex(senderKeyPair.publicKey);

    const senderPayload = await buildPassportPayload({
      systemId,
      werkstattRoot: senderRoot,
      creatorIdentity: "human:sender",
      creatorPublicKey: senderPublicKeyHex,
    });
    const senderSigned = await signPassport(senderPayload, senderKeyPair.privateKey);
    const senderPassport: SignedSitePassport = {
      payload: senderPayload,
      passportHash: senderSigned.passportHash,
      signature: senderSigned.signature,
    };
    await writePassport(senderRoot, systemId, senderPassport);

    // Recipient generates their key pair
    const recipientKeyPair = await generateKeyPair();
    const recipientPublicKeyHex = toHex(recipientKeyPair.publicKey);

    // Sender prepares handover authorization
    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const authPayload: HandoverAuthorizationV1 = {
      schema: "handover-authorization/v1",
      systemId,
      sender: {
        identity: "human:sender",
        publicKey: senderPublicKeyHex,
      },
      recipient: {
        identity: "human:recipient",
        publicKey: recipientPublicKeyHex,
      },
      passportHash: senderPassport.passportHash,
      bordbuchHead: "",
      authorizedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };

    const signedAuth = await signAuthorization(authPayload, senderKeyPair.privateKey);
    await writeAuthorization(senderRoot, systemId, signedAuth);

    // --- Simulate mirror sync: copy authorization + passport to recipient ---
    // In real life, sternsystem.sync would push from sender to bare, then pull on recipient.
    // Here we simulate by writing the same files to the recipient's cache clone.
    await writeAuthorization(recipientRoot, systemId, signedAuth);
    await writePassport(recipientRoot, systemId, senderPassport);

    // --- Recipient side: complete handover ---

    // 1. Read and verify authorization
    const recipientAuth = await readAuthorization(recipientRoot, systemId);
    expect(recipientAuth).not.toBeNull();
    expect(recipientAuth!.authorizationHash).toBe(signedAuth.authorizationHash);

    // 2. Verify signature using sender's public key from passport
    const recipientSenderPassport = await readPassport(recipientRoot, systemId);
    expect(recipientSenderPassport).not.toBeNull();
    const senderPubKey = recipientSenderPassport!.payload.creator.publicKey;

    const verification = await verifyAuthorization(recipientAuth!, senderPubKey);
    expect(verification.valid).toBe(true);

    // 3. Check expiry (HANDOVER-02)
    expect(isAuthorizationExpired(recipientAuth!.payload.expiresAt)).toBe(false);

    // 4. Check passport hash match (HANDOVER-03)
    expect(recipientAuth!.payload.passportHash).toBe(recipientSenderPassport!.passportHash);

    // 5. Verify recipient key possession (HANDOVER-04)
    const derivedRecipientPubKey = await derivePublicKey(recipientKeyPair.privateKey);
    expect(recipientAuth!.payload.recipient.publicKey).toBe(derivedRecipientPubKey);

    // 6. Regenerate passport with new creator identity
    const newPayload = await buildPassportPayload({
      systemId,
      werkstattRoot: recipientRoot,
      creatorIdentity: recipientAuth!.payload.recipient.identity,
      creatorPublicKey: derivedRecipientPubKey,
    });
    newPayload.provenance.createdAt = recipientSenderPassport!.payload.provenance.createdAt;

    const newSigned = await signPassport(newPayload, recipientKeyPair.privateKey);
    const newPassport: SignedSitePassport = {
      payload: newPayload,
      passportHash: newSigned.passportHash,
      signature: newSigned.signature,
    };
    await writePassport(recipientRoot, systemId, newPassport);

    // 7. Append bordbuch handover event
    const metadata = {
      from: recipientAuth!.payload.sender.identity,
      to: recipientAuth!.payload.recipient.identity,
      authorizationHash: recipientAuth!.authorizationHash,
      newPassportHash: newPassport.passportHash,
    };

    const entry = await appendBordbuchEntry(
      recipientRoot,
      systemId,
      "handover",
      `handover from ${recipientAuth!.payload.sender.identity} to ${recipientAuth!.payload.recipient.identity}`,
      recipientAuth!.payload.recipient.identity,
      { missionId: null, releaseId: null, metadata: metadata as Record<string, unknown> },
    );

    // 8. Remove authorization file
    const removed = await removeAuthorization(recipientRoot, systemId);
    expect(removed).toBe(true);

    // --- Verify final state ---
    const finalPassport = await readPassport(recipientRoot, systemId);
    expect(finalPassport).not.toBeNull();
    expect(finalPassport!.payload.creator.identity).toBe("human:recipient");
    expect(finalPassport!.payload.creator.publicKey).toBe(recipientPublicKeyHex);

    // Verify the new passport is valid
    const passportVerification = await verifyPassport(finalPassport!);
    expect(passportVerification.valid).toBe(true);

    // Verify bordbuch has the handover event
    const entries = await readBordbuch(recipientRoot, systemId);
    const handoverEntries = entries.filter((e) => e.kind === "handover");
    expect(handoverEntries).toHaveLength(1);
    expect(handoverEntries[0].hash).toBe(entry.hash);
    expect((handoverEntries[0].metadata as Record<string, unknown>).from).toBe("human:sender");
    expect((handoverEntries[0].metadata as Record<string, unknown>).to).toBe("human:recipient");
    expect((handoverEntries[0].metadata as Record<string, unknown>).authorizationHash).toBe(
      signedAuth.authorizationHash,
    );

    // Verify authorization file is gone
    const authAfter = await readAuthorization(recipientRoot, systemId);
    expect(authAfter).toBeNull();
  });

  test("crash recovery: re-running complete after bordbuch append is rejected (duplicate)", async () => {
    const systemId = "crash-test-site";
    const root = join(tmpDir, "werkstatt");
    mkdirSync(root, { recursive: true });
    setupSystem(root, systemId);

    const senderKeyPair = await generateKeyPair();
    const recipientKeyPair = await generateKeyPair();

    // Setup passport
    const payload = await buildPassportPayload({
      systemId,
      werkstattRoot: root,
      creatorIdentity: "human:sender",
      creatorPublicKey: toHex(senderKeyPair.publicKey),
    });
    const { passportHash, signature } = await signPassport(payload, senderKeyPair.privateKey);
    await writePassport(root, systemId, { payload, passportHash, signature });

    // Create authorization
    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const authPayload: HandoverAuthorizationV1 = {
      schema: "handover-authorization/v1",
      systemId,
      sender: { identity: "human:sender", publicKey: toHex(senderKeyPair.publicKey) },
      recipient: { identity: "human:recipient", publicKey: toHex(recipientKeyPair.publicKey) },
      passportHash,
      bordbuchHead: "",
      authorizedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };
    const signedAuth = await signAuthorization(authPayload, senderKeyPair.privateKey);
    await writeAuthorization(root, systemId, signedAuth);

    // Simulate crash: bordbuch entry was appended but authorization file was NOT removed
    const metadata = {
      from: "human:sender",
      to: "human:recipient",
      authorizationHash: signedAuth.authorizationHash,
      newPassportHash: "sha256:newpass",
    };
    await appendBordbuchEntry(
      root,
      systemId,
      "handover",
      "handover from sender to recipient",
      "human:recipient",
      { missionId: null, releaseId: null, metadata: metadata as Record<string, unknown> },
    );

    // Crash recovery: attempt to append the same handover event again — should be rejected
    await expect(
      appendBordbuchEntry(
        root,
        systemId,
        "handover",
        "handover from sender to recipient",
        "human:recipient",
        { missionId: null, releaseId: null, metadata: metadata as Record<string, unknown> },
      ),
    ).rejects.toThrow(/duplicate handover/);

    // Verify only one handover entry exists
    const entries = await readBordbuch(root, systemId);
    const handoverEntries = entries.filter((e) => e.kind === "handover");
    expect(handoverEntries).toHaveLength(1);
  });

  test("cancel: sender cancels pending handover by removing authorization file", async () => {
    const systemId = "cancel-test-site";
    const root = join(tmpDir, "werkstatt");
    mkdirSync(root, { recursive: true });
    setupSystem(root, systemId);

    const senderKeyPair = await generateKeyPair();
    const payload = await buildPassportPayload({
      systemId,
      werkstattRoot: root,
      creatorIdentity: "human:sender",
      creatorPublicKey: toHex(senderKeyPair.publicKey),
    });
    const { passportHash, signature } = await signPassport(payload, senderKeyPair.privateKey);
    await writePassport(root, systemId, { payload, passportHash, signature });

    // Create authorization
    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const authPayload: HandoverAuthorizationV1 = {
      schema: "handover-authorization/v1",
      systemId,
      sender: { identity: "human:sender", publicKey: toHex(senderKeyPair.publicKey) },
      recipient: { identity: "human:recipient", publicKey: "abcd1234" },
      passportHash,
      bordbuchHead: "",
      authorizedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };
    const signedAuth = await signAuthorization(authPayload, senderKeyPair.privateKey);
    await writeAuthorization(root, systemId, signedAuth);

    // Verify it exists
    expect(await readAuthorization(root, systemId)).not.toBeNull();

    // Cancel
    const removed = await removeAuthorization(root, systemId);
    expect(removed).toBe(true);

    // Verify it's gone
    expect(await readAuthorization(root, systemId)).toBeNull();

    // Cancel again — should return false
    const removedAgain = await removeAuthorization(root, systemId);
    expect(removedAgain).toBe(false);
  });
});
