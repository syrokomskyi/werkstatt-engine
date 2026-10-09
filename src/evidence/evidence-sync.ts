/*
<MODULE_CONTRACT>
<purpose>evidence.sync command handler — uploads evidence artifacts from missions/{mission}/evidence/axiom/ to R2 (RFC-0651).</purpose>


<non-goals>
  <item>Does not integrate with mission.close or leitstand.dev-deploy — that is RFC-0652.</item>
  <item>Does not implement content-addressed deduplication — rejected for simplicity (RFC-0650). The RFC-1202 upload manifest is a per-prefix completion marker, not a dedup index: keys stay timestamped and same-key re-uploads remain byte-identical overwrites.</item>
  <item>Does not support partial sync or resumable uploads.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
  <item>RFC-1190: restore mission context + evidence archival in release-mode deploys

RFC-1190: precedence-ordered resolveMissionContext (--mission → release build-identity → currentMission), MISSION_CONTEXT_UNRESOLVED/MISMATCH blocking, fail-closed EVIDENCE_SYNC_FAILED with --skip-evidence-sync as sole escape hatch, journaled evidence-sync-* ship steps after each certify-*, evidence.sync --site/--system flag.

2026-10-04 handoff fixes: shared 25min mission.check timeout (inner 5min race + 300s orchestrator raced cold ~7-11min captures), sweep excludeOpIds so mission.close no longer self-abandons the live ship journal (broke --resume), name-keyed journal resume state so closed-mission plan shifts can't skip unexecuted steps, wrangler dev documented as the required --base-url preview server.</item>
  <item>RFC-1237: resolve dry-run via context.dryRun fallback — consumeCommonFlags strips --dry-run into context.dryRun before dispatch, so a flags-only read was permanently false under werkstatt run (enforced by KERNEL-FLAG-10).</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
  <history>ADR-0025, RFC-0651, RFC-1190, RFC-1202</history>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { resolveMissionDir } from "@warpgogol/werkstatt-engine/kernel";
import { collectFiles } from "@warpgogol/werkstatt-shared/node/fs";
import { discoverSystems, readSystemState } from "../sternsystem/registry-io.ts";
import { createR2Client, resolveR2ConfigFromEnv, MissingEnvError } from "./r2-client.ts";
import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export interface EvidenceSyncResult {
  missionId: string;
  systemId: string;
  runTimestamp: string;
  r2KeyPrefix: string;
  uploadedFiles: string[];
  skippedFiles: string[];
  deduped: boolean;
  totalBytes: number;
  durationMs: number;
}

// RFC-1202: completion marker written strictly after the last successful
// upload. Sibling of the run prefix ({ts}.upload-manifest.json), never inside
// it — evidence.fetch downloads every key under runPrefix, so an in-prefix
// marker would pollute downloadedFiles and file counts.
export interface EvidenceUploadManifest {
  schemaVersion: 1;
  missionId: string;
  runTimestamp: string;
  fileCount: number;
  totalBytes: number;
  files: string[]; // relative paths, sorted
  completedAt: string;
}

const UPLOAD_MANIFEST_SUFFIX = ".upload-manifest.json";

function uploadManifestKey(r2KeyPrefix: string): string {
  return `${r2KeyPrefix.replace(/\/$/, "")}${UPLOAD_MANIFEST_SUFFIX}`;
}

type R2Client = ReturnType<typeof createR2Client>;

// Deliberately broad catch — NoSuchKey, network errors, and corrupt JSON all
// mean "no usable manifest": the upload proceeds. Evidence integrity is never
// traded for the optimization.
async function readUploadManifest(
  client: R2Client,
  key: string,
): Promise<EvidenceUploadManifest | null> {
  try {
    const result = await client.getObject(key);
    const parsed = JSON.parse(new TextDecoder().decode(result.body)) as EvidenceUploadManifest;
    if (!parsed || !Array.isArray(parsed.files) || parsed.schemaVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function manifestMatches(manifest: EvidenceUploadManifest, relativeFiles: string[]): boolean {
  const local = [...relativeFiles].sort();
  const stored = [...manifest.files].sort();
  return local.length === stored.length && local.every((f, i) => f === stored[i]);
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
  io: WorkspaceIO,
): Promise<EvidenceMetadata> {
  const metaPath = path.join(evidenceDir, "evidence-metadata.json");
  if (!(await io.exists(metaPath))) {
    throw new Error(
      `[evidence.sync] INVALID_EVIDENCE: evidence-metadata.json not found for mission '${missionId}' — run mission.check first`,
    );
  }
  let raw: string;
  try {
    raw = await io.readFile(metaPath);
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

  const dryRun = context.dryRun === true || flagBool(input, "dry-run");
  const explicitRunTimestamp = flagString(input, "run-timestamp");

  const missionDir = await resolveMissionDir(workspaceRoot, missionId, context.io);
  const evidenceDir = path.join(missionDir, "evidence", "axiom");

  if (!(await context.io.exists(evidenceDir))) {
    throw new Error(
      `[evidence.sync] NOT_FOUND: evidence/axiom/ directory not found for mission '${missionId}'`,
    );
  }

  const metadata = await readEvidenceMetadata(evidenceDir, missionId, context.io);
  const runTimestamp = explicitRunTimestamp ?? metadata.runTimestamp!;
  // RFC-1190: --site makes the target Sternsystem explicit (ship passes it).
  // When absent, fall back to the currentMission scan / missionId prefix. A
  // flag that contradicts the resolved system is a hard error, not a silent
  // override — an R2 prefix under the wrong system corrupts the archive layout.
  const siteFlag = flagString(input, "site") ?? flagString(input, "system");
  const resolvedSystemId = await resolveSystemId(workspaceRoot, missionId);
  if (siteFlag && siteFlag !== resolvedSystemId) {
    throw new Error(
      `[evidence.sync] SYSTEM_MISMATCH: --site '${siteFlag}' contradicts resolved systemId '${resolvedSystemId}' for mission '${missionId}'`,
    );
  }
  const systemId = siteFlag ?? resolvedSystemId;
  const r2KeyPrefix = `${systemId}/${missionId}/${runTimestamp}/`;

  const allFiles = await collectFiles(evidenceDir);
  const relativeFiles = allFiles.map((f) => path.relative(evidenceDir, f).replace(/\\/g, "/"));

  const uploadedFiles: string[] = [];
  const skippedFiles: string[] = [];
  let totalBytes = 0;
  const manifestKey = uploadManifestKey(r2KeyPrefix);

  const dedupedResult = (dry: boolean): KernelCommandResult<EvidenceSyncResult> => {
    const skipped = [...relativeFiles].sort();
    return {
      data: {
        missionId,
        systemId,
        runTimestamp,
        r2KeyPrefix,
        uploadedFiles: [],
        skippedFiles: skipped,
        deduped: true,
        totalBytes: 0,
        durationMs: Date.now() - startTime,
      },
      exitCode: 0,
      summary: dry
        ? `[evidence.sync] ${missionId}: dry-run — already archived, ${skipped.length} files would be skipped (manifest match at ${r2KeyPrefix})`
        : `[evidence.sync] ${missionId}: already archived — ${skipped.length} files skipped (manifest match at ${r2KeyPrefix})`,
    };
  };

  if (!dryRun) {
    let r2Config;
    try {
      r2Config = resolveR2ConfigFromEnv("axiom-evidence", "R2_AXIOM");
    } catch (err) {
      if (err instanceof MissingEnvError) {
        return {
          exitCode: 1,
          summary: `[evidence.sync] MISSING_ENV: ${err.message}`,
          nextSteps: [
            { action: `[evidence.sync] MISSING_ENV: ${err.message}`, kind: "required" as const },
          ],
          data: {
            missionId,
            systemId,
            runTimestamp,
            r2KeyPrefix,
            uploadedFiles: [],
            skippedFiles: [],
            deduped: false,
            totalBytes: 0,
            durationMs: Date.now() - startTime,
          },
        };
      }
      throw err;
    }

    const client = createR2Client(r2Config);

    // RFC-1202: a matching completion manifest means the prefix is already
    // archived — one small read replaces the whole upload.
    const manifest = await readUploadManifest(client, manifestKey);
    if (manifest && manifestMatches(manifest, relativeFiles)) {
      return dedupedResult(false);
    }

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
            const body = await context.io.readFileBytes(fullPath);
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
        exitCode: 1,
        summary: `[evidence.sync] R2_UPLOAD_ERROR: failed to upload '${firstError.relPath}': ${firstError.err}`,
        nextSteps: [
          {
            action: `[evidence.sync] R2_UPLOAD_ERROR: failed to upload '${firstError.relPath}': ${firstError.err}`,
            kind: "required" as const,
          },
        ],
        data: {
          missionId,
          systemId,
          runTimestamp,
          r2KeyPrefix,
          uploadedFiles,
          skippedFiles,
          deduped: false,
          totalBytes,
          durationMs: Date.now() - startTime,
        },
      };
    }

    // RFC-1202: manifest written strictly after the loop — a prefix is complete
    // only when this object exists. A failed write degrades to one extra
    // upload next run; it never falsifies archival state.
    const manifestPayload: EvidenceUploadManifest = {
      schemaVersion: 1,
      missionId,
      runTimestamp,
      fileCount: relativeFiles.length,
      totalBytes,
      files: [...relativeFiles].sort(),
      completedAt: new Date().toISOString(),
    };
    try {
      await client.putObject({
        key: manifestKey,
        body: new TextEncoder().encode(JSON.stringify(manifestPayload, null, 2) + "\n"),
        contentType: "application/json",
      });
    } catch (err) {
      context.logger.warn(
        `[evidence.sync] upload manifest write failed (next run re-uploads): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    // RFC-1202: dry-run performs the manifest check when R2 env resolves;
    // MissingEnvError degrades to the plain listing (today's behavior).
    try {
      const dryR2Config = resolveR2ConfigFromEnv("axiom-evidence", "R2_AXIOM");
      const dryClient = createR2Client(dryR2Config);
      const manifest = await readUploadManifest(dryClient, manifestKey);
      if (manifest && manifestMatches(manifest, relativeFiles)) {
        return dedupedResult(true);
      }
    } catch (err) {
      if (!(err instanceof MissingEnvError)) throw err;
    }

    for (const relPath of relativeFiles) {
      const fullPath = path.join(evidenceDir, relPath);
      const stat = await context.io.stat(fullPath);
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
      deduped: false,
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
