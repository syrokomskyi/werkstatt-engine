/*
<MODULE_CONTRACT>
<purpose>evidence.sync command handler — uploads evidence artifacts from missions/{mission}/evidence/axiom/ to R2 (RFC-0651).</purpose>
<keywords>evidence, sync, r2, upload, axiom</keywords>
<responsibilities>
  <item>Reads evidence-metadata.json to resolve runTimestamp.</item>
  <item>Walks evidence/axiom/ recursively and uploads all files to R2.</item>
  <item>Supports --dry-run mode that makes no R2 API calls.</item>
  <item>Resolves systemId from system-config.yaml by matching missionId to currentMission.</item>
</responsibilities>
<non-goals>
  <item>Does not integrate with mission.close or leitstand.dev-deploy — that is RFC-0652.</item>
  <item>Does not implement content-addressed deduplication — rejected for simplicity (RFC-0650).</item>
  <item>Does not support partial sync or resumable uploads.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0651: initial evidence.sync command handler.</item>
  <item>ADR-0025: add periodic progress logging (30s heartbeat) during R2 upload loop.</item>
  <item>Replace sequential upload with concurrency pool (10 parallel) — 10x faster for 1576 files.</item>
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
import { resolveMissionDir } from "@warpgogol/werkstatt-engine/kernel";
import { collectFiles } from "@warpgogol/werkstatt-shared/share/fs";
import { discoverSystems, readSystemState } from "../sternsystem/registry-io.ts";
import { createR2Client, resolveR2ConfigFromEnv, MissingEnvError } from "./r2-client.ts";

export interface EvidenceSyncResult {
  missionId: string;
  systemId: string;
  runTimestamp: string;
  r2KeyPrefix: string;
  uploadedFiles: string[];
  skippedFiles: string[];
  totalBytes: number;
  durationMs: number;
}

interface EvidenceMetadata {
  auditId?: string;
  runTimestamp?: string;
  commitSha?: string;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

async function readEvidenceMetadata(
  evidenceDir: string,
  missionId: string,
): Promise<EvidenceMetadata> {
  const metaPath = path.join(evidenceDir, "evidence-metadata.json");
  if (!existsSync(metaPath)) {
    throw new Error(
      `[evidence.sync] INVALID_EVIDENCE: evidence-metadata.json not found for mission '${missionId}' — run mission.check first`,
    );
  }
  let raw: string;
  try {
    raw = await fs.readFile(metaPath, "utf8");
  } catch (err) {
    throw new Error(
      `[evidence.sync] INVALID_EVIDENCE: cannot read evidence-metadata.json for mission '${missionId}': ${err}`,
    );
  }
  let parsed: EvidenceMetadata;
  try {
    parsed = JSON.parse(raw) as EvidenceMetadata;
  } catch {
    throw new Error(
      `[evidence.sync] INVALID_EVIDENCE: evidence-metadata.json is not valid JSON for mission '${missionId}'`,
    );
  }
  if (!parsed.runTimestamp) {
    throw new Error(
      `[evidence.sync] INVALID_EVIDENCE: evidence-metadata.json missing runTimestamp field for mission '${missionId}' — run mission.check first`,
    );
  }
  return parsed;
}

async function resolveSystemId(workspaceRoot: string, missionId: string): Promise<string> {
  const { systems } = await discoverSystems(workspaceRoot);
  for (const sys of systems) {
    try {
      const state = await readSystemState(workspaceRoot, sys.id);
      if (state.currentMission === missionId) {
        return sys.id;
      }
    } catch {
      // State not available for this system — skip
    }
  }
  const systemId = missionId.includes("-m") ? missionId.split("-m")[0] : missionId;
  return systemId;
}

export async function runEvidenceSync(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<EvidenceSyncResult>> {
  const { workspaceRoot } = context;
  const startTime = Date.now();

  const missionId = flagString(input, "mission");
  if (!missionId) {
    throw new Error("evidence.sync requires --mission <mission-id>");
  }

  const dryRun = flagBool(input, "dry-run");
  const explicitRunTimestamp = flagString(input, "run-timestamp");

  const missionDir = resolveMissionDir(workspaceRoot, missionId);
  const evidenceDir = path.join(missionDir, "evidence", "axiom");

  if (!existsSync(evidenceDir)) {
    throw new Error(
      `[evidence.sync] NOT_FOUND: evidence/axiom/ directory not found for mission '${missionId}'`,
    );
  }

  const metadata = await readEvidenceMetadata(evidenceDir, missionId);
  const runTimestamp = explicitRunTimestamp ?? metadata.runTimestamp!;
  const systemId = await resolveSystemId(workspaceRoot, missionId);
  const r2KeyPrefix = `${systemId}/${missionId}/${runTimestamp}/`;

  const allFiles = await collectFiles(evidenceDir);
  const relativeFiles = allFiles.map((f) => path.relative(evidenceDir, f).replace(/\\/g, "/"));

  const uploadedFiles: string[] = [];
  const skippedFiles: string[] = [];
  let totalBytes = 0;

  if (!dryRun) {
    let r2Config;
    try {
      r2Config = resolveR2ConfigFromEnv("axiom-evidence", "R2_AXIOM");
    } catch (err) {
      if (err instanceof MissingEnvError) {
        return {
          data: {
            missionId,
            systemId,
            runTimestamp,
            r2KeyPrefix,
            uploadedFiles: [],
            skippedFiles: [],
            totalBytes: 0,
            durationMs: Date.now() - startTime,
          },
          exitCode: 1,
          summary: `[evidence.sync] MISSING_ENV: ${err.message}`,
        };
      }
      throw err;
    }

    const client = createR2Client(r2Config);

    context.logger.info(
      `[evidence.sync] uploading ${relativeFiles.length} files to R2 prefix ${r2KeyPrefix}`,
    );

    // ADR-0025: progress heartbeat — log every 30s during silent upload loops.
    let lastProgressIndex = 0;
    const heartbeat = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      context.logger.info(
        `[evidence.sync] still uploading — ${uploadedFiles.length}/${relativeFiles.length} files done (${elapsed}s elapsed)`,
      );
      lastProgressIndex = uploadedFiles.length;
    }, 30_000);

    const CONCURRENCY = 10;
    let uploadFailed = false;
    let firstError: { relPath: string; err: unknown } | null = null;

    try {
      for (let i = 0; i < relativeFiles.length && !uploadFailed; i += CONCURRENCY) {
        const batch = relativeFiles.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (relPath) => {
            const fullPath = path.join(evidenceDir, relPath);
            const body = await fs.readFile(fullPath);
            totalBytes += body.byteLength;
            await client.putObject({
              key: r2KeyPrefix + relPath,
              body: new Uint8Array(body),
            });
            return relPath;
          }),
        );
        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (result.status === "fulfilled") {
            uploadedFiles.push(result.value);
          } else {
            uploadFailed = true;
            if (!firstError) {
              firstError = { relPath: batch[j], err: result.reason };
            }
          }
        }
      }
    } finally {
      clearInterval(heartbeat);
      if (!uploadFailed && uploadedFiles.length > lastProgressIndex) {
        context.logger.info(
          `[evidence.sync] upload loop complete — ${uploadedFiles.length}/${relativeFiles.length} files`,
        );
      }
    }

    if (uploadFailed && firstError) {
      return {
        data: {
          missionId,
          systemId,
          runTimestamp,
          r2KeyPrefix,
          uploadedFiles,
          skippedFiles,
          totalBytes,
          durationMs: Date.now() - startTime,
        },
        exitCode: 1,
        summary: `[evidence.sync] R2_UPLOAD_ERROR: failed to upload '${firstError.relPath}': ${firstError.err}`,
      };
    }
  } else {
    for (const relPath of relativeFiles) {
      const fullPath = path.join(evidenceDir, relPath);
      const stat = await fs.stat(fullPath);
      totalBytes += stat.size;
      uploadedFiles.push(relPath);
    }
  }

  const durationMs = Date.now() - startTime;
  const sizeMb = (totalBytes / (1024 * 1024)).toFixed(1);
  const summary = dryRun
    ? `[evidence.sync] ${missionId}: dry-run — ${uploadedFiles.length} files (${sizeMb} MB) would be uploaded to ${r2KeyPrefix}`
    : `[evidence.sync] ${missionId}: uploaded ${uploadedFiles.length} files (${sizeMb} MB) to R2 in ${(durationMs / 1000).toFixed(1)}s`;

  return {
    data: {
      missionId,
      systemId,
      runTimestamp,
      r2KeyPrefix,
      uploadedFiles,
      skippedFiles,
      totalBytes,
      durationMs,
    },
    exitCode: 0,
    summary,
    nextSteps: dryRun
      ? [
          {
            action: `Upload for real: pnpm exec werkstatt run evidence.sync --mission ${missionId}`,
            kind: "optional",
          },
        ]
      : undefined,
  };
}
