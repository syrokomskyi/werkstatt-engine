/*
<MODULE_CONTRACT>
<purpose>RFC-0715/RFC-0871/RFC-0921: nachweis.verify-signature command handler — verifies the Ed25519 operator signature and RFC 3161 timestamp for a Nachweis record, reporting timestamp assurance metadata via shared signing core.</purpose>
<keywords>nachweis, verify, signature, ed25519, timestamp, rfc3161</keywords>
<responsibilities>
  <item>Reads the nachweis-signed and nachweis-timestamped Bordbuch entries for the slug.</item>
  <item>Reconstructs the canonical record payload from the EvidenceSource entity.</item>
  <item>Verifies the Ed25519 signature against the published public key.</item>
  <item>Reports timestamp token presence (does not cryptographically verify the TSA token — deferred).</item>
  <item>RFC-0871: reports timestampAssurance from Bordbuch metadata, defaults to rfc3161 for legacy entries.</item>
  <item>Read-only command — does not modify state.</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
</responsibilities>
<non-goals>
  <item>Does not cryptographically verify the RFC 3161 timestamp token against the TSA certificate chain — that requires TSA trust anchor configuration and is deferred to a future RFC.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0715: initial nachweis.verify-signature command handler.</item>
  <item>RFC-0715 review fix: import flagString from nachweis-n3-types.ts.</item>
  <item>RFC-0871: report timestampAssurance and qualificationEvidenceRef from Bordbuch metadata, default rfc3161 for legacy entries.</item>
  <item>RFC-0921: delegate verification to shared signing core (verify, canonicalBytes, fromHex). Remove @noble/ed25519 import. Remove canonicalRecordPayload import.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { verify as signingVerify, fromHex } from "@warpgogol/werkstatt-engine/signing";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { parseMarkdownFrontmatter } from "@warpgogol/werkstatt-shared/content";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";
import {
  isNachweisEntitled,
  makeSkipResult,
  resolveNachweisCachePath,
  resolveDefaultLang,
  resolvePbpEntityDir,
  flagString,
  type NachweisVerifySignatureResult,
  type TimestampAssurance,
} from "./nachweis-n3-types.ts";
import type { NachweisRecordPayload } from "./nachweis-sign.ts";

export async function runNachweisVerifySignature(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisVerifySignatureResult>> {
  const { workspaceRoot } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const slug = flagString(input, "slug");

  if (!systemId) throw new Error("[nachweis.verify-signature] --system is required");
  if (!slug) throw new Error("[nachweis.verify-signature] --slug is required");

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.verify-signature",
      systemId,
    ) as unknown as KernelCommandResult<NachweisVerifySignatureResult>;
  }

  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const lang = await resolveDefaultLang(cachePath);
  const evidenceDir = resolvePbpEntityDir(cachePath, lang, "evidence-source");
  const evidenceFile = path.join(evidenceDir, `${slug}.md`);

  if (!existsSync(evidenceFile)) {
    throw new Error(
      `[nachweis.verify-signature] NOT_FOUND: evidence-source '${slug}' not found at ${evidenceFile}`,
    );
  }

  const rawEvidence = await fs.readFile(evidenceFile, "utf8");
  const { data: evidenceData } = parseMarkdownFrontmatter(rawEvidence);

  const payload: NachweisRecordPayload = {
    recordId: (evidenceData.recordId as string | undefined) ?? `nr_${slug}`,
    slug,
    kind: (evidenceData.kind as string | undefined) ?? "evidence",
    name: (evidenceData.name as string | undefined) ?? slug,
    items: (evidenceData.items as Record<string, unknown> | undefined) ?? {},
  };

  const bordbuchEntries = await readBordbuch(workspaceRoot, systemId);
  const signedEntry = bordbuchEntries.find(
    (e) => e.kind === "nachweis-signed" && e.metadata?.slug === slug,
  );
  const timestampedEntry = bordbuchEntries.find(
    (e) => e.kind === "nachweis-timestamped" && e.metadata?.slug === slug,
  );

  if (!signedEntry) {
    return {
      data: {
        slug,
        systemId,
        signatureValid: false,
        timestampVerified: false,
        timestampAssurance: "rfc3161",
        publicKeyHex: null,
        details: "No nachweis-signed Bordbuch entry found for this slug.",
      },
      exitCode: 1,
      summary: `[nachweis.verify-signature] ${systemId}: FAIL — no signature found for '${slug}'`,
      nextSteps: [
        {
          action: `Sign the nachweis: pnpm exec werkstatt run nachweis.sign --site ${systemId} --slug ${slug}`,
          kind: "required",
        },
      ],
    };
  }

  const signatureHex = signedEntry.metadata?.signatureHex as string | undefined;
  const publicKeyHex = signedEntry.metadata?.publicKeyHex as string | undefined;

  if (!signatureHex || !publicKeyHex) {
    return {
      data: {
        slug,
        systemId,
        signatureValid: false,
        timestampVerified: false,
        timestampAssurance: "rfc3161",
        publicKeyHex: publicKeyHex ?? null,
        details: "Signature or public key metadata missing from Bordbuch entry.",
      },
      exitCode: 1,
      summary: `[nachweis.verify-signature] ${systemId}: FAIL — incomplete signature metadata for '${slug}'`,
      nextSteps: [
        {
          action: `Re-sign the nachweis: pnpm exec werkstatt run nachweis.sign --site ${systemId} --slug ${slug}`,
          kind: "required",
        },
      ],
    };
  }

  const signatureBytes = fromHex(signatureHex);
  const publicKeyBytes = fromHex(publicKeyHex);

  let signatureValid = false;
  try {
    signatureValid = await signingVerify(
      publicKeyBytes,
      payload as unknown as Record<string, unknown>,
      signatureBytes,
    );
  } catch {
    signatureValid = false;
  }

  const timestampVerified = timestampedEntry != null;
  const timestampAssurance: TimestampAssurance =
    (timestampedEntry?.metadata?.timestampAssurance as TimestampAssurance | undefined) ?? "rfc3161";
  const qualificationEvidenceRef = timestampedEntry?.metadata?.qualificationEvidenceRef as
    string | undefined;

  const assuranceLabel =
    timestampAssurance === "eidas-qualified" ? "eIDAS qualified timestamp" : "RFC 3161 timestamp";

  const details = signatureValid
    ? timestampVerified
      ? `Signature valid, ${assuranceLabel} token present.`
      : "Signature valid, but no RFC 3161 timestamp token found."
    : "Signature verification failed — canonical payload does not match.";

  return {
    data: {
      slug,
      systemId,
      signatureValid,
      timestampVerified,
      timestampAssurance,
      ...(qualificationEvidenceRef ? { qualificationEvidenceRef } : {}),
      publicKeyHex,
      details,
    },
    exitCode: signatureValid ? 0 : 1,
    summary: `[nachweis.verify-signature] ${systemId}: ${signatureValid ? "PASS" : "FAIL"} — '${slug}' (signature: ${signatureValid}, timestamp: ${timestampVerified}, assurance: ${timestampAssurance})`,
    nextSteps: signatureValid
      ? undefined
      : [
          {
            action: `Re-sign the nachweis: pnpm exec werkstatt run nachweis.sign --site ${systemId} --slug ${slug}`,
            kind: "required",
          },
        ],
  };
}
