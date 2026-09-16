/*
<MODULE_CONTRACT>
<purpose>RFC-0714: nachweis.public-derivative command handler — uploads a public-derivative PDF to R2 and updates the evidence-source entity.</purpose>


<non-goals>
  <item>Does not redact private data — the operator is responsible for the public-derivative content.</item>
  <item>Does not validate the PDF content — only uploads and records the hash.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0714: initial nachweis.public-derivative command handler.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
