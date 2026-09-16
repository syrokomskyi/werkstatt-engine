/***************************************************************
 * <MODULE_CONTRACT>
 * <purpose>Facilitates the collection of build outputs and the creation of build provenance metadata.</purpose>
 *  *  * <non-goals>
 * <item>Do not handle raw file parsing or content validation.</item>
 * <item>Do not manage build orchestration or execution flow.</item>
 * <item>Do not interact with external systems beyond file I/O.</item>
 * </non-goals>
 * </MODULE_CONTRACT>
 *  * <CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
 ***************************************************************/

/**
 * Build artifact collection and provenance creation.
 * Computes hashes of dist files and creates signed build metadata.
 */

import path from "node:path";
import { byteHash, byteHashFile } from "@warpgogol/werkstatt-engine/fingerprint";
import { discoverManagedFiles } from "./discover.ts";
import { discoverDistFiles } from "./internal-dist.ts";
import { getHeadSha, getRepoUrl } from "./git.ts";
import { writeJsonFile } from "./json.ts";
import { outputsPath, provenancePath } from "./paths.ts";
import type { BuildProvenance, OutputsFile } from "./types.ts";

export async function collectBuildOutputs(cwd: string, distDir = "dist"): Promise<OutputsFile> {
  const buildId = new Date().toISOString().replace(/[:.]/g, "-");
  const outputs: Record<string, string> = {};
  const files = await discoverDistFiles(cwd, distDir);
  for (const file of files) {
    outputs[file] = await byteHashFile(path.join(cwd, file));
  }
  return { buildId, outputs };
}

export async function buildInputsDigest(cwd: string): Promise<string> {
  const files = await discoverManagedFiles(cwd);
  const entries = await Promise.all(
    files.map(async (file) => `${file}\t${await byteHashFile(path.join(cwd, file))}`),
  );
  const combined = entries.join("\n");
  return byteHash(combined);
}

export async function createBuildProvenance(args: {
  cwd: string;
  builder: string;
  outputs: OutputsFile;
}): Promise<BuildProvenance> {
  const started = new Date().toISOString();
  const outputsDigest = byteHash(JSON.stringify(args.outputs.outputs));
  const inputsDigest = await buildInputsDigest(args.cwd);
  const finished = new Date().toISOString();

  return {
    buildId: args.outputs.buildId,
    sourceRepo: (await getRepoUrl(args.cwd)) ?? "unknown",
    sourceCommit: (await getHeadSha(args.cwd)) ?? "unknown",
    builder: args.builder,
    buildStartedAt: started,
    buildFinishedAt: finished,
    inputsDigest,
    outputsDigest,
  };
}

export async function writeBuildArtifacts(args: {
  cwd: string;
  outputs: OutputsFile;
  provenance: BuildProvenance;
}): Promise<void> {
  await writeJsonFile(outputsPath(args.cwd), args.outputs);
  await writeJsonFile(provenancePath(args.cwd), args.provenance);
}
