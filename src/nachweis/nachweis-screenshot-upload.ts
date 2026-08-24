/*
<MODULE_CONTRACT>
<purpose>RFC-0886: nachweis.screenshot.upload command handler — uploads a website screenshot to R2 and updates EvidenceSource.websiteScreenshot.</purpose>
<keywords>nachweis, screenshot, upload, r2, evidence-source, website</keywords>
<responsibilities>
  <item>Reads a screenshot file from --file path, computes SHA-256, infers mediaType from extension.</item>
  <item>Uploads to R2 at {systemId}/screenshots/{slug}/website-screenshot.{ext}.</item>
  <item>Updates EvidenceSource.websiteScreenshot field with { sha256, mediaType, storage: "public", url }.</item>
  <item>Appends nachweis-record Bordbuch entry with metadata { slug, screenshotSha256, mediaType }.</item>
  <item>Acquires system and bordbuch locks before modifying state.</item>
  <item>Supports --dry-run to skip R2 upload and entity update.</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
</responsibilities>
<non-goals>
  <item>Does not validate screenshot content or dimensions — only uploads and records the hash.</item>
  <item>Does not generate screenshots — use external tooling or nachweis.measure.* commands.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0886: initial nachweis.screenshot.upload command handler.</item>
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
  resolveNachweisScreenshotR2Path,
  computeSourceSha256,
  uploadToR2,
  type NachweisScreenshotUploadResult,
} from "./nachweis-io.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

const EXT_TO_MEDIA_TYPE: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function runNachweisScreenshotUpload(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisScreenshotUploadResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const slug = flagString(input, "slug");
  const filePath = flagString(input, "file");
  const dryRun = flagBool(input, "dry-run");

  if (!systemId) throw new Error("[nachweis.screenshot.upload] --system is required");
  if (!slug) throw new Error("[nachweis.screenshot.upload] --slug is required");
  if (!filePath) throw new Error("[nachweis.screenshot.upload] --file is required");

  const ext = path.extname(filePath).toLowerCase();
  const mediaType = EXT_TO_MEDIA_TYPE[ext];
  if (!mediaType) {
    throw new Error(
      `[nachweis.screenshot.upload] unsupported file extension '${ext}'. Must be one of: .webp, .png, .jpg, .jpeg`,
    );
  }

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.screenshot.upload",
      systemId,
    ) as unknown as KernelCommandResult<NachweisScreenshotUploadResult>;
  }

  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const lang = await resolveDefaultLang(cachePath);
  const evidenceDir = resolvePbpEntityDir(cachePath, lang, "evidence-source");
  const evidenceFile = path.join(evidenceDir, `${slug}.md`);

  if (!existsSync(evidenceFile)) {
    throw new Error(
      `[nachweis.screenshot.upload] NOT_FOUND: evidence-source '${slug}' not found at ${evidenceFile}`,
    );
  }

  if (!existsSync(filePath)) {
    throw new Error(`[nachweis.screenshot.upload] NOT_FOUND: file '${filePath}' not found`);
  }

  const sha256 = await computeSourceSha256(filePath);
  const r2Key = resolveNachweisScreenshotR2Path(systemId, slug, ext);

  if (dryRun) {
    return {
      data: {
        slug,
        systemId,
        sha256,
        mediaType,
        storage: "public",
        r2Key,
        bordbuchEventId: "",
      },
      exitCode: 0,
      summary: `[nachweis.screenshot.upload] ${systemId}: DRY RUN — would upload screenshot for '${slug}' to ${r2Key}`,
    };
  }

  const fileBuffer = await fs.readFile(filePath);
  await uploadToR2(new Uint8Array(fileBuffer), r2Key, mediaType);

  const rawEvidence = await fs.readFile(evidenceFile, "utf8");
  const { data: evidenceData, content: evidenceContent } = parseMarkdownFrontmatter(rawEvidence);

  evidenceData.websiteScreenshot = {
    sha256,
    mediaType,
    storage: "public",
    url: r2Key,
  };

  const updatedContent = stringifyMarkdownFrontmatter(evidenceContent, evidenceData);
  await fs.writeFile(evidenceFile, updatedContent, "utf8");

  logger.info(`[nachweis.screenshot.upload] uploaded screenshot for '${slug}' to ${r2Key}`);

  const operationId = generateOperationId();
  await acquireLock(
    workspaceRoot,
    `system:${systemId}`,
    operationId,
    "nachweis.screenshot.upload",
    "agent",
  );
  await acquireLock(
    workspaceRoot,
    `bordbuch:${systemId}`,
    operationId,
    "nachweis.screenshot.upload",
    "agent",
  );

  let bordbuchEventId: string;
  try {
    const { entry } = await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "nachweis-record",
      `Screenshot uploaded for '${slug}'`,
      "agent",
      {
        writerRole: "nachweis",
        metadata: {
          slug,
          screenshotSha256: sha256,
          mediaType,
        },
      },
      `Bordbuch: nachweis-record ${systemId} ${slug} screenshot`,
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
      storage: "public",
      r2Key,
      bordbuchEventId,
    },
    exitCode: 0,
    summary: `[nachweis.screenshot.upload] ${systemId}: screenshot for '${slug}' uploaded (bordbuch: ${bordbuchEventId})`,
    nextSteps: [
      {
        action: `Process the screenshot: pnpm exec werkstatt run nachweis.screenshot.process --site ${systemId} --slug ${slug}`,
        kind: "optional",
      },
    ],
  };
}
