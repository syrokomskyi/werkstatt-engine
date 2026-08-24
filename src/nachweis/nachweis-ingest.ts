/*
<MODULE_CONTRACT>
<purpose>RFC-0707: nachweis.ingest command handler — hashes a PDF, uploads to R2, appends Bordbuch entry.</purpose>
<keywords>nachweis, ingest, r2, bordbuch, sha256, evidence</keywords>
<responsibilities>
  <item>Validates input file exists and is a PDF.</item>
  <item>Computes SHA-256 via @warpgogol/fingerprint byteHashFile.</item>
  <item>Uploads to R2 bucket nachweise under {systemId}/private/{recordId}/v{version}/source.pdf.</item>
  <item>Appends nachweis-record Bordbuch entry with writer-role nachweis.</item>
  <item>Supports --dry-run (no R2 upload, no Bordbuch append).</item>
  <item>Skips silently when nachweis entitlement is not resolved.</item>
</responsibilities>
<non-goals>
  <item>Does not create PBP entities — that is a manual content authoring step.</item>
  <item>Does not implement R2 download or cleanup.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0707: initial nachweis.ingest command handler.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";
import {
  computeSourceSha256,
  generateRecordId,
  resolveNachweisR2Path,
  uploadToR2,
  isMissingEnvError,
  isNachweisEntitled,
  makeSkipResult,
  type NachweisIngestResult,
} from "./nachweis-io.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

export async function runNachweisIngest(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<NachweisIngestResult>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  const filePath = flagString(input, "file");
  const recordType = flagString(input, "record-type");
  const slug = flagString(input, "slug");
  const titleDe = flagString(input, "title-de");
  const titleUk = flagString(input, "title-uk");
  const titleEn = flagString(input, "title-en");
  const qualityStatus = flagString(input, "quality-status") ?? "unverified";
  const dryRun = flagBool(input, "dry-run");

  if (!systemId) throw new Error("[nachweis.ingest] --system is required");
  if (!filePath) throw new Error("[nachweis.ingest] --file is required");
  if (!recordType) throw new Error("[nachweis.ingest] --record-type is required");
  if (!slug) throw new Error("[nachweis.ingest] --slug is required");
  if (!titleDe) throw new Error("[nachweis.ingest] --title-de is required");
  if (!titleUk) throw new Error("[nachweis.ingest] --title-uk is required");

  const entitled = await isNachweisEntitled(workspaceRoot, systemId);
  if (!entitled) {
    return makeSkipResult(
      "nachweis.ingest",
      systemId,
    ) as unknown as KernelCommandResult<NachweisIngestResult>;
  }

  if (!existsSync(filePath)) {
    throw new Error(`[nachweis.ingest] NOT_FOUND: file '${filePath}' does not exist`);
  }
  if (!filePath.toLowerCase().endsWith(".pdf")) {
    throw new Error(`[nachweis.ingest] INVALID_FILE: file must be a PDF, got '${filePath}'`);
  }

  const sourceSha256 = await computeSourceSha256(filePath);
  const recordId = generateRecordId(slug);
  const version = 1;
  const r2Path = resolveNachweisR2Path(systemId, recordId, version);

  if (dryRun) {
    logger.info(`[nachweis.ingest] dry-run — would upload ${filePath} to ${r2Path}`);
    return {
      data: {
        recordId,
        systemId,
        sourceSha256,
        r2Path,
        version,
        dryRun: true,
        bordbuchEventId: null,
      },
      exitCode: 0,
      summary: `[nachweis.ingest] ${systemId}: dry-run — record ${recordId} would be ingested (sha256: ${sourceSha256.slice(0, 20)}...)`,
      nextSteps: [
        {
          action: `Ingest for real: pnpm exec werkstatt run nachweis.ingest --site ${systemId} --slug ${slug}`,
          kind: "optional",
        },
      ],
    };
  }

  const fileBuffer = await fs.readFile(filePath);
  const uploadBuffer = new Uint8Array(fileBuffer);

  // ADR-0025: heartbeat for potentially long R2 upload
  const startTime = Date.now();
  const heartbeat = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    logger.info(`[nachweis.ingest] uploading to R2 — ${elapsed}s elapsed`);
  }, 30_000);

  try {
    try {
      await uploadToR2(uploadBuffer, r2Path);
    } catch (err) {
      if (isMissingEnvError(err)) {
        return {
          data: {
            recordId,
            systemId,
            sourceSha256,
            r2Path,
            version,
            dryRun: false,
            bordbuchEventId: null,
          },
          exitCode: 1,
          summary: `[nachweis.ingest] MISSING_ENV: ${err.message}`,
        };
      }
      return {
        data: {
          recordId,
          systemId,
          sourceSha256,
          r2Path,
          version,
          dryRun: false,
          bordbuchEventId: null,
        },
        exitCode: 1,
        summary: `[nachweis.ingest] R2_UPLOAD_ERROR: failed to upload '${filePath}': ${err}`,
      };
    }
  } finally {
    clearInterval(heartbeat);
  }

  logger.info(`[nachweis.ingest] uploaded to R2 — appending Bordbuch entry`);

  const operationId = generateOperationId();
  await acquireLock(workspaceRoot, `system:${systemId}`, operationId, "nachweis.ingest", "agent");
  await acquireLock(workspaceRoot, `bordbuch:${systemId}`, operationId, "nachweis.ingest", "agent");

  let bordbuchEventId: string | null = null;
  try {
    const { entry } = await appendAndCommitBordbuch(
      workspaceRoot,
      systemId,
      "nachweis-record",
      `Ingested nachweis record (type: ${recordType}, slug: ${slug})`,
      "agent",
      {
        writerRole: "nachweis",
        metadata: {
          recordId,
          slug,
          recordType,
          sourceSha256,
          r2Path,
          version,
          qualityStatus,
          titleDe,
          titleUk,
          ...(titleEn ? { titleEn } : {}),
        },
      },
      `Bordbuch: nachweis-record ${systemId} ${slug}`,
    );
    bordbuchEventId = entry.id;
  } catch (err) {
    logger.warn(
      `[nachweis.ingest] Bordbuch append failed — R2 object at ${r2Path} needs manual cleanup: ${err}`,
    );
    return {
      data: {
        recordId,
        systemId,
        sourceSha256,
        r2Path,
        version,
        dryRun: false,
        bordbuchEventId: null,
      },
      exitCode: 1,
      summary: `[nachweis.ingest] BORDBUCH_ERROR: R2 upload succeeded but Bordbuch append failed — manual cleanup needed for ${r2Path}`,
    };
  } finally {
    await releaseLock(workspaceRoot, `bordbuch:${systemId}`);
    await releaseLock(workspaceRoot, `system:${systemId}`);
  }

  return {
    data: {
      recordId,
      systemId,
      sourceSha256,
      r2Path,
      version,
      dryRun: false,
      bordbuchEventId,
    },
    exitCode: 0,
    summary: `[nachweis.ingest] ${systemId}: ingested ${recordId} (sha256: ${sourceSha256.slice(0, 20)}..., bordbuch: ${bordbuchEventId})`,
    nextSteps: [
      {
        action: `Sign the nachweis: pnpm exec werkstatt run nachweis.sign --site ${systemId} --slug ${slug}`,
        kind: "optional",
      },
    ],
  };
}
