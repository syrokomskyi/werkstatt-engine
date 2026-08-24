/*
<MODULE_CONTRACT>
<purpose>evidence.fetch command handler — downloads historical evidence runs from R2 and lists available runs via ListObjectsV2 (RFC-0651).</purpose>
<keywords>evidence, fetch, r2, download, list, axiom</keywords>
<responsibilities>
  <item>Downloads all objects under {systemId}/{missionId}/{runTimestamp}/ to --output-dir.</item>
  <item>Lists available runs via ListObjectsV2 with prefix {systemId}/{missionId}/.</item>
  <item>Downloads evidence-metadata.json per run in --list mode to extract commitSha.</item>
  <item>Supports --no-raw to skip raw/ artifacts during fetch.</item>
</responsibilities>
<non-goals>
  <item>Does not implement Iceberg REST catalog listing — ListObjectsV2 is the primary mechanism.</item>
  <item>Does not support partial fetch or resumable downloads.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0651: initial evidence.fetch command handler.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { discoverSystems, readSystemState } from "../sternsystem/registry-io.ts";
import { createR2Client, resolveR2ConfigFromEnv, MissingEnvError } from "./r2-client.ts";

export interface EvidenceFetchResult {
  missionId: string;
  runTimestamp: string;
  r2KeyPrefix: string;
  downloadedFiles: string[];
  totalBytes: number;
  outputDir: string;
}

export interface EvidenceListResult {
  missionId: string;
  runs: Array<{
    runTimestamp: string;
    commitSha: string | null;
    r2KeyPrefix: string;
  }>;
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
  return missionId.includes("-m") ? missionId.split("-m")[0] : missionId;
}

function parseRunTimestampFromKey(key: string, prefix: string): string | null {
  const afterPrefix = key.slice(prefix.length);
  const slashIdx = afterPrefix.indexOf("/");
  if (slashIdx === -1) return null;
  return afterPrefix.slice(0, slashIdx);
}

export async function runEvidenceFetch(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<EvidenceFetchResult | EvidenceListResult>> {
  const { workspaceRoot } = context;

  const missionId = flagString(input, "mission");
  if (!missionId) {
    throw new Error("evidence.fetch requires --mission <mission-id>");
  }

  const listMode = flagBool(input, "list");
  const noRaw = flagBool(input, "no-raw");
  const runTimestamp = flagString(input, "run-timestamp");
  const outputDir = flagString(input, "output-dir");

  let r2Config;
  try {
    r2Config = resolveR2ConfigFromEnv("axiom-evidence", "R2_AXIOM");
  } catch (err) {
    if (err instanceof MissingEnvError) {
      return {
        data: { missionId, runs: [] },
        exitCode: 1,
        summary: `[evidence.fetch] MISSING_ENV: ${err.message}`,
      };
    }
    throw err;
  }

  const systemId = await resolveSystemId(workspaceRoot, missionId);
  const client = createR2Client(r2Config);

  if (listMode) {
    const listPrefix = `${systemId}/${missionId}/`;
    let objects: Array<{ key: string; size: number }>;
    try {
      objects = await client.listObjectsV2(listPrefix);
    } catch (err) {
      return {
        data: { missionId, runs: [] },
        exitCode: 1,
        summary: `[evidence.fetch] R2_LIST_ERROR: failed to list objects with prefix '${listPrefix}': ${err}`,
      };
    }

    const runTimestamps = new Set<string>();
    for (const obj of objects) {
      const ts = parseRunTimestampFromKey(obj.key, listPrefix);
      if (ts) runTimestamps.add(ts);
    }

    const runs: EvidenceListResult["runs"] = [];
    for (const ts of runTimestamps) {
      const metaKey = `${listPrefix}${ts}/evidence-metadata.json`;
      let commitSha: string | null = null;
      try {
        const obj = await client.getObject(metaKey);
        const text = new TextDecoder().decode(obj.body);
        const meta = JSON.parse(text) as EvidenceMetadata;
        commitSha = meta.commitSha ?? null;
      } catch {
        // If evidence-metadata.json is missing or invalid, commitSha stays null
      }
      runs.push({
        runTimestamp: ts,
        commitSha,
        r2KeyPrefix: `${listPrefix}${ts}/`,
      });
    }

    runs.sort((a, b) => b.runTimestamp.localeCompare(a.runTimestamp));

    return {
      data: { missionId, runs },
      exitCode: 0,
      summary: `[evidence.fetch] ${missionId}: ${runs.length} run${runs.length === 1 ? "" : "s"} available`,
      nextSteps:
        runs.length > 0
          ? [
              {
                action: `Download a run: pnpm exec werkstatt run evidence.fetch --mission ${missionId} --run <timestamp>`,
                kind: "optional",
              },
            ]
          : undefined,
    };
  }

  if (!runTimestamp) {
    throw new Error(
      "evidence.fetch requires --run-timestamp <ts> (or --list to list available runs)",
    );
  }
  if (!outputDir) {
    throw new Error("evidence.fetch requires --output-dir <dir> when fetching a run");
  }

  const runPrefix = `${systemId}/${missionId}/${runTimestamp}/`;
  let objects: Array<{ key: string; size: number }>;
  try {
    objects = await client.listObjectsV2(runPrefix);
  } catch (err) {
    return {
      data: {
        missionId,
        runTimestamp,
        r2KeyPrefix: runPrefix,
        downloadedFiles: [],
        totalBytes: 0,
        outputDir,
      },
      exitCode: 1,
      summary: `[evidence.fetch] R2_LIST_ERROR: failed to list objects with prefix '${runPrefix}': ${err}`,
    };
  }

  if (objects.length === 0) {
    return {
      data: {
        missionId,
        runTimestamp,
        r2KeyPrefix: runPrefix,
        downloadedFiles: [],
        totalBytes: 0,
        outputDir,
      },
      exitCode: 1,
      summary: `[evidence.fetch] NOT_FOUND: no evidence found for mission '${missionId}' run '${runTimestamp}'`,
    };
  }

  const filteredObjects = noRaw
    ? objects.filter((obj) => !obj.key.slice(runPrefix.length).startsWith("raw/"))
    : objects;

  await fs.mkdir(outputDir, { recursive: true });

  const downloadedFiles: string[] = [];
  let totalBytes = 0;

  for (const obj of filteredObjects) {
    const relPath = obj.key.slice(runPrefix.length);
    if (!relPath) continue;

    const destPath = path.join(outputDir, relPath);
    await fs.mkdir(path.dirname(destPath), { recursive: true });

    try {
      const result = await client.getObject(obj.key);
      await fs.writeFile(destPath, result.body);
      downloadedFiles.push(relPath);
      totalBytes += result.body.byteLength;
    } catch (err) {
      return {
        data: {
          missionId,
          runTimestamp,
          r2KeyPrefix: runPrefix,
          downloadedFiles,
          totalBytes,
          outputDir,
        },
        exitCode: 1,
        summary: `[evidence.fetch] R2_DOWNLOAD_ERROR: failed to download '${relPath}': ${err}`,
      };
    }
  }

  const sizeMb = (totalBytes / (1024 * 1024)).toFixed(1);
  return {
    data: {
      missionId,
      runTimestamp,
      r2KeyPrefix: runPrefix,
      downloadedFiles,
      totalBytes,
      outputDir,
    },
    exitCode: 0,
    summary: `[evidence.fetch] ${missionId}: downloaded ${downloadedFiles.length} files (${sizeMb} MB) from R2 to ${outputDir}`,
  };
}
