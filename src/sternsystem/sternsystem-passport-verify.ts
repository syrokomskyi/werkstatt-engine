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
  <item>ADR-0094: apply the post-handover drift tolerance from passport-staleness.ts — a recorded bordbuchHead pointing at the entry just before the latest handover event is legitimate, trailing bookkeeping entries stripped. Verify now agrees with PASSPORT-03 on freshness verdicts.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { verifyPassport, buildPassportPayload, computePassportHash } from "./passport.ts";
import {
  isBordbuchDriftBookkeepingOnly,
  dropTrailingBookkeepingEntries,
} from "./passport-staleness.ts";
import { readPassport } from "./registry-io.ts";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";

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
        // ADR-0092: a head drift caused only by bookkeeping entries
        // (mirror-sync — propagation of already-committed state) does not
        // stale the passport; any other new entry does.
        try {
          const entries = await readBordbuch(workspaceRoot, systemId);
          const recordedHead = doc.payload.provenance.bordbuchHead;
          if (!isBordbuchDriftBookkeepingOnly(entries, recordedHead)) {
            // ADR-0094: post-handover tolerance, identical to PASSPORT-03 —
            // the passport is regenerated before the handover bordbuch entry
            // is appended, so a recorded head pointing at the entry just
            // before the latest handover event is legitimate. Trailing
            // bookkeeping entries (mirror-sync) are stripped before locating
            // the handover, so a sync after handover still counts.
            const significant = dropTrailingBookkeepingEntries(entries);
            const lastSignificant = significant[significant.length - 1];
            const prevEntry = significant[significant.length - 2];
            const expectedHead = prevEntry ? prevEntry.hash : "";
            const handoverTolerated =
              significant.length > 0 &&
              lastSignificant?.kind === "handover" &&
              recordedHead === expectedHead;
            if (!handoverTolerated) {
              bordbuchHeadMatches = false;
            }
          }
        } catch {
          // Bordbuch unreadable — fail safe: treat the drift as real
          bordbuchHeadMatches = false;
        }
      }
      const freshResources = JSON.stringify(freshPayload.resources);
      const docResources = JSON.stringify(doc.payload.resources);
      if (freshResources !== docResources) {
        resourcesMatch = false;
      }
    }
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
