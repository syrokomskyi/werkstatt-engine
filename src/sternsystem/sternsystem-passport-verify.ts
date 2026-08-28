/*
<MODULE_CONTRACT>
<purpose>RFC-0966: sternsystem.passport.verify — verify the signature and
content-freshness of a Sternsystem's passport.json. In --offline mode, checks
structure + signature only; without --offline, additionally cross-checks
resource inventory against live state.</purpose>
<non-goals>
  <item>Does not generate or refresh the passport — use sternsystem.passport.generate.</item>
  <item>Does not enforce PASSPORT-01/02/03 rules — that is sternsystem.validate.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0966: initial passport verify command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { verifyPassport, buildPassportPayload, computePassportHash } from "./passport.ts";
import { readPassport, resolveCacheClonePath } from "./registry-io.ts";

export interface SternsystemPassportVerifyData {
  command: "sternsystem.passport.verify";
  systemId: string;
  valid: boolean;
  passportHash: string | null;
  creator: string | null;
  staleness: {
    bordbuchHeadMatches: boolean;
    resourcesMatch: boolean;
  };
  errors: string[];
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true;
}

export async function runSternsystemPassportVerify(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SternsystemPassportVerifyData>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "id");
  const offline = flagBool(input, "offline");

  if (!systemId) {
    throw new Error("[sternsystem.passport.verify] requires --id <systemId>");
  }

  const doc = await readPassport(workspaceRoot, systemId);

  if (!doc) {
    const errors = [`passport.json not found for system '${systemId}'`];
    logger.error(`[sternsystem.passport.verify] ${systemId}: passport.json not found`);
    return {
      data: {
        command: "sternsystem.passport.verify",
        systemId,
        valid: false,
        passportHash: null,
        creator: null,
        staleness: { bordbuchHeadMatches: false, resourcesMatch: false },
        errors,
      },
      exitCode: 1,
      summary: `[sternsystem.passport.verify] ${systemId} passport missing`,
    };
  }

  const { valid, errors } = await verifyPassport(doc);

  let bordbuchHeadMatches = true;
  let resourcesMatch = true;

  if (valid && !offline) {
    const cacheClonePath = resolveCacheClonePath(workspaceRoot, systemId);

    const freshPayload = await buildPassportPayload({
      systemId,
      werkstattRoot: workspaceRoot,
      creatorIdentity: doc.payload.creator.identity,
      creatorPublicKey: doc.payload.creator.publicKey,
    });

    freshPayload.provenance.createdAt = doc.payload.provenance.createdAt;
    const freshHash = computePassportHash(freshPayload);

    if (freshHash !== doc.passportHash) {
      if (freshPayload.provenance.bordbuchHead !== doc.payload.provenance.bordbuchHead) {
        bordbuchHeadMatches = false;
      }
      const freshResources = JSON.stringify(freshPayload.resources);
      const docResources = JSON.stringify(doc.payload.resources);
      if (freshResources !== docResources) {
        resourcesMatch = false;
      }
    }

    void cacheClonePath;
  }

  if (valid && bordbuchHeadMatches && resourcesMatch) {
    logger.success(
      `[sternsystem.passport.verify] ${systemId} passport valid, signed by ${doc.payload.creator.identity}, resources in sync`,
    );
  } else {
    logger.error(
      `[sternsystem.passport.verify] ${systemId} passport invalid: ${[...errors, !bordbuchHeadMatches ? "bordbuchHead drift" : null, !resourcesMatch ? "resources drift" : null].filter(Boolean).join(", ")}`,
    );
  }

  return {
    data: {
      command: "sternsystem.passport.verify",
      systemId,
      valid: valid && bordbuchHeadMatches && resourcesMatch,
      passportHash: doc.passportHash,
      creator: doc.payload.creator.identity,
      staleness: { bordbuchHeadMatches, resourcesMatch },
      errors,
    },
    exitCode: valid && bordbuchHeadMatches && resourcesMatch ? 0 : 1,
    summary: `[sternsystem.passport.verify] ${systemId} passport ${valid && bordbuchHeadMatches && resourcesMatch ? "valid" : "invalid"}, signed by ${doc.payload.creator.identity}`,
  };
}
