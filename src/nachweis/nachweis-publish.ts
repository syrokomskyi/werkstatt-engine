/*
<MODULE_CONTRACT>
<purpose>RFC-0707: nachweis.publish command handler — enforces publication gate and transitions record to published.</purpose>
<keywords>nachweis, publish, gate, public, bordbuch</keywords>
<responsibilities>
  <item>Checks publication gate preconditions using policy-driven V2 gate (RFC-0872).</item>
  <item>Requires N3 verification level (RFC-0715: --pilot-n2-exception removed, N2 grandfathering for existing records).</item>
  <item>Sets publication.visibility: public on EvidenceSource entity.</item>
  <item>Appends nachweis-record Bordbuch entry.</item>
  <item>Calls nachweis.manifest.generate to regenerate manifest.</item>
  <item>Fails without modifying state if any gate condition is not met.</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
</responsibilities>
<non-goals>
  <item>Does not create EvidenceSource entities — that is done during ingest/content authoring.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0707: initial nachweis.publish command handler.</item>
  <item>RFC-0715: remove --pilot-n2-exception flag, require N3 only. N2 grandfathering: existing N2-published records remain valid.</item>
  <item>RFC-0872: replace legacy boolean gate with policy-driven V2 gate.</item>
  <item>RFC-0888: pass --skip-bordbuch to manifest.generate and append sichtpass Bordbuch entry after manifest regeneration.</item>
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
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";
import {
  isNachweisEntitled,
  makeSkipResult,
  resolveNachweisCachePath,
  resolvePbpEntityDir,
  resolveDefaultLang,
  evaluateGateV2,
  type NachweisPublishResult,
} from "./nachweis-io.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function _flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

export async function runNachweisPublish(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisPublishResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const slug = flagString(input, "slug");

  if (!systemId) throw new Error("[nachweis.publish] --system is required");
  if (!slug) throw new Error("[nachweis.publish] --slug is required");

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.publish",
      systemId,
    ) as unknown as KernelCommandResult<NachweisPublishResult>;
  }

  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const lang = await resolveDefaultLang(cachePath);

  // Read EvidenceSource entity
  const evidenceDir = resolvePbpEntityDir(cachePath, lang, "evidence-source");
  const evidenceFile = path.join(evidenceDir, `${slug}.md`);

  if (!existsSync(evidenceFile)) {
    throw new Error(
      `[nachweis.publish] NOT_FOUND: evidence-source '${slug}' not found at ${evidenceFile}`,
    );
  }

  const rawEvidence = await fs.readFile(evidenceFile, "utf8");
  const { data: evidenceData, content: evidenceContent } = parseMarkdownFrontmatter(rawEvidence);

  // Read Consent entity
  const consentDir = resolvePbpEntityDir(cachePath, lang, "consent");
  const consentFile = path.join(consentDir, `${slug}.md`);
  let consentData: Record<string, unknown> | undefined;
  if (existsSync(consentFile)) {
    const rawConsent = await fs.readFile(consentFile, "utf8");
    consentData = parseMarkdownFrontmatter(rawConsent).data;
  }

  // Read bordbuch entries for gate evaluation
  const { readBordbuch } = await import("../bordbuch/bordbuch-io.ts");
  const bordbuchEntries = await readBordbuch(workspaceRoot, systemId);
  const nachweisEntries = bordbuchEntries.filter(
    (e) => e.kind === "nachweis-record" || e.kind === "nachweis-consent",
  );

  // Evaluate gate V2 (RFC-0872: policy-driven, shared with nachweis.validate)
  const kind = evidenceData.kind as string | undefined;
  if (!kind) {
    throw new Error(`[nachweis.publish] evidence-source '${slug}' has no kind field`);
  }

  const gate = evaluateGateV2(slug, kind, {
    evidenceData: evidenceData as Record<string, unknown>,
    consentData: consentData as Record<string, unknown> | undefined,
    bordbuchEntries: nachweisEntries,
  });

  if (!gate.allPassed) {
    const failedConditions = gate.conditions
      .filter((c) => c.required && c.status !== "pass")
      .map((c) => c.id);
    return {
      data: {
        recordId: (evidenceData.recordId as string | undefined) ?? `nr_${slug}`,
        systemId,
        published: false,
        gateResult: gate,
        bordbuchEventId: null,
      },
      exitCode: 1,
      summary: `[nachweis.publish] ${systemId}: gate failed for '${slug}' — policy: ${gate.policyId}, failed: ${failedConditions.join(", ")}`,
      nextSteps: [
        {
          action: `Fix the failed gate conditions (${failedConditions.join(", ")}), then re-run: pnpm exec werkstatt run nachweis.publish --site ${systemId} --slug ${slug}`,
          kind: "required",
        },
      ],
    };
  }

  // Gate passed — update EvidenceSource publication
  const publication = (evidenceData.publication as Record<string, unknown> | undefined) ?? {};
  publication.visibility = "public";
  publication.publishedAt = new Date().toISOString();
  evidenceData.publication = publication;

  const updatedContent = stringifyMarkdownFrontmatter(evidenceContent, evidenceData);
  await fs.writeFile(evidenceFile, updatedContent, "utf8");

  // Append Bordbuch entry
  const operationId = generateOperationId();
  await acquireLock(workspaceRoot, `system:${systemId}`, operationId, "nachweis.publish", "agent");
  await acquireLock(
    workspaceRoot,
    `bordbuch:${systemId}`,
    operationId,
    "nachweis.publish",
    "agent",
  );

  let bordbuchEventId: string | null = null;
  try {
    const { entry } = await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "nachweis-record",
      `Published '${slug}'`,
      "agent",
      {
        writerRole: "nachweis",
        metadata: {
          slug,
          verificationLevel: "N3",
          publishedAt: publication.publishedAt,
        },
      },
      `Bordbuch: nachweis-record ${systemId} ${slug}`,
    );
    bordbuchEventId = entry.id;
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

  logger.info(`[nachweis.publish] published '${slug}' — regenerating manifest`);

  // RFC-0888: Append sichtpass Bordbuch entry for the published slug
  const sichtpassOperationId = generateOperationId();
  await acquireLock(
    workspaceRoot,
    `system:${systemId}`,
    sichtpassOperationId,
    "nachweis.publish",
    "agent",
  );
  await acquireLock(
    workspaceRoot,
    `bordbuch:${systemId}`,
    sichtpassOperationId,
    "nachweis.publish",
    "agent",
  );
  try {
    await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "sichtpass",
      `Sichtpass manifest entry generated for '${slug}'`,
      "agent",
      {
        writerRole: "nachweis",
        metadata: {
          slug,
          manifestVersion: "1.0.0",
          recordHash: (evidenceData.items as Record<string, { sha256?: string }> | undefined)
            ? (Object.values(evidenceData.items as Record<string, { sha256?: string }>)[0]
                ?.sha256 ?? "")
            : "",
          signaturePresent: bordbuchEntries.some(
            (e) => e.kind === "nachweis-signed" && e.metadata?.slug === slug,
          ),
          timestampPresent: bordbuchEntries.some(
            (e) => e.kind === "nachweis-timestamped" && e.metadata?.slug === slug,
          ),
          verificationLevel: "N3",
        },
      },
      `Bordbuch: sichtpass ${systemId} ${slug} published`,
    );
  } finally {
    await releaseLock(workspaceRoot, `bordbuch:${systemId}`);
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }

  return {
    data: {
      recordId: (evidenceData.recordId as string | undefined) ?? `nr_${slug}`,
      systemId,
      published: true,
      gateResult: gate,
      bordbuchEventId,
    },
    exitCode: 0,
    summary: `[nachweis.publish] ${systemId}: published '${slug}' (bordbuch: ${bordbuchEventId})`,
    nextSteps: [
      {
        action: `Verify the published nachweis: pnpm exec werkstatt run nachweis.verify-signature --site ${systemId} --slug ${slug}`,
        kind: "optional",
      },
    ],
  };
}
