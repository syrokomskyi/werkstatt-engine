/*
<MODULE_CONTRACT>
<purpose>RFC-0968: sternsystem.handover.prepare — the sending instance generates a signed
handover authorization that transfers the site to a specified recipient identity.
Reads the passport for sender identity + public key, loads SIGNING_PRIVATE_KEY,
builds HandoverAuthorizationV1, signs it, and writes handover-authorization.json to the cache clone.</purpose>
<non-goals>
  <item>Does not verify the authorization — that is the receiving instance's job in sternsystem.handover.complete.</item>
  <item>Does not propagate the authorization to mirrors — use sternsystem.sync for that.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0968: initial handover prepare command handler.</item>
  <item>RFC-0988: add --dry-run flag — sign authorization in memory, return SignedHandoverAuthorization in result, skip writeAuthorization.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { loadPrivateKey } from "@warpgogol/werkstatt-engine/signing";
import { resolveActor } from "../mission/actor-identity.ts";
import { readPassport } from "./registry-io.ts";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";
import {
  signAuthorization,
  writeAuthorization,
  type HandoverAuthorizationV1,
  type SignedHandoverAuthorization,
} from "./handover.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";

export interface SternsystemHandoverPrepareData {
  command: "sternsystem.handover.prepare";
  systemId: string;
  senderIdentity: string;
  recipientIdentity: string;
  authorizationHash: string;
  authorizationPath: string;
  expiresAt: string;
  dryRun: boolean;
  signedAuthorization?: SignedHandoverAuthorization;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  return input.flags[key] === true;
}

function filterEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

const DEFAULT_EXPIRY_DAYS = 30;

export async function runSternsystemHandoverPrepare(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SternsystemHandoverPrepareData>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "id");
  const recipientIdentity = flagString(input, "recipient-identity");
  const recipientPublicKey = flagString(input, "recipient-public-key");
  const dryRun = flagBool(input, "dry-run");

  if (!systemId) {
    throw new Error("[sternsystem.handover.prepare] requires --id <systemId>");
  }
  if (!recipientIdentity) {
    throw new Error(
      "[sternsystem.handover.prepare] requires --recipient-identity <identity-handle>",
    );
  }
  if (!recipientPublicKey) {
    throw new Error(
      "[sternsystem.handover.prepare] requires --recipient-public-key <base64-ed25519-pubkey>",
    );
  }

  const senderIdentity = resolveActor(input);

  const env = { ...filterEnv(process.env) };
  const privateKeyEnv = env["SIGNING_PRIVATE_KEY"];
  const privateKeyPath = env["SIGNING_PRIVATE_KEY_PATH"];

  if (!privateKeyEnv && !privateKeyPath) {
    throw new Error(
      "[sternsystem.handover.prepare] No signing key configured. Set SIGNING_PRIVATE_KEY or SIGNING_PRIVATE_KEY_PATH env var.",
    );
  }

  let privateKeyBytes: Uint8Array;
  try {
    if (privateKeyEnv) {
      privateKeyBytes = await loadPrivateKey({ pem: privateKeyEnv });
    } else {
      privateKeyBytes = await loadPrivateKey({ filePath: privateKeyPath!, encoding: "pem" });
    }
  } catch (err) {
    throw new Error(
      `[sternsystem.handover.prepare] Failed to load private key: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const passport = await readPassport(workspaceRoot, systemId);
  if (!passport) {
    throw new Error(
      `[sternsystem.handover.prepare] No passport found for ${systemId}. Run sternsystem.passport.generate first.`,
    );
  }

  const senderPublicKey = passport.payload.creator.publicKey;
  const passportHash = passport.passportHash;

  let bordbuchHead = "";
  try {
    const entries = await readBordbuch(workspaceRoot, systemId);
    if (entries.length > 0) {
      bordbuchHead = entries[entries.length - 1].hash;
    }
  } catch {
    // Bordbuch not readable — empty head
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const payload: HandoverAuthorizationV1 = {
    schema: "handover-authorization/v1",
    systemId,
    sender: {
      identity: senderIdentity,
      publicKey: senderPublicKey,
    },
    recipient: {
      identity: recipientIdentity,
      publicKey: recipientPublicKey,
    },
    passportHash,
    bordbuchHead,
    authorizedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const operationId = generateOperationId();
  await acquireLock(
    workspaceRoot,
    `system:${systemId}`,
    operationId,
    "sternsystem.handover.prepare",
    senderIdentity,
  );

  let doc: SignedHandoverAuthorization;
  try {
    doc = await signAuthorization(payload, privateKeyBytes);

    if (dryRun) {
      logger.success(
        `[sternsystem.handover.prepare] ${systemId} dry-run: authorization signed for ${recipientIdentity} (hash: ${doc.authorizationHash}) — no files written`,
      );
      return {
        data: {
          command: "sternsystem.handover.prepare",
          systemId,
          senderIdentity,
          recipientIdentity,
          authorizationHash: doc.authorizationHash,
          authorizationPath: "",
          expiresAt: expiresAt.toISOString(),
          dryRun: true,
          signedAuthorization: doc,
        },
        summary: `[sternsystem.handover.prepare] ${systemId} dry-run: authorization generated for ${recipientIdentity} (no files written)`,
      };
    }

    const authorizationPath = await writeAuthorization(workspaceRoot, systemId, doc);
    logger.success(
      `[sternsystem.handover.prepare] ${systemId} authorization signed for ${recipientIdentity} (hash: ${doc.authorizationHash})`,
    );

    return {
      data: {
        command: "sternsystem.handover.prepare",
        systemId,
        senderIdentity,
        recipientIdentity,
        authorizationHash: doc.authorizationHash,
        authorizationPath,
        expiresAt: expiresAt.toISOString(),
        dryRun: false,
      },
      summary: `[sternsystem.handover.prepare] ${systemId} handover authorized from ${senderIdentity} to ${recipientIdentity}, expires ${expiresAt.toISOString()}`,
    };
  } finally {
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }
}
