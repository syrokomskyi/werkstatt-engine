/*
<MODULE_CONTRACT>
<purpose>RFC-0707: nachweis.validate command handler — validates PBP trust entities and enforces publication gate.</purpose>
<keywords>nachweis, validate, publication, gate, consent, evidence, bordbuch</keywords>
<responsibilities>
  <item>Reads PBP EvidenceSource, Consent, and Claim entities from the cache clone.</item>
  <item>Checks EvidenceSource items for sha256 on Nachweis kinds.</item>
  <item>Checks Consent entities with consentScope.document.status granted have grantedAt set.</item>
  <item>Checks Claim entities for valid BCP 47 statementLang tags.</item>
  <item>Enforces publication gate: no published record without all conditions met.</item>
  <item>Delegates bordbuch hash-chain validation to bordbuch.validate.</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
  <item>RFC-0872: policy-driven gate V2, technical-assessment validation, locale drift check.</item>
  <item>ADR-0054: enforces the technical-assessment evidence profile decision — canonical raw artifact, assessment metadata, authorization basis, no dummy consent.</item>
</responsibilities>
<non-goals>
  <item>Does not modify any state — read-only validation.</item>
  <item>Does not validate PBP schema conformance — that is the PBP compiler's job.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0707: initial nachweis.validate command handler.</item>
  <item>RFC-0715: add N3 artifact check — verify nachweis-signed and nachweis-timestamped entries exist for N3 records.</item>
  <item>RFC-0871: add n3-timestamp-qualification-evidence-missing violation for eidas-qualified records without qualificationEvidenceRef.</item>
  <item>RFC-0872: replace evaluateGate with policy-driven evaluateGateV2, add technical-assessment validation, locale drift check.</item>
  <item>RFC-0880: add NACHWEIS-SLUG-01 check for mandatory slug in Nachweis evidence records.</item>
  <item>RFC-0886: add NACHWEIS-DISPLAY-CONSENT-01 check for display↔consent consistency (warning, not hard failure).</item>
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
  snapshotCanonicalJsonObjectV1,
  canonicalJsonHashV1,
} from "@warpgogol/werkstatt-engine/fingerprint";
import { parseMarkdownFrontmatter, loadSystemManifest } from "@warpgogol/werkstatt-shared/content";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";
import {
  isNachweisEntitled,
  makeSkipResult,
  resolveNachweisCachePath,
  resolvePbpEntityDir,
  resolveDefaultLang,
  evaluateGateV2,
  isValidSha256Hex,
  type NachweisPublicationGateV2,
  type NachweisValidateResult,
  type NachweisViolation,
} from "./nachweis-io.ts";

const NACHWEIS_EVIDENCE_KINDS = new Set([
  "client-statement",
  "project-confirmation",
  "certificate",
  "operational-evidence",
  // RFC-0872: technical assessment evidence type
  "technical-assessment",
]);

const BCP47_PATTERN = /^[a-z]{2,3}(-[A-Z][a-zA-Z]{3})?(-[A-Z]{2})?$/;

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

interface PbpEntityRecord {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

async function readPbpEntitiesByType(
  cachePath: string,
  entityType: string,
  lang: string,
): Promise<PbpEntityRecord[]> {
  const dir = resolvePbpEntityDir(cachePath, lang, entityType);
  if (!existsSync(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const records: PbpEntityRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md") && !entry.name.endsWith(".yaml")) continue;
    const filePath = path.join(dir, entry.name);
    const raw = await fs.readFile(filePath, "utf8");
    if (entry.name.endsWith(".md")) {
      const { data } = parseMarkdownFrontmatter(raw);
      records.push({ id: entry.name.replace(/\.(md|yaml)$/, ""), type: entityType, data });
    } else {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        records.push({ id: entry.name.replace(/\.yaml$/, ""), type: entityType, data: parsed });
      } catch {
        // skip invalid YAML
      }
    }
  }
  return records;
}

function evaluateGateV2Local(
  slug: string,
  kind: string,
  evidenceRecord: PbpEntityRecord | undefined,
  consentRecord: PbpEntityRecord | undefined,
  bordbuchEntries: { kind: string; metadata?: Record<string, unknown> | null; summary: string }[],
): NachweisPublicationGateV2 {
  return evaluateGateV2(slug, kind, {
    evidenceData: (evidenceRecord?.data ?? {}) as Record<string, unknown>,
    consentData: consentRecord?.data as Record<string, unknown> | undefined,
    bordbuchEntries,
  });
}

async function resolveSupportedLangs(cachePath: string): Promise<string[]> {
  const contentDir = path.join(cachePath, "src", "content");
  const { manifest } = await loadSystemManifest(contentDir);
  const i18n = manifest.i18n as
    { default?: string; supported?: Record<string, unknown> } | undefined;
  if (!i18n?.default) return [];
  const langs = Object.keys(i18n.supported ?? { [i18n.default]: true });
  return langs.length > 0 ? langs : [i18n.default];
}

export async function runNachweisValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisValidateResult>> {
  const { workspaceRoot } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  if (!systemId) throw new Error("[nachweis.validate] --system is required");

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.validate",
      systemId,
    ) as unknown as KernelCommandResult<NachweisValidateResult>;
  }

  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const lang = await resolveDefaultLang(cachePath);

  const evidenceSources = await readPbpEntitiesByType(cachePath, "evidence-source", lang);
  const consents = await readPbpEntitiesByType(cachePath, "consent", lang);
  const claims = await readPbpEntitiesByType(cachePath, "claim", lang);

  const violations: NachweisViolation[] = [];

  // Check EvidenceSource entities with Nachweis kinds have sha256 in items
  for (const es of evidenceSources) {
    const kind = es.data.kind as string | undefined;
    if (!kind || !NACHWEIS_EVIDENCE_KINDS.has(kind)) continue;

    // RFC-0880: NACHWEIS-SLUG-01 — mandatory slug in frontmatter
    const slug = (es.data as Record<string, unknown>).slug as string | undefined;
    if (typeof slug !== "string" || slug.trim() === "") {
      violations.push({
        rule: "NACHWEIS-SLUG-01",
        message: `EvidenceSource '${es.id}' has kind '${kind}' but no frontmatter slug. Add a slug field to the frontmatter.`,
        recordId: es.id,
      });
    }

    const items = es.data.items as Record<string, { sha256?: string }> | undefined;
    if (!items) {
      violations.push({
        rule: "evidence-missing-sha256",
        message: `EvidenceSource '${es.id}' has kind '${kind}' but no items[]`,
        recordId: es.id,
      });
      continue;
    }
    for (const [itemKey, item] of Object.entries(items)) {
      if (!isValidSha256Hex(item.sha256)) {
        violations.push({
          rule: "evidence-missing-sha256",
          message: `EvidenceSource '${es.id}' item '${itemKey}' is missing or has invalid sha256`,
          recordId: es.id,
        });
      }
    }
  }

  // RFC-0885: Check Consent entities with consentScope.document.status granted have grantedAt set
  for (const c of consents) {
    const scope = c.data.consentScope as
      { document?: { status?: string; grantedAt?: string | null } } | undefined;
    const docStatus = scope?.document?.status;
    if (docStatus === "granted") {
      const grantedAt = scope?.document?.grantedAt;
      if (grantedAt == null || grantedAt === "") {
        violations.push({
          rule: "consent-granted-without-timestamp",
          message: `Consent '${c.id}' has consentScope.document.status 'granted' but grantedAt is null`,
          recordId: c.id,
        });
      }
    }
  }

  // Check Claim entities for valid BCP 47 statementLang tags
  for (const cl of claims) {
    const statementLang = cl.data.statementLang as string | undefined;
    if (statementLang && !BCP47_PATTERN.test(statementLang)) {
      violations.push({
        rule: "claim-invalid-statement-lang",
        message: `Claim '${cl.id}' has invalid statementLang '${statementLang}' (not BCP 47)`,
        recordId: cl.id,
      });
    }
  }

  // Delegate bordbuch hash-chain validation
  const bordbuchResult = await executeKernelCommand({
    workspaceRoot,
    commandName: "bordbuch.validate",
    siteName: systemId,
    argv: [`--system=${systemId}`],
  });
  const bordbuchReport = Array.isArray(bordbuchResult) ? bordbuchResult[0] : bordbuchResult;
  if (bordbuchReport.exitCode !== 0) {
    violations.push({
      rule: "bordbuch-hash-chain",
      message: `bordbuch.validate reported violations: ${bordbuchReport.summary ?? "unknown"}`,
    });
  }

  // Publication gate evaluation per record
  const bordbuchEntries = await readBordbuch(workspaceRoot, systemId);
  const nachweisEntries = bordbuchEntries.filter(
    (e) =>
      e.kind === "nachweis-record" ||
      e.kind === "nachweis-consent" ||
      e.kind === "nachweis-signed" ||
      e.kind === "nachweis-timestamped",
  );

  const gateResults: NachweisPublicationGateV2[] = [];
  const slugs = new Set<string>();
  for (const es of evidenceSources) {
    const kind = es.data.kind as string | undefined;
    if (!kind || !NACHWEIS_EVIDENCE_KINDS.has(kind)) continue;
    const slug = ((es.data as Record<string, unknown>).slug as string | undefined) ?? es.id;
    slugs.add(slug);
  }

  for (const slug of slugs) {
    const evidenceRecord = evidenceSources.find(
      (e) =>
        ((e.data as Record<string, unknown>).slug as string | undefined) === slug || e.id === slug,
    );
    const consentRecord = consents.find(
      (c) => (c.data as Record<string, unknown>).slug === slug || c.id === slug,
    );
    const kind = (evidenceRecord?.data as Record<string, unknown>)?.kind as string | undefined;
    if (!kind) continue;
    const gate = evaluateGateV2Local(slug, kind, evidenceRecord, consentRecord, nachweisEntries);
    gateResults.push(gate);

    // Check if record is published but gate not passed
    const isPublished =
      (evidenceRecord?.data as Record<string, unknown>)?.recordStatus === "published";
    if (isPublished && !gate.allPassed) {
      const failedConditions = gate.conditions
        .filter((c) => c.required && c.status !== "pass")
        .map((c) => c.id);
      violations.push({
        rule: "publication-gate-violation",
        message: `Record '${slug}' is published but gate conditions not met (policy: ${gate.policyId}, failed: ${failedConditions.join(", ")})`,
        recordId: slug,
      });
    }

    // RFC-0872: technical-assessment-specific validation
    if (kind === "technical-assessment") {
      const assessment = (evidenceRecord?.data as Record<string, unknown>)?.assessment as
        Record<string, unknown> | undefined;
      if (!assessment) {
        violations.push({
          rule: "TECHNICAL_ASSESSMENT_METADATA_REQUIRED",
          message: `EvidenceSource '${slug}' has kind 'technical-assessment' but no assessment field`,
          recordId: slug,
        });
      }
      const items = (evidenceRecord?.data as Record<string, unknown>)?.items as
        Record<string, { role?: string; canonical?: boolean; sha256?: string }> | undefined;
      const hasCanonicalRaw =
        items != null &&
        Object.values(items).some((item) => item.role === "raw-result" && item.canonical === true);
      if (!hasCanonicalRaw) {
        violations.push({
          rule: "TECHNICAL_ASSESSMENT_CANONICAL_RAW_REQUIRED",
          message: `EvidenceSource '${slug}' has no canonical raw-result artifact`,
          recordId: slug,
        });
      }
      if (items != null && hasCanonicalRaw) {
        for (const [itemKey, item] of Object.entries(items)) {
          if (
            item.role === "raw-result" &&
            item.canonical === true &&
            !isValidSha256Hex(item.sha256)
          ) {
            violations.push({
              rule: "TECHNICAL_ASSESSMENT_HASH_REQUIRED",
              message: `EvidenceSource '${slug}' canonical raw-result item '${itemKey}' is missing sha256`,
              recordId: slug,
            });
          }
        }
        // RFC-0872 section 2: screenshot canonical invariant — if any item has
        // role: screenshot and canonical: true, there MUST also be a canonical raw-result
        const hasCanonicalScreenshot = Object.values(items).some(
          (item) => item.role === "screenshot" && item.canonical === true,
        );
        if (hasCanonicalScreenshot && !hasCanonicalRaw) {
          violations.push({
            rule: "TECHNICAL_ASSESSMENT_CANONICAL_SCREENSHOT_WITHOUT_RAW",
            message: `EvidenceSource '${slug}' has canonical screenshot but no canonical raw-result artifact (screenshots cannot be the sole canonical artifact)`,
            recordId: slug,
          });
        }
        // RFC-0872 section 2: no two canonical artifacts may reuse the same
        // logical item key for different hashes
        const canonicalHashes = new Map<string, string>();
        for (const [itemKey, item] of Object.entries(items)) {
          if (item.canonical === true && isValidSha256Hex(item.sha256)) {
            const existing = canonicalHashes.get(item.sha256);
            if (existing !== undefined && existing !== itemKey) {
              violations.push({
                rule: "TECHNICAL_ASSESSMENT_DUPLICATE_CANONICAL_HASH",
                message: `EvidenceSource '${slug}' canonical items '${existing}' and '${itemKey}' share the same sha256 '${item.sha256}'`,
                recordId: slug,
              });
            }
            canonicalHashes.set(item.sha256, itemKey);
          }
        }
      }
      // Check authorization basis
      if (
        assessment &&
        (assessment.authorizationBasis == null || assessment.authorizationBasis === "")
      ) {
        violations.push({
          rule: "ASSESSMENT_AUTHORIZATION_REQUIRED",
          message: `EvidenceSource '${slug}' technical assessment lacks authorizationBasis`,
          recordId: slug,
        });
      }
    }

    // RFC-0872: assessment field must be absent for non-technical kinds
    if (kind !== "technical-assessment") {
      const assessment = (evidenceRecord?.data as Record<string, unknown>)?.assessment;
      if (assessment != null) {
        violations.push({
          rule: "assessment-on-non-technical-kind",
          message: `EvidenceSource '${slug}' has kind '${kind}' but has an assessment field (only technical-assessment allows assessment)`,
          recordId: slug,
        });
      }
    }

    // RFC-0886: NACHWEIS-DISPLAY-CONSENT-01 — display↔consent consistency
    // For each visible display aspect, the corresponding consentScope aspect must have status "granted".
    // This is a warning (does not fail the command), reported in the result.
    const display = (evidenceRecord?.data as Record<string, unknown>)?.display as
      Record<string, string> | undefined;
    if (display) {
      const consentScope = (consentRecord?.data as Record<string, unknown>)?.consentScope as
        Record<string, { status?: string }> | undefined;
      const aspects = ["document", "screenshot", "websiteLink"];
      for (const aspect of aspects) {
        if (display[aspect] === "visible") {
          const aspectConsent = consentScope?.[aspect]?.status;
          if (aspectConsent !== "granted") {
            violations.push({
              rule: "NACHWEIS-DISPLAY-CONSENT-01",
              message: `EvidenceSource '${slug}' has display.${aspect} 'visible' but consentScope.${aspect}.status is '${aspectConsent ?? "not_requested"}' (expected 'granted')`,
              recordId: slug,
              severity: "warning",
            });
          }
        }
      }
    }

    // RFC-0715: N3 artifact check — published N3 records must have nachweis-signed and nachweis-timestamped entries
    if (isPublished && gate.conditions.find((c) => c.id === "n3-met")?.status === "pass") {
      const hasSigned = nachweisEntries.some(
        (e) => e.kind === "nachweis-signed" && e.metadata?.slug === slug,
      );
      const hasTimestamped = nachweisEntries.some(
        (e) => e.kind === "nachweis-timestamped" && e.metadata?.slug === slug,
      );
      if (!hasSigned) {
        violations.push({
          rule: "n3-missing-signature",
          message: `Record '${slug}' is published at N3 but has no nachweis-signed Bordbuch entry. Run nachweis.sign first.`,
          recordId: slug,
        });
      }
      if (!hasTimestamped) {
        violations.push({
          rule: "n3-missing-timestamp",
          message: `Record '${slug}' is published at N3 but has no nachweis-timestamped Bordbuch entry. Run nachweis.timestamp first.`,
          recordId: slug,
        });
      }

      // RFC-0871: eidas-qualified assurance requires qualificationEvidenceRef
      if (hasTimestamped) {
        const timestampedEntry = nachweisEntries.find(
          (e) => e.kind === "nachweis-timestamped" && e.metadata?.slug === slug,
        );
        const assurance = timestampedEntry?.metadata?.timestampAssurance as string | undefined;
        const evidenceRef = timestampedEntry?.metadata?.qualificationEvidenceRef as
          string | undefined;
        if (assurance === "eidas-qualified" && !evidenceRef) {
          violations.push({
            rule: "n3-timestamp-qualification-evidence-missing",
            message: `Record '${slug}' has timestampAssurance 'eidas-qualified' but no qualificationEvidenceRef in Bordbuch metadata. Provide --qualification-evidence-ref when running nachweis.timestamp.`,
            recordId: slug,
          });
        }
      }
    }
  }

  // RFC-0872: locale drift check for technical-assessment assessment field
  const supportedLangs = await resolveSupportedLangs(cachePath);
  if (supportedLangs.length > 1) {
    const assessmentByObsId = new Map<string, Map<string, string>>();
    for (const lang of supportedLangs) {
      const langEntities = await readPbpEntitiesByType(cachePath, "evidence-source", lang);
      for (const es of langEntities) {
        const kind = es.data.kind as string | undefined;
        if (kind !== "technical-assessment") continue;
        const assessment = es.data.assessment as Record<string, unknown> | undefined;
        if (!assessment) continue;
        const observationId = assessment.observationId as string | undefined;
        if (!observationId) continue;
        const snapshot = snapshotCanonicalJsonObjectV1(assessment);
        if (!snapshot.ok) continue;
        const hash = canonicalJsonHashV1(snapshot.value);
        let langMap = assessmentByObsId.get(observationId);
        if (!langMap) {
          langMap = new Map();
          assessmentByObsId.set(observationId, langMap);
        }
        langMap.set(lang, hash);
      }
    }
    for (const [observationId, langMap] of assessmentByObsId) {
      if (langMap.size < 2) continue;
      const hashes = [...langMap.values()];
      const allMatch = hashes.every((h) => h === hashes[0]);
      if (!allMatch) {
        violations.push({
          rule: "TECHNICAL_ASSESSMENT_LOCALE_DRIFT",
          message: `Technical assessment observationId '${observationId}' has locale drift — assessment values differ across locales: ${[...langMap.entries()].map(([l, h]) => `${l}=${h.slice(0, 16)}`).join(", ")}`,
        });
      }
    }
  }

  const hasViolations = violations.some((v) => v.severity !== "warning");
  const publishedCount = gateResults.filter((g) => g.allPassed).length;

  return {
    data: {
      systemId,
      records: slugs.size,
      violations,
      gateResults,
    },
    exitCode: hasViolations ? 1 : 0,
    summary: `[nachweis.validate] ${systemId}: ${slugs.size} records, ${violations.length} violations, ${publishedCount} published`,
    nextSteps: hasViolations
      ? [
          {
            action: `Fix the ${violations.length} violation${violations.length === 1 ? "" : "s"} above, then re-run: pnpm exec werkstatt run nachweis.validate --site ${systemId}`,
            kind: "required",
          },
        ]
      : undefined,
  };
}
