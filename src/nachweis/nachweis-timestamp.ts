/*
<MODULE_CONTRACT>
<purpose>RFC-0715/RFC-0871: nachweis.timestamp command handler — obtains an RFC 3161 timestamp token for a signed Nachweis record, with optional eIDAS qualified assurance metadata.</purpose>
<keywords>nachweis, timestamp, rfc3161, tsa, bordbuch</keywords>
<responsibilities>
  <item>Enforces sign-before-timestamp ordering: fails with SIGNATURE_NOT_FOUND if no nachweis-signed entry exists.</item>
  <item>Reads the signature from the nachweis-signed Bordbuch entry.</item>
  <item>Queries the TSA adapter (FreeTSA.org by default) with the signature bytes.</item>
  <item>Stores the RFC 3161 timestamp token (DER-encoded, base64) in Bordbuch metadata.</item>
  <item>RFC-0871: stores timestampAssurance and qualificationEvidenceRef in Bordbuch metadata.</item>
  <item>RFC-0871: validates eidas-qualified assurance requires qualificationEvidenceRef.</item>
  <item>Appends nachweis-timestamped Bordbuch entry.</item>
  <item>Idempotent: if a nachweis-timestamped entry already exists for the slug, returns the existing token.</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
</responsibilities>
<non-goals>
  <item>Does not sign — that is nachweis.sign.</item>
  <item>Does not verify the timestamp token — that is nachweis.verify-signature.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0715: initial nachweis.timestamp command handler.</item>
  <item>RFC-0715 review fix: use HttpTsaAdapter for custom TSA URLs. Import flagString/flagBool from nachweis-n3-types.ts.</item>
  <item>RFC-0871: add --timestamp-assurance and --qualification-evidence-ref flags, default rfc3161, fail eidas-qualified without evidence.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";
import {
  isNachweisEntitled,
  makeSkipResult,
  flagString,
  flagBool,
  type NachweisTimestampResult,
  type TimestampAssurance,
} from "./nachweis-n3-types.ts";
import { FreeTsaAdapter, HttpTsaAdapter, type TsaAdapter } from "./tsa-adapter.ts";

export async function runNachweisTimestamp(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisTimestampResult>> {
  const { workspaceRoot } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const slug = flagString(input, "slug");
  const tsaUrl = flagString(input, "tsa-url");
  const dryRun = flagBool(input, "dry-run");
  const timestampAssuranceRaw = flagString(input, "timestamp-assurance") ?? "rfc3161";
  const qualificationEvidenceRef = flagString(input, "qualification-evidence-ref");

  if (!systemId) throw new Error("[nachweis.timestamp] --system is required");
  if (!slug) throw new Error("[nachweis.timestamp] --slug is required");

  if (timestampAssuranceRaw !== "rfc3161" && timestampAssuranceRaw !== "eidas-qualified") {
    throw new Error(
      `[nachweis.timestamp] INVALID_ASSURANCE: --timestamp-assurance must be 'rfc3161' or 'eidas-qualified', got '${timestampAssuranceRaw}'.`,
    );
  }
  const timestampAssurance: TimestampAssurance = timestampAssuranceRaw;

  if (timestampAssurance === "eidas-qualified" && !qualificationEvidenceRef) {
    throw new Error(
      `[nachweis.timestamp] TIMESTAMP_QUALIFICATION_EVIDENCE_REQUIRED: --qualification-evidence-ref is required when --timestamp-assurance=eidas-qualified. Provide a URL to the QTSP trust list entry or qualification certificate.`,
    );
  }

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.timestamp",
      systemId,
    ) as unknown as KernelCommandResult<NachweisTimestampResult>;
  }

  // Read bordbuch entries to find the signature
  const bordbuchEntries = await readBordbuch(workspaceRoot, systemId);
  const signedEntry = bordbuchEntries.find(
    (e) => e.kind === "nachweis-signed" && e.metadata?.slug === slug,
  );

  if (!signedEntry) {
    throw new Error(
      `[nachweis.timestamp] SIGNATURE_NOT_FOUND: no nachweis-signed Bordbuch entry found for '${slug}'. Run nachweis.sign first.`,
    );
  }

  const signatureHex = signedEntry.metadata?.signatureHex as string | undefined;
  if (!signatureHex) {
    throw new Error(
      `[nachweis.timestamp] SIGNATURE_NOT_FOUND: nachweis-signed entry for '${slug}' has no signatureHex metadata.`,
    );
  }

  const signatureBytes = new Uint8Array(Buffer.from(signatureHex, "hex"));

  // Idempotency: check for existing nachweis-timestamped entry
  const existingTimestamped = bordbuchEntries.find(
    (e) => e.kind === "nachweis-timestamped" && e.metadata?.slug === slug,
  );
  if (existingTimestamped) {
    return {
      data: {
        slug,
        systemId,
        timestampTokenBase64: existingTimestamped.metadata?.timestampTokenBase64 as string,
        tsaUrl: existingTimestamped.metadata?.tsaUrl as string,
        bordbuchEventId: existingTimestamped.id,
        idempotent: true,
        timestampAssurance:
          (existingTimestamped.metadata?.timestampAssurance as TimestampAssurance) ?? "rfc3161",
        ...(existingTimestamped.metadata?.qualificationEvidenceRef
          ? {
              qualificationEvidenceRef: existingTimestamped.metadata
                .qualificationEvidenceRef as string,
            }
          : {}),
      },
      exitCode: 0,
      summary: `[nachweis.timestamp] ${systemId}: already timestamped '${slug}' (bordbuch: ${existingTimestamped.id})`,
      nextSteps: [
        {
          action: `Approve the nachweis: pnpm exec werkstatt run nachweis.approve --site ${systemId} --slug ${slug}`,
          kind: "optional",
        },
      ],
    };
  }

  const adapter: TsaAdapter = tsaUrl ? new HttpTsaAdapter("custom", tsaUrl) : FreeTsaAdapter;

  if (dryRun) {
    return {
      data: {
        slug,
        systemId,
        timestampTokenBase64: "",
        tsaUrl: adapter.url,
        bordbuchEventId: null,
        idempotent: false,
        timestampAssurance,
        ...(qualificationEvidenceRef ? { qualificationEvidenceRef } : {}),
      },
      exitCode: 0,
      summary: `[nachweis.timestamp] ${systemId}: DRY RUN — would timestamp '${slug}' via ${adapter.name}`,
    };
  }

  const timestampTokenBytes = await adapter.timestamp(signatureBytes);
  const timestampTokenBase64 = Buffer.from(timestampTokenBytes).toString("base64");

  const operationId = generateOperationId();
  await acquireLock(
    workspaceRoot,
    `system:${systemId}`,
    operationId,
    "nachweis.timestamp",
    "agent",
  );
  await acquireLock(
    workspaceRoot,
    `bordbuch:${systemId}`,
    operationId,
    "nachweis.timestamp",
    "agent",
  );

  let bordbuchEventId: string;
  try {
    const { entry } = await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "nachweis-timestamped",
      `Record '${slug}' timestamped via ${adapter.name}`,
      "agent",
      {
        writerRole: "nachweis",
        metadata: {
          slug,
          timestampTokenBase64,
          tsaUrl: adapter.url,
          tsaName: adapter.name,
          timestampAssurance,
          ...(qualificationEvidenceRef ? { qualificationEvidenceRef } : {}),
        },
      },
      `Bordbuch: nachweis-timestamped ${systemId} ${slug}`,
    );
    bordbuchEventId = entry.id;
  } finally {
    await releaseLock(workspaceRoot, `bordbuch:${systemId}`);
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }

  return {
    data: {
      slug,
      systemId,
      timestampTokenBase64,
      tsaUrl: adapter.url,
      bordbuchEventId,
      idempotent: false,
      timestampAssurance,
      ...(qualificationEvidenceRef ? { qualificationEvidenceRef } : {}),
    },
    exitCode: 0,
    summary: `[nachweis.timestamp] ${systemId}: timestamped '${slug}' via ${adapter.name} (bordbuch: ${bordbuchEventId})`,
    nextSteps: [
      {
        action: `Approve the nachweis: pnpm exec werkstatt run nachweis.approve --site ${systemId} --slug ${slug}`,
        kind: "optional",
      },
    ],
  };
}
