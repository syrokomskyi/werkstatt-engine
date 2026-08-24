/*
<MODULE_CONTRACT>
<purpose>RFC-0707: I/O layer for Nachweis kernel module — R2 upload, SHA-256 hashing, record ID generation.</purpose>
<keywords>nachweis, r2, sha256, hash, record, evidence, bordbuch</keywords>
<responsibilities>
  <item>Provides uploadToR2 for private evidence storage in the nachweise bucket.</item>
  <item>Computes SHA-256 hashes via @warpgogol/fingerprint byteHashFile.</item>
  <item>Generates deterministic record IDs in nr_{slug}_{YYYYMMDD} format.</item>
  <item>Resolves R2 storage paths for private and public document storage.</item>
  <item>Reads resolved entitlements to check for the nachweis feature.</item>
  <item>RFC-0872: provides policy-driven publication gate V2 types and policy resolution.</item>
  <item>RFC-0873: provides AssessmentBundleV1 types, Zod schema, and assessment R2 path resolution.</item>
  <item>ADR-0054: implements the technical-assessment evidence profile decision — policy-driven gate, assessment metadata, canonical raw artifact requirement.</item>
  <item>RFC-0886: adds display-consent-consistent gate condition, per-aspect consent evaluation, screenshot R2 path helper, NachweisScreenshotUploadResult interface.</item>
  <item>RFC-0890: adds raw screenshot R2/local path helpers, CaptureX filename parser, sharp-based image metadata detection, NachweisScreenshotIngestResult interface.</item>
  <item>RFC-0891: adds display screenshot R2 path helper, R2 download helper, NachweisScreenshotProcessResult interface.</item>
</responsibilities>
<non-goals>
  <item>Does not implement command handlers — those live in nachweis-*.ts files.</item>
  <item>Does not implement multipart uploads — individual files are under the 5 MB threshold.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0707: initial nachweis I/O layer with R2 upload, hash computation, record ID generation.</item>
  <item>RFC-0713: uploadToR2 passes R2_NACHWEIS envPrefix for per-bucket credential isolation.</item>
  <item>RFC-0714: add NachweisApproveResult, NachweisPublicDerivativeResult interfaces and resolveNachweisPublicR2Path helper.</item>
  <item>RFC-0872: add NachweisPublicationGateV2, policy resolution, extend NachweisManifestEntry, replace legacy NachweisPublicationGate.</item>
  <item>RFC-0873: add AssessmentBundleV1, assessmentBundleV1Schema, AssessmentIngestResult, resolveAssessmentR2Path, mediaTypeToExt, extend uploadToR2 with optional contentType.</item>
  <item>RFC-0886: add display-consent-consistent gate condition, per-aspect consent evaluation in evaluateGateV2, resolveNachweisScreenshotR2Path, NachweisScreenshotUploadResult, extend NachweisConsentUpdateResult with scope, extend NachweisManifestEntry with display and websiteUrl.</item>
  <item>RFC-0890: add resolveNachweisRawScreenshotR2Path, resolveNachweisRawScreenshotLocalPath, parseCaptureXFilename, detectImageMetadata, NachweisScreenshotIngestResult.</item>
  <item>RFC-0891: add resolveNachweisScreenshotDisplayR2Path, downloadFromR2, NachweisScreenshotProcessResult.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as yamlParse } from "yaml";
import { z } from "zod";
import { byteHashFile } from "@warpgogol/werkstatt-engine/fingerprint";
import { loadSystemManifest } from "@warpgogol/werkstatt-shared/content";
import { createR2Client, resolveR2ConfigFromEnv, MissingEnvError } from "../evidence/r2-client.ts";
import { resolveCacheClonePath, resolveActiveWorkpieceDir } from "../sternsystem/registry-io.ts";

const NACHWEIS_BUCKET = "nachweis";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

export function isValidSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX_RE.test(value);
}

export interface NachweisRecord {
  recordId: string;
  slug: string;
  recordType: string;
  titleDe: string;
  titleUk: string;
  titleEn?: string;
  qualityStatus: string;
  sourceSha256: string;
  r2Path: string;
  version: number;
  status: "preview" | "published" | "withdrawn";
}

export interface NachweisIngestResult {
  recordId: string;
  systemId: string;
  sourceSha256: string;
  r2Path: string;
  version: number;
  dryRun: boolean;
  bordbuchEventId: string | null;
}

export interface NachweisManifestEntry {
  recordId: string;
  slug: string;
  recordType: string;
  titleDe: string;
  titleUk: string;
  titleEn?: string;
  qualityStatus: string;
  sourceSha256: string;
  publishedAt: string | null;
  timestampAssurance: "rfc3161" | "eidas-qualified";
  // RFC-0872: observation identity fields for technical assessments
  kind?: string;
  seriesId?: string;
  observationId?: string;
  observedAt?: string;
  assessmentProviderId?: string;
  // RFC-0886: display and website fields for Nachweis evidence kinds
  display?: { document: string; screenshot: string; websiteLink: string };
  websiteUrl?: string;
}

export interface NachweisManifest {
  schemaVersion: string;
  generatedAt: null;
  expiresAt: null;
  records: NachweisManifestEntry[];
}

// RFC-0872: Policy-driven publication gate V2

export type NachweisPublicationPolicyId =
  "attestation-v1" | "operational-measurement-v1" | "technical-assessment-v1";

export type GateStatus = "pass" | "fail" | "not_applicable";

// RFC-0872: Gate condition IDs
export const GATE_CONDITION_IDS = [
  "source-integrity-verified",
  "record-approved",
  "n3-met",
  "legal-content-check-passed",
  "consent-granted",
  "public-derivative-ready",
  "canonical-raw-artifact-verified",
  "assessment-metadata-valid",
  "execution-authorization-basis-present",
  // RFC-0886: display↔consent consistency
  "display-consent-consistent",
] as const;

export type GateConditionId = (typeof GATE_CONDITION_IDS)[number];

export interface NachweisGateConditionResult {
  id: GateConditionId;
  required: boolean;
  status: GateStatus;
}

export interface NachweisPublicationGateV2 {
  slug: string;
  policyId: NachweisPublicationPolicyId;
  conditions: NachweisGateConditionResult[];
  allPassed: boolean;
}

export class UnsupportedNachweisKindError extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super(`[nachweis] unsupported evidence kind for publication policy: '${kind}'`);
    this.name = "UnsupportedNachweisKindError";
    this.kind = kind;
  }
}

const NACHWEIS_KIND_TO_POLICY: Record<string, NachweisPublicationPolicyId> = {
  "client-statement": "attestation-v1",
  "project-confirmation": "attestation-v1",
  certificate: "attestation-v1",
  "operational-evidence": "operational-measurement-v1",
  "technical-assessment": "technical-assessment-v1",
};

export function resolveNachweisPublicationPolicy(kind: string): NachweisPublicationPolicyId {
  const policy = NACHWEIS_KIND_TO_POLICY[kind];
  if (!policy) {
    throw new UnsupportedNachweisKindError(kind);
  }
  return policy;
}

// RFC-0872: Required conditions per policy
const REQUIRED_CONDITIONS: Record<NachweisPublicationPolicyId, Set<GateConditionId>> = {
  "attestation-v1": new Set<GateConditionId>([
    "source-integrity-verified",
    "record-approved",
    "n3-met",
    "legal-content-check-passed",
    "consent-granted",
    "public-derivative-ready",
    // RFC-0886: display↔consent consistency (attestation-v1 only)
    "display-consent-consistent",
  ]),
  "operational-measurement-v1": new Set<GateConditionId>([
    "source-integrity-verified",
    "record-approved",
    "n3-met",
    "legal-content-check-passed",
    "canonical-raw-artifact-verified",
    "execution-authorization-basis-present",
  ]),
  "technical-assessment-v1": new Set<GateConditionId>([
    "source-integrity-verified",
    "record-approved",
    "n3-met",
    "legal-content-check-passed",
    "canonical-raw-artifact-verified",
    "assessment-metadata-valid",
    "execution-authorization-basis-present",
  ]),
};

export function isConditionRequired(
  policyId: NachweisPublicationPolicyId,
  conditionId: GateConditionId,
): boolean {
  return REQUIRED_CONDITIONS[policyId].has(conditionId);
}

// RFC-0872: Shared gate evaluation — used by both nachweis.validate and nachweis.publish

const ISO_8601_WITH_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function validateAssessmentMetadata(assessment: Record<string, unknown>): boolean {
  if (assessment.profile !== "technical-assessment") return false;
  if (typeof assessment.seriesId !== "string" || assessment.seriesId === "") return false;
  if (typeof assessment.observationId !== "string" || assessment.observationId === "") return false;
  if (typeof assessment.observedAt !== "string" || !ISO_8601_WITH_TZ.test(assessment.observedAt))
    return false;
  const methodology = assessment.methodology as Record<string, unknown> | undefined;
  if (!methodology) return false;
  if (typeof methodology.runCount !== "number" || methodology.runCount < 1) return false;
  const freshness = assessment.freshness as Record<string, unknown> | undefined;
  if (!freshness) return false;
  if (typeof freshness.maxAgeDays !== "number" || freshness.maxAgeDays < 1) return false;
  const dimensions = assessment.dimensions;
  if (!Array.isArray(dimensions) || dimensions.length < 1) return false;

  for (const dim of dimensions as Record<string, unknown>[]) {
    // score, when present, is finite and in [0,100]
    if (dim.score != null) {
      if (
        typeof dim.score !== "number" ||
        !Number.isFinite(dim.score) ||
        dim.score < 0 ||
        dim.score > 100
      )
        return false;
    }
    // numerator/denominator must occur as a valid pair
    if (dim.numerator != null || dim.denominator != null) {
      if (typeof dim.numerator !== "number" || typeof dim.denominator !== "number") return false;
      if (dim.denominator <= 0) return false;
      if (dim.numerator < 0 || dim.numerator > dim.denominator) return false;
    }
    // samples, when present, contain finite values in [0,100]
    if (dim.samples != null) {
      if (!Array.isArray(dim.samples)) return false;
      for (const s of dim.samples) {
        if (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s > 100) return false;
      }
      // min/max must match sample extrema when samples are present
      const sampleMin = Math.min(...(dim.samples as number[]));
      const sampleMax = Math.max(...(dim.samples as number[]));
      if (dim.min != null && dim.min !== sampleMin) return false;
      if (dim.max != null && dim.max !== sampleMax) return false;
    }
  }

  // providerReportUrl, when present, must be HTTPS
  if (assessment.providerReportUrl != null) {
    if (
      typeof assessment.providerReportUrl !== "string" ||
      !assessment.providerReportUrl.startsWith("https:")
    )
      return false;
  }

  return true;
}

export interface NachweisGateInput {
  evidenceData: Record<string, unknown>;
  consentData: Record<string, unknown> | undefined;
  bordbuchEntries: {
    kind: string;
    metadata?: Record<string, unknown> | null;
    summary: string;
  }[];
}

export function evaluateGateV2(
  slug: string,
  kind: string,
  input: NachweisGateInput,
): NachweisPublicationGateV2 {
  const policyId = resolveNachweisPublicationPolicy(kind);
  const items = input.evidenceData.items as
    | Record<string, { sha256?: string; storage?: string; role?: string; canonical?: boolean }>
    | undefined;
  const assessment = input.evidenceData.assessment as Record<string, unknown> | undefined;

  // RFC-0886: per-aspect consent logic — all visible display aspects must have granted consent
  const display = input.evidenceData.display as Record<string, string> | undefined;
  const consentScope = input.consentData?.consentScope as
    Record<string, { status?: string }> | undefined;
  const aspects = ["document", "screenshot", "websiteLink"];
  const visibleAspects = aspects.filter((a) => display?.[a] === "visible");
  const consentGranted = visibleAspects.every((a) => consentScope?.[a]?.status === "granted");
  const displayConsentConsistent = consentGranted;
  const sourceIntegrityVerified =
    items != null &&
    Object.keys(items).length > 0 &&
    Object.values(items).every((item) => isValidSha256Hex(item.sha256));
  const recordApproved = input.bordbuchEntries.some(
    (e) => e.kind === "nachweis-record" && e.summary.includes("approved"),
  );
  const verificationLevelMet = input.bordbuchEntries.some(
    (e) => e.kind === "nachweis-record" && e.metadata?.verificationLevel === "N3",
  );
  const publicDerivativeReady =
    items != null && Object.values(items).some((item) => item.storage === "public");
  const legalContentCheckPassed = input.bordbuchEntries.some(
    (e) => e.kind === "nachweis-record" && e.metadata?.legalContentCheckPassed === true,
  );
  const canonicalRawArtifactVerified =
    items != null &&
    Object.values(items).some(
      (item) =>
        item.role === "raw-result" && item.canonical === true && isValidSha256Hex(item.sha256),
    );
  const assessmentMetadataValid = assessment != null && validateAssessmentMetadata(assessment);
  const executionAuthorizationBasisPresent =
    assessment != null &&
    assessment.authorizationBasis != null &&
    assessment.authorizationBasis !== "";

  const conditionResults: Record<GateConditionId, boolean> = {
    "source-integrity-verified": sourceIntegrityVerified,
    "record-approved": recordApproved,
    "n3-met": verificationLevelMet,
    "legal-content-check-passed": legalContentCheckPassed,
    "consent-granted": consentGranted,
    "public-derivative-ready": publicDerivativeReady,
    "canonical-raw-artifact-verified": canonicalRawArtifactVerified,
    "assessment-metadata-valid": assessmentMetadataValid,
    "execution-authorization-basis-present": executionAuthorizationBasisPresent,
    "display-consent-consistent": displayConsentConsistent,
  };

  const conditions: NachweisGateConditionResult[] = (
    Object.keys(conditionResults) as GateConditionId[]
  ).map((id) => {
    const required = isConditionRequired(policyId, id);
    const passed = conditionResults[id];
    const status = required ? (passed ? "pass" : "fail") : "not_applicable";
    return { id, required, status };
  });

  const allPassed = conditions.every((c) => !c.required || c.status === "pass");

  return {
    slug,
    policyId,
    conditions,
    allPassed,
  };
}

export interface NachweisValidateResult {
  systemId: string;
  records: number;
  violations: NachweisViolation[];
  gateResults: NachweisPublicationGateV2[];
}

export interface NachweisViolation {
  rule: string;
  message: string;
  recordId?: string;
  severity?: "error" | "warning";
}

export interface NachweisConsentUpdateResult {
  consentId: string;
  systemId: string;
  scope: string;
  previousStatus: string;
  newStatus: string;
  bordbuchEventId: string;
}

// RFC-0886: Screenshot upload result
export interface NachweisScreenshotUploadResult {
  slug: string;
  systemId: string;
  sha256: string;
  mediaType: string;
  storage: "public";
  r2Key: string;
  bordbuchEventId: string;
}

export interface NachweisPublishResult {
  recordId: string;
  systemId: string;
  published: boolean;
  gateResult: NachweisPublicationGateV2;
  bordbuchEventId: string | null;
}

export interface NachweisWithdrawResult {
  recordId: string;
  systemId: string;
  withdrawn: boolean;
  alreadyWithdrawn: boolean;
  bordbuchEventIds: string[];
}

export interface NachweisApproveResult {
  slug: string;
  systemId: string;
  verificationLevel: string;
  legalContentCheckPassed: boolean;
  bordbuchEventId: string | null;
}

export interface NachweisPublicDerivativeResult {
  slug: string;
  systemId: string;
  r2Path: string;
  publicDerivativeSha256: string;
  bordbuchEventId: string | null;
  alreadyUploaded: boolean;
}

export async function computeSourceSha256(filePath: string): Promise<string> {
  const hash = await byteHashFile(filePath);
  return hash;
}

export function generateRecordId(slug: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `nr_${slug}_${date}`;
}

export function resolveNachweisR2Path(systemId: string, recordId: string, version: number): string {
  return `${systemId}/private/${recordId}/v${version}/source.pdf`;
}

export function resolveNachweisPublicR2Path(
  systemId: string,
  recordId: string,
  version: number,
): string {
  return `${systemId}/public/${recordId}/v${version}/public.pdf`;
}

// RFC-0886: R2 path for website screenshots — separate path prefix from evidence PDFs
export function resolveNachweisScreenshotR2Path(
  systemId: string,
  slug: string,
  ext: string,
): string {
  return `${systemId}/screenshots/${slug}/website-screenshot${ext}`;
}

export async function uploadToR2(
  fileBuffer: Uint8Array,
  r2Path: string,
  contentType?: string,
): Promise<void> {
  const config = resolveR2ConfigFromEnv(NACHWEIS_BUCKET, "R2_NACHWEIS");
  const client = createR2Client(config);
  await client.putObject({
    key: r2Path,
    body: fileBuffer,
    contentType: contentType ?? "application/pdf",
  });
}

// RFC-0891: Download a file from R2 private storage (used for raw screenshot fallback)
export async function downloadFromR2(r2Path: string): Promise<Uint8Array> {
  const config = resolveR2ConfigFromEnv(NACHWEIS_BUCKET, "R2_NACHWEIS");
  const client = createR2Client(config);
  const result = await client.getObject(r2Path);
  return result.body;
}

// RFC-0891: R2 path for processed display screenshots — always .webp
export function resolveNachweisScreenshotDisplayR2Path(systemId: string, slug: string): string {
  return `${systemId}/screenshots/${slug}/website-screenshot.webp`;
}

// RFC-0891: Result of nachweis.screenshot.process command
export interface NachweisScreenshotProcessResult {
  slug: string;
  systemId: string;
  rawSha256: string;
  rawDimensions: { width: number; height: number };
  cropRegion: { left: number; top: number; width: number; height: number };
  displaySha256: string;
  displayMediaType: string;
  displayWidth: number;
  displayHeight: number;
  r2Key: string;
  capturedAt: string | null;
  bordbuchEventId: string;
}

export function isMissingEnvError(err: unknown): err is MissingEnvError {
  return err instanceof MissingEnvError;
}

const PBP_ENTITY_DIR_MAP: Record<string, string> = {
  "evidence-source": "trust/evidence",
  consent: "trust/consents",
  claim: "trust/claims",
};

export function resolvePbpEntityDir(cachePath: string, lang: string, entityType: string): string {
  const subDir = PBP_ENTITY_DIR_MAP[entityType] ?? entityType;
  return path.join(cachePath, "src", "content", "business-profile", lang, subDir);
}

export async function resolveNachweisCachePath(
  workspaceRoot: string,
  systemId: string,
): Promise<string> {
  // Workpiece-aware: during an active mission, read from the workpiece directory
  // so that agents can fix data issues and re-run validate without needing to
  // reconcile first (which itself requires validate to pass — circular dependency).
  const workpieceDir = await resolveActiveWorkpieceDir(workspaceRoot, systemId);
  if (workpieceDir) return workpieceDir;
  return resolveCacheClonePath(workspaceRoot, systemId);
}

export async function resolveDefaultLang(cachePath: string): Promise<string> {
  const contentDir = path.join(cachePath, "src", "content");
  const { manifest } = await loadSystemManifest(contentDir);
  const i18n = manifest.i18n as { default?: string } | undefined;
  if (!i18n?.default) {
    throw new Error(
      "[nachweis] system.md i18n.default is required to resolve PBP entity language.",
    );
  }
  return i18n.default;
}

export async function readEntitledFeaturesFromCache(cachePath: string): Promise<string[] | null> {
  const entitlementsPath = path.join(cachePath, "src", "entitlements.generated.yaml");
  if (!existsSync(entitlementsPath)) {
    return null;
  }
  try {
    const raw = await fs.readFile(entitlementsPath, "utf8");
    const parsed = yamlParse(raw) as { features?: unknown };
    return Array.isArray(parsed.features) ? parsed.features.map(String) : null;
  } catch {
    return null;
  }
}

export async function isNachweisEntitled(
  workspaceRoot: string,
  systemId: string,
): Promise<boolean> {
  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const features = await readEntitledFeaturesFromCache(cachePath);
  return features?.includes("nachweis") ?? false;
}

export function makeSkipResult(
  commandName: string,
  systemId: string,
): {
  data: Record<string, unknown>;
  exitCode: 0;
  summary: string;
} {
  return {
    data: { systemId, skipped: true, reason: "nachweis entitlement not resolved" },
    exitCode: 0,
    summary: `[${commandName}] skipped — nachweis entitlement not resolved for ${systemId}`,
  };
}

// RFC-0890: Raw screenshot ingestion result
export interface NachweisScreenshotIngestResult {
  slug: string;
  systemId: string;
  sha256: string;
  mediaType: string;
  originalFilename: string;
  width: number;
  height: number;
  capturedAt: string | null;
  r2Key: string;
  localPath: string;
  bordbuchEventId: string;
  alreadyIngested: boolean;
}

// RFC-0890: R2 path for raw screenshots — private storage, separate from display variant
export function resolveNachweisRawScreenshotR2Path(
  systemId: string,
  slug: string,
  originalFilename: string,
): string {
  return `${systemId}/screenshots/${slug}/raw/${originalFilename}`;
}

// RFC-0890: Local cache clone path for raw screenshots
export function resolveNachweisRawScreenshotLocalPath(
  cachePath: string,
  slug: string,
  originalFilename: string,
): string {
  return path.join(cachePath, "trust", "evidence", "screenshots", slug, "raw", originalFilename);
}

// RFC-0890: Parse CaptureX filename pattern to extract capturedAt
// Pattern: CaptureX_YYYY-MM-DD_HHMMSS_domain.ext
const CAPTUREX_REGEX =
  /^CaptureX_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})_(.+)\.([a-zA-Z0-9]+)$/;

export function parseCaptureXFilename(filename: string): { capturedAt: string } | null {
  const match = filename.match(CAPTUREX_REGEX);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return {
    capturedAt: `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
  };
}

// RFC-0890: Detect image metadata (mediaType, width, height) from file content via sharp
// Uses dynamic import to avoid static dependency on sharp in stack-agnostic werkstatt package
const SHARP_FORMAT_TO_MEDIA_TYPE: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  tiff: "image/tiff",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export async function detectImageMetadata(
  filePath: string,
): Promise<{ mediaType: string; width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const metadata = await sharp(filePath).metadata();
  const mediaType = SHARP_FORMAT_TO_MEDIA_TYPE[metadata.format ?? ""] ?? "application/octet-stream";
  if (!metadata.width || !metadata.height) {
    throw new Error(
      `[nachweis] could not read image dimensions from ${filePath} (format: ${metadata.format ?? "unknown"})`,
    );
  }
  return { mediaType, width: metadata.width, height: metadata.height };
}

// RFC-0873: Assessment bundle types and helpers

export interface AssessmentBundleArtifact {
  key: string;
  role: "raw-result" | "report" | "screenshot" | "summary" | "methodology";
  file: string;
  mediaType: string;
  canonical: boolean;
}

export interface AssessmentBundleV1 {
  schemaVersion: "nachweis-assessment-bundle@1";
  systemId: string;
  slug: string;
  title: Record<string, string>;
  seriesId: string;
  observationId: string;
  subject: { url: string; canonicalUrl?: string };
  provider: { id: string; name: string; homepage?: string };
  tool: { id: string; name: string; version?: string };
  execution: {
    mode: "operator-run" | "provider-run";
    authorizationBasis: "site-owner" | "service-contract" | "explicit-operator";
  };
  observedAt: string;
  methodology: {
    id: string;
    version: string;
    runCount: number;
    aggregation: "provider" | "median" | "none";
  };
  result: {
    overall?: { score?: number; level?: string };
    dimensions: Array<{
      id: string;
      providerLabel: string;
      score?: number;
      numerator?: number;
      denominator?: number;
      status?: "pass" | "fail" | "not-checked";
      level?: string;
      experimental?: boolean;
      min?: number;
      max?: number;
      samples?: number[];
    }>;
  };
  freshness: { maxAgeDays: number };
  providerReportUrl?: string;
  artifacts: AssessmentBundleArtifact[];
}

export interface AssessmentIngestResult {
  systemId: string;
  slug: string;
  seriesId: string;
  observationId: string;
  verificationLevel: "N1";
  artifactHashes: Record<string, string>;
  alreadyIngested: boolean;
  bordbuchEventId: string | null;
  dryRun: boolean;
}

const ISO_8601_WITH_TZ_BUNDLE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const assessmentDimensionSchema = z
  .object({
    id: z.string().min(1),
    providerLabel: z.string().min(1),
    score: z.number().finite().min(0).max(100).optional(),
    numerator: z.number().finite().min(0).optional(),
    denominator: z.number().finite().min(1).optional(),
    status: z.enum(["pass", "fail", "not-checked"]).optional(),
    level: z.string().optional(),
    experimental: z.boolean().optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    samples: z.array(z.number().finite().min(0).max(100)).optional(),
  })
  .refine(
    (d) => {
      if (d.numerator != null || d.denominator != null) {
        return d.numerator != null && d.denominator != null && d.numerator <= d.denominator;
      }
      return true;
    },
    { message: "numerator/denominator must appear as a valid pair" },
  )
  .refine(
    (d) => {
      if (d.samples != null && d.samples.length > 0) {
        const sMin = Math.min(...d.samples);
        const sMax = Math.max(...d.samples);
        if (d.min != null && d.min !== sMin) return false;
        if (d.max != null && d.max !== sMax) return false;
      }
      return true;
    },
    { message: "min/max must match sample extrema when samples are present" },
  );

export const assessmentBundleV1Schema = z
  .object({
    schemaVersion: z.literal("nachweis-assessment-bundle@1"),
    systemId: z.string().min(1),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_-]+$/, "slug must be path-safe"),
    title: z.record(z.string(), z.string()),
    seriesId: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_-]+$/, "seriesId must be path-safe"),
    observationId: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_-]+$/, "observationId must be path-safe"),
    subject: z.object({
      url: z.string().url(),
      canonicalUrl: z.string().url().optional(),
    }),
    provider: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      homepage: z.string().url().optional(),
    }),
    tool: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      version: z.string().optional(),
    }),
    execution: z.object({
      mode: z.enum(["operator-run", "provider-run"]),
      authorizationBasis: z.enum(["site-owner", "service-contract", "explicit-operator"]),
    }),
    observedAt: z
      .string()
      .regex(ISO_8601_WITH_TZ_BUNDLE, "observedAt must be ISO 8601 with timezone"),
    methodology: z.object({
      id: z.string().min(1),
      version: z.string().min(1),
      runCount: z.number().int().min(1),
      aggregation: z.enum(["provider", "median", "none"]),
    }),
    result: z.object({
      overall: z
        .object({
          score: z.number().finite().min(0).max(100).optional(),
          level: z.string().optional(),
        })
        .optional(),
      dimensions: z.array(assessmentDimensionSchema).min(1),
    }),
    freshness: z.object({
      maxAgeDays: z.number().int().min(1),
    }),
    providerReportUrl: z
      .string()
      .url()
      .refine((u) => u.startsWith("https:"), { message: "providerReportUrl must be HTTPS" })
      .optional(),
    artifacts: z
      .array(
        z.object({
          key: z
            .string()
            .min(1)
            .regex(/^[a-zA-Z0-9_.-]+$/, "artifact key must be path-safe"),
          role: z.enum(["raw-result", "report", "screenshot", "summary", "methodology"]),
          file: z.string().min(1),
          mediaType: z.string().min(1),
          canonical: z.boolean(),
        }),
      )
      .min(1),
  })
  .refine((b) => b.artifacts.some((a) => a.role === "raw-result" && a.canonical), {
    message: "at least one canonical raw-result artifact is required",
  });

const MEDIA_TYPE_TO_EXT: Record<string, string> = {
  "application/json": ".json",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "text/html": ".html",
  "text/plain": ".txt",
  "text/csv": ".csv",
};

export function mediaTypeToExt(mediaType: string): string {
  return MEDIA_TYPE_TO_EXT[mediaType] ?? ".bin";
}

export function resolveAssessmentR2Path(
  systemId: string,
  seriesId: string,
  observationId: string,
  artifactKey: string,
  ext: string,
): string {
  return `${systemId}/private/assessments/${seriesId}/${observationId}/${artifactKey}${ext}`;
}
