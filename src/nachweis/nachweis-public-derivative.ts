/*
<MODULE_CONTRACT>
<purpose>RFC-0714: nachweis.public-derivative command handler — uploads a public-derivative PDF to R2 and updates the evidence-source entity.</purpose>
<keywords>nachweis, public, derivative, r2, upload, evidence-source, gate</keywords>
<responsibilities>
  <item>Uploads a public-derivative PDF to R2 under a public/ path prefix.</item>
  <item>Updates evidence-source entity items.public to { sha256, storage: "public", mediaType: "application/pdf" }.</item>
  <item>Satisfies publication gate condition: publicDerivativeReady.</item>
  <item>Idempotent by SHA-256 — returns alreadyUploaded: true no-op when the same hash is already recorded.</item>
  <item>Acquires system and bordbuch locks before modifying state.</item>
  <item>Supports --dry-run to skip R2 upload and entity update.</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
</responsibilities>
<non-goals>
  <item>Does not redact private data — the operator is responsible for the public-derivative content.</item>
  <item>Does not validate the PDF content — only uploads and records the hash.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0714: initial nachweis.public-derivative command handler.</item>
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
  resolveNachweisPublicR2Path,
  computeSourceSha256,
  uploadToR2,
  type NachweisPublicDerivativeResult,
} from "./nachweis-io.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

export async function runNachweisPublicDerivative(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisPublicDerivativeResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const slug = flagString(input, "slug");
  const filePath = flagString(input, "file");
  const dryRun = flagBool(input, "dry-run");

  if (!systemId) throw new Error("[nachweis.public-derivative] --system is required");
  if (!slug) throw new Error("[nachweis.public-derivative] --slug is required");
  if (!filePath) throw new Error("[nachweis.public-derivative] --file is required");

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.public-derivative",
      systemId,
    ) as unknown as KernelCommandResult<NachweisPublicDerivativeResult>;
  }

  const cachePath = await resolveNachweisCachePath(workspaceRoot, systemId);
  const lang = await resolveDefaultLang(cachePath);
  const evidenceDir = resolvePbpEntityDir(cachePath, lang, "evidence-source");
  const evidenceFile = path.join(evidenceDir, `${slug}.md`);

  if (!existsSync(evidenceFile)) {
    throw new Error(
      `[nachweis.public-derivative] NOT_FOUND: evidence-source '${slug}' not found at ${evidenceFile}`,
    );
  }

  if (!existsSync(filePath)) {
    throw new Error(`[nachweis.public-derivative] NOT_FOUND: file '${filePath}' not found`);
  }

  const rawEvidence = await fs.readFile(evidenceFile, "utf8");
  const { data: evidenceData, content: evidenceContent } = parseMarkdownFrontmatter(rawEvidence);

  const recordId = (evidenceData.recordId as string | undefined) ?? `nr_${slug}`;
  const version = (evidenceData.version as number | undefined) ?? 1;

  const publicDerivativeSha256 = await computeSourceSha256(filePath);

  const items = (evidenceData.items as Record<string, Record<string, unknown>> | undefined) ?? {};
  const existingPublic = items.public as { sha256?: string } | undefined;

  if (existingPublic?.sha256 === publicDerivativeSha256) {
    logger.info(
      `[nachweis.public-derivative] already uploaded for '${slug}' — same SHA-256, skipping`,
    );
    return {
      data: {
        slug,
        systemId,
        r2Path: resolveNachweisPublicR2Path(systemId, recordId, version),
        publicDerivativeSha256,
        bordbuchEventId: null,
        alreadyUploaded: true,
      },
      exitCode: 0,
      summary: `[nachweis.public-derivative] ${systemId}: already uploaded for '${slug}' (sha256: ${publicDerivativeSha256.slice(0, 16)}...)`,
    };
  }

  const r2Path = resolveNachweisPublicR2Path(systemId, recordId, version);

  if (dryRun) {
    return {
      data: {
        slug,
        systemId,
        r2Path,
        publicDerivativeSha256,
        bordbuchEventId: null,
        alreadyUploaded: false,
      },
      exitCode: 0,
      summary: `[nachweis.public-derivative] ${systemId}: DRY RUN — would upload public derivative for '${slug}' to ${r2Path}`,
    };
  }

  const fileBuffer = await fs.readFile(filePath);
  await uploadToR2(new Uint8Array(fileBuffer), r2Path);

  items.public = {
    sha256: publicDerivativeSha256,
    storage: "public",
    mediaType: "application/pdf",
  };
  evidenceData.items = items;

  const updatedContent = stringifyMarkdownFrontmatter(evidenceContent, evidenceData);
  await fs.writeFile(evidenceFile, updatedContent, "utf8");

  const operationId = generateOperationId();
  await acquireLock(
    workspaceRoot,
    `system:${systemId}`,
    operationId,
    "nachweis.public-derivative",
    "agent",
  );
  await acquireLock(
    workspaceRoot,
    `bordbuch:${systemId}`,
    operationId,
    "nachweis.public-derivative",
    "agent",
  );

  let bordbuchEventId: string;
  try {
    const { entry } = await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "nachweis-record",
      `Public derivative created for '${slug}'`,
      "agent",
      {
        writerRole: "nachweis",
        metadata: {
          slug,
          publicDerivativeSha256,
          r2Path,
        },
      },
      `Bordbuch: nachweis-record ${systemId} ${slug}`,
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
      r2Path,
      publicDerivativeSha256,
      bordbuchEventId,
      alreadyUploaded: false,
    },
    exitCode: 0,
    summary: `[nachweis.public-derivative] ${systemId}: public derivative for '${slug}' uploaded (bordbuch: ${bordbuchEventId})`,
    nextSteps: [
      {
        action: `Validate the nachweis: pnpm exec werkstatt run nachweis.validate --site ${systemId}`,
        kind: "optional",
      },
    ],
  };
}
