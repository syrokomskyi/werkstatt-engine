/*
<MODULE_CONTRACT>
<purpose>RFC-0873: nachweis.assessment.ingest command handler — validates an AssessmentBundleV1, hashes artifacts, uploads to R2, writes PBP evidence-source, appends Bordbuch entry. Implements ADR-0054: generic normalized assessment contract between provider adapters and PBP/Bordbuch.</purpose>
<keywords>nachweis, assessment, ingest, r2, bordbuch, evidence-source, technical-assessment</keywords>
<responsibilities>
  <item>Validates bundle via assessmentBundleV1Schema (Zod runtime validation).</item>
  <item>Validates path safety: slug, seriesId, observationId, artifact keys reject path traversal and symlinks.</item>
  <item>Validates at least one canonical raw-result artifact (enforced by Zod schema refine).</item>
  <item>Validates all artifact files exist and are inside the bundle directory.</item>
  <item>Hashes all artifacts via computeSourceSha256.</item>
  <item>Idempotent by (seriesId, observationId) + artifact hashes — returns alreadyIngested: true on match.</item>
  <item>Conflicts on same (seriesId, observationId) with different hashes — fails with ASSESSMENT_OBSERVATION_CONFLICT.</item>
  <item>New observation in existing series preserves old artifacts (immutable observation history).</item>
  <item>Uploads missing artifacts to R2 under {systemId}/private/assessments/{seriesId}/{observationId}/{key}.{ext}.</item>
  <item>Writes/updates PBP evidence-source entity with kind=technical-assessment and assessment metadata.</item>
  <item>Appends nachweis-record Bordbuch entry with verificationLevel N1.</item>
  <item>Scans bundle JSON for known credential patterns — fails if detected.</item>
  <item>Supports --dry-run (no R2 upload, no PBP write, no Bordbuch append).</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
</responsibilities>
<non-goals>
  <item>Does not publish or approve — use nachweis.publish and nachweis.approve for gate progression.</item>
  <item>Does not create public derivatives — use nachweis.public-derivative.</item>
  <item>Does not delete or overwrite existing observations — observation history is immutable.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0873: initial nachweis.assessment.ingest command handler.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  parseMarkdownFrontmatter,
  stringifyMarkdownFrontmatter,
} from "@warpgogol/werkstatt-shared/content";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";
import {
  assessmentBundleV1Schema,
  computeSourceSha256,
  isMissingEnvError,
  isNachweisEntitled,
  makeSkipResult,
  mediaTypeToExt,
  resolveAssessmentR2Path,
  resolveDefaultLang,
  resolveNachweisCachePath,
  resolvePbpEntityDir,
  uploadToR2,
  type AssessmentBundleV1,
  type AssessmentIngestResult,
} from "./nachweis-io.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

const CREDENTIAL_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9]{20,}["']?/i,
  /(?:aws_secret_access_key|private_key|client_secret)\s*[:=]\s*["']?[^\s"']{8,}["']?/i,
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
  /eyJ[A-Za-z0-9_-]{10,}\.\.[A-Za-z0-9_-]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
];

function scanForCredentials(json: string): boolean {
  return CREDENTIAL_PATTERNS.some((p) => p.test(json));
}

function isPathSafe(segment: string): boolean {
  if (segment.includes("..") || segment.includes("/") || segment.includes("\\")) {
    return false;
  }
  return true;
}

function isPathInsideDir(filePath: string, dirPath: string): boolean {
  const resolved = path.resolve(filePath);
  const dir = path.resolve(dirPath);
  const relative = path.relative(dir, resolved);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function makeErrorResult(
  systemId: string,
  bundle: { slug: string; seriesId: string; observationId: string } | null,
  dryRun: boolean,
  summary: string,
): KernelCommandResult<AssessmentIngestResult> {
  return {
    data: {
      systemId,
      slug: bundle?.slug ?? "",
      seriesId: bundle?.seriesId ?? "",
      observationId: bundle?.observationId ?? "",
      verificationLevel: "N1",
      artifactHashes: {},
      alreadyIngested: false,
      bordbuchEventId: null,
      dryRun,
    },
    exitCode: 1,
    summary,
  };
}

export async function runNachweisAssessmentIngest(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<AssessmentIngestResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const bundlePath = flagString(input, "bundle");
  const dryRun = flagBool(input, "dry-run");

  if (!systemId) throw new Error("[nachweis.assessment.ingest] --system is required");
  if (!bundlePath) throw new Error("[nachweis.assessment.ingest] --bundle is required");

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.assessment.ingest",
      systemId,
    ) as unknown as KernelCommandResult<AssessmentIngestResult>;
  }

  if (!existsSync(bundlePath)) {
    throw new Error(
      `[nachweis.assessment.ingest] NOT_FOUND: bundle '${bundlePath}' does not exist`,
    );
  }

  const rawBundleJson = await fs.readFile(bundlePath, "utf8");

  if (scanForCredentials(rawBundleJson)) {
    return makeErrorResult(
      systemId,
      null,
      dryRun,
      `[nachweis.assessment.ingest] CREDENTIAL_DETECTED: bundle '${bundlePath}' contains credential-like patterns`,
    );
  }

  const parsed = assessmentBundleV1Schema.safeParse(JSON.parse(rawBundleJson));
  if (!parsed.success) {
    return makeErrorResult(
      systemId,
      null,
      dryRun,
      `[nachweis.assessment.ingest] ASSESSMENT_BUNDLE_INVALID: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }

  const bundle: AssessmentBundleV1 = parsed.data;

  if (bundle.systemId !== systemId) {
    return makeErrorResult(
      systemId,
      bundle,
      dryRun,
      `[nachweis.assessment.ingest] ASSESSMENT_SYSTEM_MISMATCH: bundle systemId '${bundle.systemId}' != --system '${systemId}'`,
    );
  }

  for (const seg of [bundle.slug, bundle.seriesId, bundle.observationId]) {
    if (!isPathSafe(seg)) {
      return makeErrorResult(
        systemId,
        bundle,
        dryRun,
        `[nachweis.assessment.ingest] ASSESSMENT_PATH_UNSAFE: segment '${seg}' contains path traversal characters`,
      );
    }
  }

  for (const artifact of bundle.artifacts) {
    if (!isPathSafe(artifact.key)) {
      return makeErrorResult(
        systemId,
        bundle,
        dryRun,
        `[nachweis.assessment.ingest] ASSESSMENT_PATH_UNSAFE: artifact key '${artifact.key}' contains path traversal characters`,
      );
    }
  }

  const bundleDir = path.dirname(path.resolve(bundlePath));

  for (const artifact of bundle.artifacts) {
    const artifactPath = path.resolve(bundleDir, artifact.file);
    if (!isPathInsideDir(artifactPath, bundleDir)) {
      return makeErrorResult(
        systemId,
        bundle,
        dryRun,
        `[nachweis.assessment.ingest] ASSESSMENT_ARTIFACT_PATH_ESCAPE: artifact '${artifact.key}' path '${artifact.file}' escapes bundle directory`,
      );
    }
    if (!existsSync(artifactPath)) {
      return makeErrorResult(
        systemId,
        bundle,
        dryRun,
        `[nachweis.assessment.ingest] ASSESSMENT_ARTIFACT_MISSING: artifact '${artifact.key}' file '${artifact.file}' not found`,
      );
    }
    try {
      const stat = lstatSync(artifactPath);
      if (stat.isSymbolicLink()) {
        return makeErrorResult(
          systemId,
          bundle,
          dryRun,
          `[nachweis.assessment.ingest] ASSESSMENT_ARTIFACT_PATH_ESCAPE: artifact '${artifact.key}' is a symlink — symlinks are not allowed`,
        );
      }
    } catch {
      return makeErrorResult(
        systemId,
        bundle,
        dryRun,
        `[nachweis.assessment.ingest] ASSESSMENT_ARTIFACT_MISSING: artifact '${artifact.key}' file could not be stat'd`,
      );
    }
  }

  const hasCanonicalRaw = bundle.artifacts.some((a) => a.role === "raw-result" && a.canonical);
  if (!hasCanonicalRaw) {
    return makeErrorResult(
      systemId,
      bundle,
      dryRun,
      `[nachweis.assessment.ingest] ASSESSMENT_CANONICAL_RAW_REQUIRED: at least one canonical raw-result artifact is required`,
    );
  }

  const artifactHashes: Record<string, string> = {};
  for (const artifact of bundle.artifacts) {
    const artifactPath = path.join(bundleDir, artifact.file);
    artifactHashes[artifact.key] = await computeSourceSha256(artifactPath);
  }

  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const lang = await resolveDefaultLang(cachePath);
  const evidenceDir = resolvePbpEntityDir(cachePath, lang, "evidence-source");
  const evidenceFile = path.join(evidenceDir, `${bundle.slug}.md`);

  const existingEvidence = existsSync(evidenceFile);
  let existingData: Record<string, unknown> | undefined;
  let existingContent = "";
  if (existingEvidence) {
    const raw = await fs.readFile(evidenceFile, "utf8");
    const parsed2 = parseMarkdownFrontmatter(raw);
    existingData = parsed2.data;
    existingContent = parsed2.content;
  }

  const existingItems =
    (existingData?.items as Record<string, Record<string, unknown>> | undefined) ?? {};
  const existingAssessment = existingData?.assessment as
    { seriesId?: string; observationId?: string } | undefined;

  if (
    existingAssessment &&
    existingAssessment.seriesId === bundle.seriesId &&
    existingAssessment.observationId === bundle.observationId
  ) {
    const existingHashes: Record<string, string> = {};
    for (const artifact of bundle.artifacts) {
      const item = existingItems[artifact.key] as { sha256?: string } | undefined;
      if (item?.sha256) {
        existingHashes[artifact.key] = item.sha256;
      }
    }
    const allMatch = bundle.artifacts.every((a) => existingHashes[a.key] === artifactHashes[a.key]);
    if (allMatch) {
      logger.info(
        `[nachweis.assessment.ingest] already ingested for '${bundle.slug}' (${bundle.seriesId}/${bundle.observationId}) — skipping`,
      );
      return {
        data: {
          systemId,
          slug: bundle.slug,
          seriesId: bundle.seriesId,
          observationId: bundle.observationId,
          verificationLevel: "N1",
          artifactHashes,
          alreadyIngested: true,
          bordbuchEventId: null,
          dryRun,
        },
        exitCode: 0,
        summary: `[nachweis.assessment.ingest] ${systemId}: already ingested '${bundle.slug}' (${bundle.seriesId}/${bundle.observationId})`,
      };
    }

    return {
      data: {
        systemId,
        slug: bundle.slug,
        seriesId: bundle.seriesId,
        observationId: bundle.observationId,
        verificationLevel: "N1",
        artifactHashes,
        alreadyIngested: false,
        bordbuchEventId: null,
        dryRun,
      },
      exitCode: 1,
      summary: `[nachweis.assessment.ingest] ASSESSMENT_OBSERVATION_CONFLICT: observation (${bundle.seriesId}/${bundle.observationId}) already exists with different artifact hashes for '${bundle.slug}'`,
    };
  }

  if (dryRun) {
    return {
      data: {
        systemId,
        slug: bundle.slug,
        seriesId: bundle.seriesId,
        observationId: bundle.observationId,
        verificationLevel: "N1",
        artifactHashes,
        alreadyIngested: false,
        bordbuchEventId: null,
        dryRun: true,
      },
      exitCode: 0,
      summary: `[nachweis.assessment.ingest] ${systemId}: DRY RUN — would ingest '${bundle.slug}' (${bundle.seriesId}/${bundle.observationId}) with ${bundle.artifacts.length} artifacts`,
    };
  }

  for (const artifact of bundle.artifacts) {
    const artifactPath = path.join(bundleDir, artifact.file);
    const ext = mediaTypeToExt(artifact.mediaType);
    const r2Path = resolveAssessmentR2Path(
      systemId,
      bundle.seriesId,
      bundle.observationId,
      artifact.key,
      ext,
    );
    const fileBuffer = await fs.readFile(artifactPath);
    try {
      await uploadToR2(new Uint8Array(fileBuffer), r2Path, artifact.mediaType);
    } catch (err) {
      if (isMissingEnvError(err)) {
        return {
          data: {
            systemId,
            slug: bundle.slug,
            seriesId: bundle.seriesId,
            observationId: bundle.observationId,
            verificationLevel: "N1",
            artifactHashes,
            alreadyIngested: false,
            bordbuchEventId: null,
            dryRun: false,
          },
          exitCode: 1,
          summary: `[nachweis.assessment.ingest] MISSING_ENV: ${err.message}`,
        };
      }
      return {
        data: {
          systemId,
          slug: bundle.slug,
          seriesId: bundle.seriesId,
          observationId: bundle.observationId,
          verificationLevel: "N1",
          artifactHashes,
          alreadyIngested: false,
          bordbuchEventId: null,
          dryRun: false,
        },
        exitCode: 1,
        summary: `[nachweis.assessment.ingest] R2_UPLOAD_ERROR: failed to upload artifact '${artifact.key}': ${err}`,
      };
    }
  }

  logger.info(`[nachweis.assessment.ingest] uploaded ${bundle.artifacts.length} artifacts to R2`);

  const items: Record<string, Record<string, unknown>> = existingItems;
  for (const artifact of bundle.artifacts) {
    const ext = mediaTypeToExt(artifact.mediaType);
    const r2Path = resolveAssessmentR2Path(
      systemId,
      bundle.seriesId,
      bundle.observationId,
      artifact.key,
      ext,
    );
    items[artifact.key] = {
      sha256: artifactHashes[artifact.key],
      storage: "private",
      mediaType: artifact.mediaType,
      qualityStatus: "verified",
      role: artifact.role,
      canonical: artifact.canonical,
      r2Path,
    };
  }

  const evidenceData: Record<string, unknown> = existingData ?? {};
  evidenceData.kind = "technical-assessment";
  evidenceData.slug = bundle.slug;
  evidenceData.recordId = `nr_${bundle.slug}`;
  evidenceData.version = 1;
  evidenceData.items = items;
  evidenceData.assessment = {
    profile: "technical-assessment",
    seriesId: bundle.seriesId,
    observationId: bundle.observationId,
    observedAt: bundle.observedAt,
    methodology: bundle.methodology,
    freshness: bundle.freshness,
    dimensions: bundle.result.dimensions,
    authorizationBasis: bundle.execution.authorizationBasis,
    ...(bundle.providerReportUrl ? { providerReportUrl: bundle.providerReportUrl } : {}),
  };

  await fs.mkdir(evidenceDir, { recursive: true });
  const updatedContent = stringifyMarkdownFrontmatter(existingContent, evidenceData);
  await fs.writeFile(evidenceFile, updatedContent, "utf8");

  const operationId = generateOperationId();
  await acquireLock(
    workspaceRoot,
    `system:${systemId}`,
    operationId,
    "nachweis.assessment.ingest",
    "agent",
  );
  await acquireLock(
    workspaceRoot,
    `bordbuch:${systemId}`,
    operationId,
    "nachweis.assessment.ingest",
    "agent",
  );

  let bordbuchEventId: string | null = null;
  try {
    const { entry } = await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "nachweis-record",
      `Assessment ingested for '${bundle.slug}' (${bundle.seriesId})`,
      "agent",
      {
        writerRole: "nachweis",
        metadata: {
          action: "assessment-ingested",
          slug: bundle.slug,
          seriesId: bundle.seriesId,
          observationId: bundle.observationId,
          providerId: bundle.provider.id,
          toolId: bundle.tool.id,
          observedAt: bundle.observedAt,
          artifactHashes,
          verificationLevel: "N1",
        },
      },
      `Bordbuch: nachweis-record ${systemId} ${bundle.slug} assessment`,
    );
    bordbuchEventId = entry.id;
  } catch (err) {
    logger.warn(
      `[nachweis.assessment.ingest] Bordbuch append failed — R2 objects need manual cleanup: ${err}`,
    );
    return {
      data: {
        systemId,
        slug: bundle.slug,
        seriesId: bundle.seriesId,
        observationId: bundle.observationId,
        verificationLevel: "N1",
        artifactHashes,
        alreadyIngested: false,
        bordbuchEventId: null,
        dryRun: false,
      },
      exitCode: 1,
      summary: `[nachweis.assessment.ingest] BORDBUCH_ERROR: R2 upload succeeded but Bordbuch append failed — manual cleanup needed`,
    };
  } finally {
    await releaseLock(workspaceRoot, `bordbuch:${systemId}`);
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }

  return {
    data: {
      systemId,
      slug: bundle.slug,
      seriesId: bundle.seriesId,
      observationId: bundle.observationId,
      verificationLevel: "N1",
      artifactHashes,
      alreadyIngested: false,
      bordbuchEventId,
      dryRun: false,
    },
    exitCode: 0,
    summary: `[nachweis.assessment.ingest] ${systemId}: ingested '${bundle.slug}' (${bundle.seriesId}/${bundle.observationId}, ${bundle.artifacts.length} artifacts, bordbuch: ${bordbuchEventId})`,
    nextSteps: [
      {
        action: `Validate the nachweis: pnpm exec werkstatt run nachweis.validate --site ${systemId}`,
        kind: "optional",
      },
    ],
  };
}
