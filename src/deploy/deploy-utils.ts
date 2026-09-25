/*
<MODULE_CONTRACT>
  <purpose>Shared utilities for RFC-0566 deploy commands — artifact paths, hashing, symlink management.</purpose>


  <non-goals>
    <item>Do not implement command handlers — those live in separate files.</item>
    <item>Do not define types — those live in types.ts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy utilities — artifact paths, hashing, symlink management.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { collectFiles } from "@warpgogol/werkstatt-shared/node/fs";
import { byteHash } from "@warpgogol/werkstatt-engine/fingerprint";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import type { ArtifactFile, ArtifactManifest } from "./types.ts";

export const PLATFORM_ARTIFACTS_DIR = ".werkstatt/artifacts/platform";
export const CURRENT_SYMLINK = "current";
export const PREVIOUS_SYMLINK = "previous";

export function platformArtifactsBase(workspaceRoot: string): string {
  return path.join(workspaceRoot, PLATFORM_ARTIFACTS_DIR);
}

export function artifactDir(workspaceRoot: string, hash: string): string {
  return path.join(platformArtifactsBase(workspaceRoot), hash);
}

export function currentSymlinkPath(workspaceRoot: string): string {
  return path.join(platformArtifactsBase(workspaceRoot), CURRENT_SYMLINK);
}

export function previousSymlinkPath(workspaceRoot: string): string {
  return path.join(platformArtifactsBase(workspaceRoot), PREVIOUS_SYMLINK);
}

export function manifestPath(workspaceRoot: string, hash: string): string {
  return path.join(artifactDir(workspaceRoot, hash), "manifest.json");
}

export function distPath(workspaceRoot: string, hash: string): string {
  return path.join(artifactDir(workspaceRoot, hash), "dist");
}

export async function hashArtifactDir(
  dir: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<{
  treeHash: string;
  files: ArtifactFile[];
  totalSize: number;
}> {
  const files: ArtifactFile[] = [];
  let totalSize = 0;

  if (!(await io.exists(dir))) {
    return { treeHash: "sha256:empty", files: [], totalSize: 0 };
  }

  const allFiles = await collectFiles(dir);
  for (const fullPath of allFiles) {
    const relPath = path.relative(dir, fullPath).replace(/\\/g, "/");
    const data = await io.readFileBytes(fullPath);
    const hash = byteHash(data);
    files.push({ path: relPath, hash, size: data.length });
    totalSize += data.length;
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const combinedInput = files.map((f) => `${f.path}\n${f.hash}`).join("\n");
  const treeHash = byteHash(combinedInput);

  return { treeHash, files, totalSize };
}

export async function readManifest(
  workspaceRoot: string,
  hash: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<ArtifactManifest> {
  const mp = manifestPath(workspaceRoot, hash);
  if (!(await io.exists(mp))) {
    throw new Error(`[deploy] manifest not found for artifact ${hash}: ${mp}`);
  }
  const raw = await io.readFile(mp);
  return JSON.parse(raw) as ArtifactManifest;
}

export async function writeManifest(
  workspaceRoot: string,
  hash: string,
  manifest: ArtifactManifest,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const mp = manifestPath(workspaceRoot, hash);
  await io.mkdir(path.dirname(mp));
  await io.writeFile(mp, JSON.stringify(manifest, null, 2) + "\n");
}

export async function readSymlinkTarget(
  symlinkPath: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string | null> {
  if (!(await io.exists(symlinkPath))) return null;
  try {
    const result = await io.exec("readlink", [symlinkPath]);
    return result.exitCode === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

export async function readSymlinkBasename(
  symlinkPath: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string | null> {
  const target = await readSymlinkTarget(symlinkPath, io);
  if (!target) return null;
  return path.basename(target);
}

export async function atomicSymlinkSwap(
  symlinkPath: string,
  targetDir: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const tmpPath = `${symlinkPath}.tmp-${process.pid}-${Date.now()}`;
  const lnResult = await io.exec("ln", ["-s", targetDir, tmpPath]);
  if (lnResult.exitCode !== 0) {
    throw new Error(`ln -s exited ${lnResult.exitCode}: ${lnResult.stderr.slice(0, 200)}`);
  }
  try {
    await io.rename(tmpPath, symlinkPath);
  } catch (err) {
    try {
      await io.rm(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

export async function listArtifactHashes(
  workspaceRoot: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string[]> {
  const base = platformArtifactsBase(workspaceRoot);
  if (!(await io.exists(base))) return [];
  const entries = await io.readdir(base);
  const hashes: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory && entry.name !== CURRENT_SYMLINK && entry.name !== PREVIOUS_SYMLINK) {
      hashes.push(entry.name);
    }
  }
  return hashes.sort();
}
