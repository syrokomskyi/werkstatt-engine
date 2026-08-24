/*
<MODULE_CONTRACT>
<purpose>RFC-0890: nachweis.screenshot.ingest command handler — ingests a raw full-page screenshot to R2 private storage and cache clone local directory.</purpose>
<keywords>nachweis, screenshot, ingest, raw, r2, evidence-source, sharp</keywords>
<responsibilities>
  <item>Reads a raw screenshot file from --file path, computes SHA-256.</item>
  <item>Detects image metadata (mediaType, width, height) via dynamic import("sharp").</item>
  <item>Parses capturedAt from CaptureX filename pattern; --captured-at flag overrides.</item>
  <item>Uploads to R2 private at {systemId}/screenshots/{slug}/raw/{originalFilename}.</item>
  <item>Copies file to cache clone at trust/evidence/screenshots/{slug}/raw/{originalFilename}.</item>
  <item>Updates EvidenceSource.websiteScreenshot.rawArtifact with metadata.</item>
  <item>Appends nachweis-record Bordbuch entry with raw artifact metadata.</item>
  <item>Idempotent by SHA-256: re-ingest of same hash skips upload and Bordbuch.</item>
  <item>Supports --dry-run to compute metadata without copying or uploading.</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
</responsibilities>
<non-goals>
  <item>Does not crop, resize, or convert the raw screenshot — that belongs to RFC-0891.</item>
  <item>Does not upload a public display variant — use nachweis.screenshot.upload for that.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0890: initial nachweis.screenshot.ingest command handler.</item>
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
  resolveNachweisRawScreenshotR2Path,
  resolveNachweisRawScreenshotLocalPath,
  computeSourceSha256,
  uploadToR2,
  detectImageMetadata,
  parseCaptureXFilename,
  type NachweisScreenshotIngestResult,
} from "./nachweis-io.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

export async function runNachweisScreenshotIngest(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisScreenshotIngestResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const slug = flagString(input, "slug");
  const filePath = flagString(input, "file");
  const dryRun = flagBool(input, "dry-run");
  const capturedAtOverride = flagString(input, "captured-at");

  if (!systemId) throw new Error("[nachweis.screenshot.ingest] --system is required");
  if (!slug) throw new Error("[nachweis.screenshot.ingest] --slug is required");
  if (!filePath) throw new Error("[nachweis.screenshot.ingest] --file is required");

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.screenshot.ingest",
      systemId,
    ) as unknown as KernelCommandResult<NachweisScreenshotIngestResult>;
  }

  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const lang = await resolveDefaultLang(cachePath);
  const evidenceDir = resolvePbpEntityDir(cachePath, lang, "evidence-source");
  const evidenceFile = path.join(evidenceDir, `${slug}.md`);

  if (!existsSync(evidenceFile)) {
    throw new Error(
      `[nachweis.screenshot.ingest] NOT_FOUND: evidence-source '${slug}' not found at ${evidenceFile}`,
    );
  }

  if (!existsSync(filePath)) {
    throw new Error(`[nachweis.screenshot.ingest] NOT_FOUND: file '${filePath}' not found`);
  }

  const originalFilename = path.basename(filePath);
  const sha256 = await computeSourceSha256(filePath);

  const rawEvidence = await fs.readFile(evidenceFile, "utf8");
  const { data: evidenceData } = parseMarkdownFrontmatter(rawEvidence);
  const existingScreenshot = evidenceData.websiteScreenshot as
    | {
        rawArtifact?: {
          sha256?: string;
          mediaType?: string;
          originalFilename?: string;
          width?: number;
          height?: number;
          r2Key?: string;
          localPath?: string;
          capturedAt?: string;
        };
      }
    | undefined;
  const existingRawSha = existingScreenshot?.rawArtifact?.sha256;

  if (existingRawSha === sha256) {
    logger.info(
      `[nachweis.screenshot.ingest] '${slug}' already ingested with same SHA-256 — skipping`,
    );
    const existingRaw = existingScreenshot!.rawArtifact!;
    return {
      data: {
        slug,
        systemId,
        sha256,
        mediaType: existingRaw.mediaType as string,
        originalFilename: existingRaw.originalFilename as string,
        width: existingRaw.width as number,
        height: existingRaw.height as number,
        capturedAt: (existingRaw.capturedAt as string | undefined) ?? null,
        r2Key: (existingRaw.r2Key as string | undefined) ?? "",
        localPath: (existingRaw.localPath as string | undefined) ?? "",
        bordbuchEventId: "",
        alreadyIngested: true,
      },
      exitCode: 0,
      summary: `[nachweis.screenshot.ingest] ${systemId}: '${slug}' already ingested (SHA-256 match, skipped)`,
    };
  }

  const { mediaType, width, height } = await detectImageMetadata(filePath);

  let capturedAt: string | null = null;
  if (capturedAtOverride) {
    capturedAt = capturedAtOverride;
  } else {
    const parsed = parseCaptureXFilename(originalFilename);
    if (parsed) capturedAt = parsed.capturedAt;
  }

  const r2Key = resolveNachweisRawScreenshotR2Path(systemId, slug, originalFilename);
  const localPath = resolveNachweisRawScreenshotLocalPath(cachePath, slug, originalFilename);

  if (dryRun) {
    return {
      data: {
        slug,
        systemId,
        sha256,
        mediaType,
        originalFilename,
        width,
        height,
        capturedAt,
        r2Key,
        localPath,
        bordbuchEventId: "",
        alreadyIngested: false,
      },
      exitCode: 0,
      summary: `[nachweis.screenshot.ingest] ${systemId}: DRY RUN — would ingest raw screenshot for '${slug}' to ${r2Key}`,
    };
  }

  const fileBuffer = await fs.readFile(filePath);
  await uploadToR2(new Uint8Array(fileBuffer), r2Key, mediaType);

  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.copyFile(filePath, localPath);

  const { data: currentEvidence, content: evidenceContent } = parseMarkdownFrontmatter(
    await fs.readFile(evidenceFile, "utf8"),
  );
  const currentScreenshot = (currentEvidence.websiteScreenshot ?? {}) as Record<string, unknown>;
  currentEvidence.websiteScreenshot = {
    ...currentScreenshot,
    rawArtifact: {
      sha256,
      mediaType,
      originalFilename,
      width,
      height,
      r2Key,
      localPath,
      ...(capturedAt ? { capturedAt } : {}),
    },
  };
  const updatedContent = stringifyMarkdownFrontmatter(evidenceContent, currentEvidence);
  await fs.writeFile(evidenceFile, updatedContent, "utf8");

  logger.info(`[nachweis.screenshot.ingest] ingested raw screenshot for '${slug}' to ${r2Key}`);

  const operationId = generateOperationId();
  await acquireLock(
    workspaceRoot,
    `system:${systemId}`,
    operationId,
    "nachweis.screenshot.ingest",
    "agent",
  );
  await acquireLock(
    workspaceRoot,
    `bordbuch:${systemId}`,
    operationId,
    "nachweis.screenshot.ingest",
    "agent",
  );

  let bordbuchEventId: string;
  try {
    const { entry } = await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "nachweis-record",
      `Raw screenshot ingested for '${slug}'`,
      "agent",
      {
        writerRole: "nachweis",
        metadata: {
          slug,
          rawScreenshotSha256: sha256,
          mediaType,
          originalFilename,
          width,
          height,
        },
      },
      `Bordbuch: nachweis-record ${systemId} ${slug} raw-screenshot`,
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
      sha256,
      mediaType,
      originalFilename,
      width,
      height,
      capturedAt,
      r2Key,
      localPath,
      bordbuchEventId,
      alreadyIngested: false,
    },
    exitCode: 0,
    summary: `[nachweis.screenshot.ingest] ${systemId}: raw screenshot for '${slug}' ingested (bordbuch: ${bordbuchEventId})`,
    nextSteps: [
      {
        action: `Upload the screenshot: pnpm exec werkstatt run nachweis.screenshot.upload --site ${systemId} --slug ${slug}`,
        kind: "optional",
      },
    ],
  };
}
