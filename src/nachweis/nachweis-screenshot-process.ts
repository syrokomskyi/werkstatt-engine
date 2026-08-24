/*
<MODULE_CONTRACT>
<purpose>RFC-0891: nachweis.screenshot.process command handler — transforms a raw full-page screenshot into a 16:9 display variant (1280x720, WebP) and uploads to R2 public.</purpose>
<keywords>nachweis, screenshot, process, crop, resize, webp, r2, display, sharp</keywords>
<responsibilities>
  <item>Reads websiteScreenshot.rawArtifact from the evidence-source entity.</item>
  <item>Resolves the raw file from cache clone local copy or R2 private storage (fallback).</item>
  <item>Computes a 16:9 crop region from the top of the raw image via sharp metadata.</item>
  <item>Crops, resizes to 1280x720, and converts to WebP via sharp pipeline.</item>
  <item>Uploads the display variant to R2 public at {systemId}/screenshots/{slug}/website-screenshot.webp.</item>
  <item>Updates EvidenceSource.websiteScreenshot with display variant metadata, preserving rawArtifact.</item>
  <item>Propagates capturedAt from rawArtifact.capturedAt to the display variant.</item>
  <item>Appends nachweis-record Bordbuch entry with processing metadata.</item>
  <item>Supports --dry-run to compute crop dimensions without uploading.</item>
  <item>Supports --crop-offset to adjust the vertical crop position.</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
</responsibilities>
<non-goals>
  <item>Does not ingest raw screenshots — use nachweis.screenshot.ingest (RFC-0890).</item>
  <item>Does not upload pre-processed files — use nachweis.screenshot.upload (RFC-0886).</item>
  <item>Does not validate screenshot content quality or visual correctness.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0891: initial nachweis.screenshot.process command handler.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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
import { writeFileIfChanged } from "@warpgogol/werkstatt-engine/kernel";
import {
  isNachweisEntitled,
  makeSkipResult,
  resolveNachweisCachePath,
  resolvePbpEntityDir,
  resolveDefaultLang,
  resolveNachweisScreenshotDisplayR2Path,
  resolveNachweisRawScreenshotLocalPath,
  uploadToR2,
  downloadFromR2,
  type NachweisScreenshotProcessResult,
} from "./nachweis-io.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

function flagNumber(input: KernelCommandInput, key: string): number | undefined {
  const v = input.flags[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export async function runNachweisScreenshotProcess(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisScreenshotProcessResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const slug = flagString(input, "slug");
  const dryRun = flagBool(input, "dry-run");
  const cropOffset = flagNumber(input, "crop-offset") ?? 0;

  if (!systemId) throw new Error("[nachweis.screenshot.process] --system is required");
  if (!slug) throw new Error("[nachweis.screenshot.process] --slug is required");

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.screenshot.process",
      systemId,
    ) as unknown as KernelCommandResult<NachweisScreenshotProcessResult>;
  }

  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const lang = await resolveDefaultLang(cachePath);
  const evidenceDir = resolvePbpEntityDir(cachePath, lang, "evidence-source");
  const evidenceFile = path.join(evidenceDir, `${slug}.md`);

  if (!existsSync(evidenceFile)) {
    throw new Error(
      `[nachweis.screenshot.process] NOT_FOUND: evidence-source '${slug}' not found at ${evidenceFile}`,
    );
  }

  const rawEvidence = await fs.readFile(evidenceFile, "utf8");
  const { data: evidenceData } = parseMarkdownFrontmatter(rawEvidence);
  const websiteScreenshot = evidenceData.websiteScreenshot as
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

  const rawArtifact = websiteScreenshot?.rawArtifact;
  if (!rawArtifact) {
    throw new Error(
      `[nachweis.screenshot.process] no rawArtifact found on websiteScreenshot for '${slug}'. Run nachweis.screenshot.ingest first.`,
    );
  }

  const originalFilename = rawArtifact.originalFilename;
  if (!originalFilename) {
    throw new Error(
      `[nachweis.screenshot.process] rawArtifact.originalFilename is missing for '${slug}'`,
    );
  }

  // Resolve raw file: check cache clone local copy first, fallback to R2 private
  const localRawPath = resolveNachweisRawScreenshotLocalPath(cachePath, slug, originalFilename);
  let rawFilePath: string;
  let rawBuffer: Uint8Array;

  if (existsSync(localRawPath)) {
    rawFilePath = localRawPath;
    rawBuffer = new Uint8Array(await fs.readFile(localRawPath));
  } else {
    // Fallback: download from R2 private
    const r2Key = rawArtifact.r2Key;
    if (!r2Key) {
      throw new Error(
        `[nachweis.screenshot.process] rawArtifact not found locally and no r2Key for fallback. Local path: ${localRawPath}`,
      );
    }
    logger.info(
      `[nachweis.screenshot.process] raw file not in cache clone, downloading from R2: ${r2Key}`,
    );
    rawBuffer = await downloadFromR2(r2Key);
    // Write to temp file for sharp to read
    rawFilePath = path.join(
      cachePath,
      "trust",
      "evidence",
      "screenshots",
      slug,
      "raw",
      originalFilename,
    );
    await fs.mkdir(path.dirname(rawFilePath), { recursive: true });
    await fs.writeFile(rawFilePath, rawBuffer);
  }

  // Compute SHA-256 of raw file
  const rawSha256 = createHash("sha256").update(rawBuffer).digest("hex");

  // Read raw image metadata via sharp
  const sharp = (await import("sharp")).default;
  const metadata = await sharp(rawFilePath).metadata();
  const rawWidth = metadata.width;
  const rawHeight = metadata.height;

  if (!rawWidth || !rawHeight) {
    throw new Error(
      `[nachweis.screenshot.process] could not read image dimensions from ${rawFilePath} (format: ${metadata.format ?? "unknown"})`,
    );
  }

  // Compute 16:9 crop region
  const cropHeight = Math.min(Math.round((rawWidth * 9) / 16), rawHeight);
  const cropWidth = cropHeight === rawHeight ? Math.round((rawHeight * 16) / 9) : rawWidth;
  const cropLeft = cropWidth < rawWidth ? Math.round((rawWidth - cropWidth) / 2) : 0;
  const cropTop = cropOffset;

  // Validate crop offset boundary
  if (cropTop + cropHeight > rawHeight) {
    const maxOffset = rawHeight - cropHeight;
    throw new Error(
      `[nachweis.screenshot.process] --crop-offset ${cropTop} places crop region beyond raw image boundary (cropOffset + cropHeight = ${cropTop + cropHeight} > rawHeight = ${rawHeight}). Maximum allowed offset: ${maxOffset}`,
    );
  }

  const r2Key = resolveNachweisScreenshotDisplayR2Path(systemId, slug);
  const capturedAt = rawArtifact.capturedAt ?? null;

  if (dryRun) {
    return {
      data: {
        slug,
        systemId,
        rawSha256,
        rawDimensions: { width: rawWidth, height: rawHeight },
        cropRegion: { left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight },
        displaySha256: "",
        displayMediaType: "image/webp",
        displayWidth: 1280,
        displayHeight: 720,
        r2Key,
        capturedAt,
        bordbuchEventId: "",
      },
      exitCode: 0,
      summary: `[nachweis.screenshot.process] ${systemId}: DRY RUN — would process screenshot for '${slug}' (crop: ${cropWidth}x${cropHeight} at offset ${cropTop})`,
    };
  }

  // Crop + resize + convert to WebP
  const displayBuffer = await sharp(rawFilePath)
    .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
    .resize(1280, 720, { fit: "cover" })
    .webp({ quality: 100 })
    .toBuffer();

  const displaySha256 = createHash("sha256").update(displayBuffer).digest("hex");

  // Upload to R2 public (backup/archive)
  await uploadToR2(new Uint8Array(displayBuffer), r2Key, "image/webp");

  // Copy to public/ for serving from the site
  const publicScreenshotDir = path.join(cachePath, "public", "nachweis-screenshots");
  const publicScreenshotPath = path.join(publicScreenshotDir, `${slug}.webp`);
  const publicUrl = `/nachweis-screenshots/${slug}.webp`;
  await fs.mkdir(publicScreenshotDir, { recursive: true });
  await writeFileIfChanged(publicScreenshotPath, Buffer.from(displayBuffer));

  // Update EvidenceSource.websiteScreenshot, preserving rawArtifact
  const { data: currentEvidence, content: evidenceContent } = parseMarkdownFrontmatter(
    await fs.readFile(evidenceFile, "utf8"),
  );
  const currentScreenshot = (currentEvidence.websiteScreenshot ?? {}) as Record<string, unknown>;
  currentEvidence.websiteScreenshot = {
    ...currentScreenshot,
    sha256: displaySha256,
    mediaType: "image/webp",
    storage: "public",
    url: publicUrl,
    r2Key,
    ...(capturedAt ? { capturedAt } : {}),
  };
  const updatedContent = stringifyMarkdownFrontmatter(evidenceContent, currentEvidence);
  await fs.writeFile(evidenceFile, updatedContent, "utf8");

  logger.info(
    `[nachweis.screenshot.process] processed display variant for '${slug}' to ${publicUrl}`,
  );

  // Append Bordbuch entry
  const operationId = generateOperationId();
  await acquireLock(
    workspaceRoot,
    `system:${systemId}`,
    operationId,
    "nachweis.screenshot.process",
    "agent",
  );
  await acquireLock(
    workspaceRoot,
    `bordbuch:${systemId}`,
    operationId,
    "nachweis.screenshot.process",
    "agent",
  );

  let bordbuchEventId: string;
  try {
    const { entry } = await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "nachweis-record",
      `Display screenshot processed for '${slug}'`,
      "agent",
      {
        writerRole: "nachweis",
        metadata: {
          slug,
          displaySha256,
          displayMediaType: "image/webp",
          displayWidth: 1280,
          displayHeight: 720,
          rawSha256,
          r2Key,
        },
      },
      `Bordbuch: nachweis-record ${systemId} ${slug} display-screenshot`,
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
      rawSha256,
      rawDimensions: { width: rawWidth, height: rawHeight },
      cropRegion: { left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight },
      displaySha256,
      displayMediaType: "image/webp",
      displayWidth: 1280,
      displayHeight: 720,
      r2Key,
      capturedAt,
      bordbuchEventId,
    },
    exitCode: 0,
    summary: `[nachweis.screenshot.process] ${systemId}: display variant for '${slug}' processed (bordbuch: ${bordbuchEventId})`,
    nextSteps: [
      {
        action: `Upload the public derivative: pnpm exec werkstatt run nachweis.public-derivative --site ${systemId} --slug ${slug}`,
        kind: "optional",
      },
    ],
  };
}
