/*
<MODULE_CONTRACT>
<purpose>RFC-0707: nachweis.withdraw command handler — revokes consent (conditional on policy), sets withdrawn status, regenerates manifest.</purpose>
<keywords>nachweis, withdraw, revoke, consent, bordbuch, manifest</keywords>
<responsibilities>
  <item>Sets record_status: withdrawn, publication.visibility: private.</item>
  <item>RFC-0872: conditionally revokes consent only for attestation-v1 policy records.</item>
  <item>Appends nachweis-consent (if applicable) and nachweis-record Bordbuch entries.</item>
  <item>Regenerates manifest to remove withdrawn record from public output.</item>
  <item>Idempotent: if already withdrawn, returns no-op result.</item>
  <item>Does NOT delete R2 object — personal data persists as audit trail.</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
</responsibilities>
<non-goals>
  <item>Does not implement data retention policy — deferred to future RFC.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0707: initial nachweis.withdraw command handler.</item>
  <item>RFC-0872: conditionally revoke consent based on publication policy (only attestation-v1).</item>
  <item>RFC-0888: pass --skip-bordbuch to manifest.generate and append sichtpass Bordbuch entry with withdrawn: true after manifest regeneration.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";
import {
  parseMarkdownFrontmatter,
  stringifyMarkdownFrontmatter,
} from "@warpgogol/werkstatt-shared/content";
import {
  appendBatchAndCommitBordbuch,
  appendAndCommitBordbuch,
} from "../bordbuch/bordbuch-commit-helper.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";
import {
  isNachweisEntitled,
  makeSkipResult,
  resolveNachweisCachePath,
  resolvePbpEntityDir,
  resolveDefaultLang,
  resolveNachweisPublicationPolicy,
  type NachweisWithdrawResult,
} from "./nachweis-io.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runNachweisWithdraw(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisWithdrawResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const slug = flagString(input, "slug");
  const reason = flagString(input, "reason") ?? "withdrawn by operator";

  if (!systemId) throw new Error("[nachweis.withdraw] --system is required");
  if (!slug) throw new Error("[nachweis.withdraw] --slug is required");

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.withdraw",
      systemId,
    ) as unknown as KernelCommandResult<NachweisWithdrawResult>;
  }

  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const lang = await resolveDefaultLang(cachePath);

  // Read EvidenceSource entity
  const evidenceDir = resolvePbpEntityDir(cachePath, lang, "evidence-source");
  const evidenceFile = path.join(evidenceDir, `${slug}.md`);

  if (!existsSync(evidenceFile)) {
    throw new Error(
      `[nachweis.withdraw] NOT_FOUND: evidence-source '${slug}' not found at ${evidenceFile}`,
    );
  }

  const rawEvidence = await fs.readFile(evidenceFile, "utf8");
  const { data: evidenceData, content: evidenceContent } = parseMarkdownFrontmatter(rawEvidence);

  // Check if already withdrawn (idempotent)
  const currentRecordStatus = (evidenceData as Record<string, unknown>).recordStatus as
    string | undefined;
  if (currentRecordStatus === "withdrawn") {
    return {
      data: {
        recordId: (evidenceData.recordId as string | undefined) ?? `nr_${slug}`,
        systemId,
        withdrawn: false,
        alreadyWithdrawn: true,
        bordbuchEventIds: [],
      },
      exitCode: 0,
      summary: `[nachweis.withdraw] ${systemId}: '${slug}' already withdrawn — no-op`,
    };
  }

  // Update EvidenceSource: set record_status and publication.visibility
  (evidenceData as Record<string, unknown>).recordStatus = "withdrawn";
  const publication =
    ((evidenceData as Record<string, unknown>).publication as
      Record<string, unknown> | undefined) ?? {};
  publication.visibility = "private";
  (evidenceData as Record<string, unknown>).publication = publication;

  const updatedContent = stringifyMarkdownFrontmatter(evidenceContent, evidenceData);
  await fs.writeFile(evidenceFile, updatedContent, "utf8");

  // RFC-0872: conditionally revoke consent based on publication policy
  const kind = (evidenceData as Record<string, unknown>).kind as string | undefined;
  const policyId = kind ? resolveNachweisPublicationPolicy(kind) : "attestation-v1";
  const shouldRevokeConsent = policyId === "attestation-v1";

  // Update Consent entity if it exists and policy requires consent
  const consentDir = resolvePbpEntityDir(cachePath, lang, "consent");
  const consentFile = path.join(consentDir, `${slug}.md`);
  let consentRevoked = false;
  if (shouldRevokeConsent && existsSync(consentFile)) {
    const rawConsent = await fs.readFile(consentFile, "utf8");
    const { data: consentData, content: consentContent } = parseMarkdownFrontmatter(rawConsent);
    const existingScope =
      (consentData.consentScope as
        | {
            document?: { status?: string; grantedAt?: string | null; method?: string };
            screenshot?: { status?: string; grantedAt?: string | null; method?: string };
            websiteLink?: { status?: string; grantedAt?: string | null; method?: string };
          }
        | undefined) ?? {};
    const defaultEntry = { status: "not_requested", grantedAt: null, method: "none" };
    consentData.consentScope = {
      document: { status: "denied", grantedAt: null, method: "none" },
      screenshot: existingScope.screenshot ?? defaultEntry,
      websiteLink: existingScope.websiteLink ?? defaultEntry,
    };
    delete consentData.consentStatus;
    delete consentData.grantedAt;
    delete consentData.method;
    const updatedConsent = stringifyMarkdownFrontmatter(consentContent, consentData);
    await fs.writeFile(consentFile, updatedConsent, "utf8");
    consentRevoked = true;
  }

  // Append Bordbuch entries
  const operationId = generateOperationId();
  await acquireLock(workspaceRoot, `system:${systemId}`, operationId, "nachweis.withdraw", "agent");
  await acquireLock(
    workspaceRoot,
    `bordbuch:${systemId}`,
    operationId,
    "nachweis.withdraw",
    "agent",
  );

  const bordbuchEventIds: string[] = [];
  try {
    const { entries } = await appendBatchAndCommitBordbuch(
      workspaceRoot,
      systemId,
      shouldRevokeConsent
        ? [
            {
              kind: "nachweis-consent",
              summary: `Consent revoked for '${slug}': ${reason}`,
              actor: "agent",
              options: {
                writerRole: "nachweis",
                metadata: { slug, reason, action: "withdraw" },
              },
            },
            {
              kind: "nachweis-record",
              summary: `Withdrawn '${slug}': ${reason}`,
              actor: "agent",
              options: {
                writerRole: "nachweis",
                metadata: { slug, reason, action: "withdraw", policyId },
              },
            },
          ]
        : [
            {
              kind: "nachweis-record",
              summary: `Withdrawn '${slug}': ${reason}`,
              actor: "agent",
              options: {
                writerRole: "nachweis",
                metadata: { slug, reason, action: "withdraw", policyId },
              },
            },
          ],
      `Bordbuch: nachweis-withdraw ${systemId} ${slug}`,
    );
    for (const e of entries) {
      bordbuchEventIds.push(e.id);
    }
  } finally {
    await releaseLock(workspaceRoot, `bordbuch:${systemId}`);
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }

  // Regenerate manifest — pass --skip-bordbuch to prevent duplicate sichtpass entry (RFC-0888)
  await executeKernelCommand({
    workspaceRoot,
    commandName: "nachweis.manifest.generate",
    siteName: systemId,
    argv: [`--system=${systemId}`, "--skip-bordbuch"],
  });

  logger.info(
    `[nachweis.withdraw] withdrawn '${slug}' — manifest regenerated${consentRevoked ? " (consent revoked)" : " (no consent revocation — policy: " + policyId + ")"}`,
  );

  // RFC-0888: Append sichtpass Bordbuch entry with withdrawn: true
  const sichtpassOperationId = generateOperationId();
  await acquireLock(
    workspaceRoot,
    `system:${systemId}`,
    sichtpassOperationId,
    "nachweis.withdraw",
    "agent",
  );
  await acquireLock(
    workspaceRoot,
    `bordbuch:${systemId}`,
    sichtpassOperationId,
    "nachweis.withdraw",
    "agent",
  );
  try {
    await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "sichtpass",
      `Sichtpass manifest entry withdrawn for '${slug}'`,
      "agent",
      {
        writerRole: "nachweis",
        metadata: {
          slug,
          manifestVersion: "1.0.0",
          withdrawn: true,
          verificationLevel: "N0",
        },
      },
      `Bordbuch: sichtpass ${systemId} ${slug} withdrawn`,
    );
  } finally {
    await releaseLock(workspaceRoot, `bordbuch:${systemId}`);
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }

  return {
    data: {
      recordId: (evidenceData.recordId as string | undefined) ?? `nr_${slug}`,
      systemId,
      withdrawn: true,
      alreadyWithdrawn: false,
      bordbuchEventIds,
    },
    exitCode: 0,
    summary: `[nachweis.withdraw] ${systemId}: withdrawn '${slug}' (bordbuch: ${bordbuchEventIds.length} entries)`,
    nextSteps: [
      {
        action: `Validate the nachweis: pnpm exec werkstatt run nachweis.validate --site ${systemId}`,
        kind: "optional",
      },
    ],
  };
}
