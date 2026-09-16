/*
<MODULE_CONTRACT>
  <purpose>RFC-0566 deploy.artifact.gc — garbage-collect old platform artifacts not referenced by symlinks.</purpose>


  <non-goals>
    <item>Do not delete release artifacts — those are managed by artifact.store.gc.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy.artifact.gc handler.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import type { ArtifactGcResult } from "./types.ts";
import {
  artifactDir,
  currentSymlinkPath,
  listArtifactHashes,
  previousSymlinkPath,
  readSymlinkBasename,
} from "./deploy-utils.ts";

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

function flagNumber(input: KernelCommandInput, key: string, defaultValue: number): number {
  const v = input.flags[key];
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return isNaN(n) ? defaultValue : n;
  }
  if (typeof v === "number") return v;
  return defaultValue;
}

const DEFAULT_RETENTION = 5;

export async function runDeployArtifactGc(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ArtifactGcResult>> {
  const { workspaceRoot, logger } = context;
  const dryRun = flagBool(input, "dry-run");
  const retention = flagNumber(input, "retain", DEFAULT_RETENTION);

  const currentHash = readSymlinkBasename(currentSymlinkPath(workspaceRoot));
  const previousHash = readSymlinkBasename(previousSymlinkPath(workspaceRoot));

  const referenced = new Set<string>();
  if (currentHash) referenced.add(currentHash);
  if (previousHash) referenced.add(previousHash);

  const allHashes = await listArtifactHashes(workspaceRoot);
  if (allHashes.length === 0) {
    return {
      data: { dryRun, examined: 0, deleted: 0, retained: 0, candidates: [] },
      summary: "[deploy.artifact.gc] no artifacts found",
    };
  }

  const sortedByTime: Array<{ hash: string; mtime: number }> = [];
  for (const hash of allHashes) {
    const dir = artifactDir(workspaceRoot, hash);
    try {
      const stat = await fs.stat(dir);
      sortedByTime.push({ hash, mtime: stat.mtimeMs });
    } catch {
      // skip
    }
  }
  sortedByTime.sort((a, b) => b.mtime - a.mtime);

  const candidates: Array<{ hash: string; reason: string }> = [];
  let retained = 0;
  let deleted = 0;

  for (let i = 0; i < sortedByTime.length; i++) {
    const { hash } = sortedByTime[i];

    if (referenced.has(hash)) {
      retained++;
      continue;
    }

    if (i < retention) {
      retained++;
      continue;
    }

    candidates.push({ hash, reason: "unreferenced-beyond-retention" });
  }

  if (!dryRun) {
    for (const candidate of candidates) {
      const dir = artifactDir(workspaceRoot, candidate.hash);
      try {
        await fs.rm(dir, { recursive: true, force: true });
        deleted++;
      } catch (err) {
        logger.error(
          `[deploy.artifact.gc] failed to delete ${candidate.hash}: ${(err as Error).message}`,
        );
      }
    }
  }

  logger.info(
    `[deploy.artifact.gc] examined ${allHashes.length}, retained ${retained}, deleted ${deleted}, candidates ${candidates.length}`,
  );

  return {
    data: {
      dryRun,
      examined: allHashes.length,
      deleted,
      retained,
      candidates,
    },
    summary: `[deploy.artifact.gc] examined ${allHashes.length}, retained ${retained}, deleted ${deleted}`,
  };
}
