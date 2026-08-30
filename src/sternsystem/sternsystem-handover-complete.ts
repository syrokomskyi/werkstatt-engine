/*
<MODULE_CONTRACT>
<purpose>RFC-0968: sternsystem.handover.complete — the receiving instance verifies the
handover authorization, regenerates the passport with the new creator identity, appends a
handover event to the bordbuch, updates the fleet ownership registry (RFC-0967), and removes
the authorization file.</purpose>
<non-goals>
  <item>Does not fetch the authorization from a remote source — the caller must ensure the authorization file is present in the cache clone (via mirror sync or --source-locator fetch).</item>
  <item>Does not manage key lifecycle or rotation.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0968: initial handover complete command handler.</item>
  <item>RFC-0988: add --dry-run and --authorization-data flags — verify authorization in memory, return preview data, skip all writes.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { loadPrivateKey } from "@warpgogol/werkstatt-engine/signing";
import { resolveActor } from "../mission/actor-identity.ts";
import { readPassport, writePassport } from "./registry-io.ts";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";
import { appendBordbuchEntry } from "../bordbuch/bordbuch-io.ts";
import {
  readAuthorization,
  removeAuthorization,
  verifyAuthorization,
  isAuthorizationExpired,
  resolveAuthorizationPath,
  parseAuthorizationData,
  type HandoverCompleteResult,
  type HandoverEventMetadata,
  type SignedHandoverAuthorization,
} from "./handover.ts";
import {
  buildPassportPayload,
  signPassport,
  derivePublicKey,
  computePassportHash,
  type SignedSitePassport,
} from "./passport.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";

export interface SternsystemHandoverCompleteData extends HandoverCompleteResult {
  command: "sternsystem.handover.complete";
  dryRun: boolean;
  newPassportHashPreview?: string;
  bordbuchEventPreview?: {
    kind: "handover";
    metadata: { newPassportHash: string; authorizationHash: string };
  };
  registryTransferPreview?: {
    systemId: string;
    previousOwner: string;
    newOwner: string;
  };
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

export async function runSternsystemHandoverComplete(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SternsystemHandoverCompleteData>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "id");
  const dryRun = flagBool(input, "dry-run");
  const authorizationDataJson = flagString(input, "authorization-data");
  const sourceLocator = flagString(input, "source-locator");

  if (!systemId) {
    throw new Error("[sternsystem.handover.complete] requires --id <systemId>");
  }

  if (dryRun && sourceLocator) {
    throw new Error(
      "[sternsystem.handover.complete] --source-locator is incompatible with --dry-run",
    );
  }

  if (dryRun && !authorizationDataJson) {
    throw new Error(
      "[sternsystem.handover.complete] --authorization-data is required in dry-run mode",
    );
  }

  const recipientIdentity = resolveActor(input);

  const env = { ...filterEnv(process.env) };
  const privateKeyEnv = env["SIGNING_PRIVATE_KEY"];
  const privateKeyPath = env["SIGNING_PRIVATE_KEY_PATH"];

  if (!privateKeyEnv && !privateKeyPath) {
    throw new Error(
      "[sternsystem.handover.complete] No signing key configured. Set SIGNING_PRIVATE_KEY or SIGNING_PRIVATE_KEY_PATH env var.",
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
      `[sternsystem.handover.complete] Failed to load private key: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const recipientPublicKey = await derivePublicKey(privateKeyBytes);

  let authorization: SignedHandoverAuthorization;
  if (dryRun && authorizationDataJson) {
    authorization = parseAuthorizationData(authorizationDataJson);
  } else {
    const read = await readAuthorization(workspaceRoot, systemId);
    if (!read) {
      throw new Error(
        `[sternsystem.handover.complete] No handover-authorization.json found for ${systemId}. Ensure the sender has prepared and synced the authorization.`,
      );
    }
    authorization = read;
  }

  // HANDOVER-02: check expiry
  if (isAuthorizationExpired(authorization.payload.expiresAt)) {
    throw new Error(
      `[sternsystem.handover.complete] HANDOVER-02: authorization expired at ${authorization.payload.expiresAt}. Sender must re-issue.`,
    );
  }

  // Read the sender's passport to get the sender's public key for signature verification
  const senderPassport = await readPassport(workspaceRoot, systemId);
  if (!senderPassport) {
    throw new Error(
      `[sternsystem.handover.complete] No passport found for ${systemId}. The sender's passport must be present to verify the authorization signature.`,
    );
  }

  // Verify the authorization signature using the sender's public key from the passport
  const senderPublicKey = senderPassport.payload.creator.publicKey;
  const verification = await verifyAuthorization(authorization, senderPublicKey);
  if (!verification.valid) {
    throw new Error(
      `[sternsystem.handover.complete] Authorization signature verification failed: ${verification.errors.join("; ")}`,
    );
  }

  // HANDOVER-03: check passport hash match
  if (authorization.payload.passportHash !== senderPassport.passportHash) {
    throw new Error(
      `[sternsystem.handover.complete] HANDOVER-03: passport hash mismatch — authorization references ${authorization.payload.passportHash} but current passport is ${senderPassport.passportHash}. The site changed after authorization; sender must re-issue.`,
    );
  }

  // HANDOVER-04: verify recipient key possession
  if (authorization.payload.recipient.publicKey !== recipientPublicKey) {
    throw new Error(
      `[sternsystem.handover.complete] HANDOVER-04: recipient key mismatch — SIGNING_PRIVATE_KEY derives public key ${recipientPublicKey} but authorization expects ${authorization.payload.recipient.publicKey}. This instance is not the authorized recipient.`,
    );
  }

  // Regenerate passport with new creator identity
  const newPayload = await buildPassportPayload({
    systemId,
    werkstattRoot: workspaceRoot,
    creatorIdentity: authorization.payload.recipient.identity,
    creatorPublicKey: recipientPublicKey,
  });

  // Preserve original createdAt from sender's passport
  newPayload.provenance.createdAt = senderPassport.payload.provenance.createdAt;

  const { passportHash: newPassportHash, signature: newSignature } = await signPassport(
    newPayload,
    privateKeyBytes,
  );

  const newPassport: SignedSitePassport = {
    payload: newPayload,
    passportHash: newPassportHash,
    signature: newSignature,
  };

  const operationId = generateOperationId();
  await acquireLock(
    workspaceRoot,
    `system:${systemId}`,
    operationId,
    "sternsystem.handover.complete",
    recipientIdentity,
  );

  try {
    if (dryRun) {
      logger.success(
        `[sternsystem.handover.complete] ${systemId} dry-run: handover verified for ${authorization.payload.recipient.identity} — no files written`,
      );
      return {
        data: {
          command: "sternsystem.handover.complete",
          systemId,
          previousCreator: authorization.payload.sender.identity,
          newCreator: authorization.payload.recipient.identity,
          newPassportHash: newPassportHash,
          bordbuchEventHash: "",
          ownershipRegistryUpdated: false,
          dryRun: true,
          newPassportHashPreview: newPassportHash,
          bordbuchEventPreview: {
            kind: "handover",
            metadata: {
              newPassportHash,
              authorizationHash: authorization.authorizationHash,
            },
          },
          registryTransferPreview: {
            systemId,
            previousOwner: authorization.payload.sender.identity,
            newOwner: authorization.payload.recipient.identity,
          },
        },
        summary: `[sternsystem.handover.complete] ${systemId} dry-run: handover verified (no files written)`,
      };
    }

    // Write new passport
    await writePassport(workspaceRoot, systemId, newPassport);
    logger.info(
      `[sternsystem.handover.complete] ${systemId} passport regenerated for ${authorization.payload.recipient.identity} (hash: ${newPassportHash})`,
    );

    // Append bordbuch handover event
    const metadata: HandoverEventMetadata = {
      from: authorization.payload.sender.identity,
      to: authorization.payload.recipient.identity,
      authorizationHash: authorization.authorizationHash,
      newPassportHash,
    };

    const entry = await appendBordbuchEntry(
      workspaceRoot,
      systemId,
      "handover",
      `handover from ${authorization.payload.sender.identity} to ${authorization.payload.recipient.identity}`,
      authorization.payload.recipient.identity,
      {
        missionId: null,
        releaseId: null,
        metadata: metadata as unknown as Record<string, unknown>,
      },
    );
    logger.info(
      `[sternsystem.handover.complete] ${systemId} bordbuch handover event appended (hash: ${entry.hash})`,
    );

    // Update fleet ownership registry (RFC-0967) — hard dependency, fails closed
    let ownershipRegistryUpdated = false;
    try {
      const { transferOwnership } = await import("../fleet/ownership-registry.ts");
      const authPath = resolveAuthorizationPath(workspaceRoot, systemId);
      await transferOwnership({
        systemId,
        werkstattRoot: workspaceRoot,
        authorizationPath: authPath,
      });
      ownershipRegistryUpdated = true;
      logger.info(`[sternsystem.handover.complete] ${systemId} ownership registry updated`);
    } catch (err) {
      throw new Error(
        `[sternsystem.handover.complete] fleet.ownership.transfer failed (hard dependency): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Remove authorization file
    await removeAuthorization(workspaceRoot, systemId);
    logger.success(
      `[sternsystem.handover.complete] ${systemId} handover complete: ${authorization.payload.sender.identity} → ${authorization.payload.recipient.identity}`,
    );

    const result: HandoverCompleteResult = {
      systemId,
      previousCreator: authorization.payload.sender.identity,
      newCreator: authorization.payload.recipient.identity,
      newPassportHash: newPassportHash,
      bordbuchEventHash: entry.hash,
      ownershipRegistryUpdated,
    };

    return {
      data: {
        command: "sternsystem.handover.complete",
        ...result,
        dryRun: false,
      },
      summary: `[sternsystem.handover.complete] ${systemId} handed over from ${result.previousCreator} to ${result.newCreator}, passport regenerated, bordbuch updated, ownership registry synced`,
    };
  } finally {
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }
}
