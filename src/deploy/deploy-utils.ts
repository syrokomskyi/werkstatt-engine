/*
<MODULE_CONTRACT>
  <purpose>Shared utilities for RFC-0566 deploy commands — artifact paths, hashing, symlink management.</purpose>
  <keywords>deploy, artifact, symlink, hash, platform</keywords>
  <responsibilities>
    <item>Resolve platform artifact directory paths.</item>
    <item>Hash artifact directories using @warpgogol/fingerprint.</item>
    <item>Read and write artifact manifests.</item>
    <item>Manage current and previous symlinks atomically.</item>
  </responsibilities>
  <non-goals>
    <item>Do not implement command handlers — those live in separate files.</item>
    <item>Do not define types — those live in types.ts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy utilities — artifact paths, hashing, symlink management.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import { existsSync, readlinkSync, symlinkSync } from "node:fs";
import path from "node:path";
import { collectFiles } from "@warpgogol/werkstatt-shared/share/fs";
import { byteHash } from "@warpgogol/werkstatt-engine/fingerprint";
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

export async function hashArtifactDir(dir: string): Promise<{
  treeHash: string;
  files: ArtifactFile[];
  totalSize: number;
}> {
  const files: ArtifactFile[] = [];
  let totalSize = 0;

  if (!existsSync(dir)) {
    return { treeHash: "sha256:empty", files: [], totalSize: 0 };
  }

  const allFiles = await collectFiles(dir);
  for (const fullPath of allFiles) {
    const relPath = path.relative(dir, fullPath).replace(/\\/g, "/");
    const data = await fs.readFile(fullPath);
    const hash = byteHash(data);
    files.push({ path: relPath, hash, size: data.length });
    totalSize += data.length;
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const combinedInput = files.map((f) => `${f.path}\n${f.hash}`).join("\n");
  const treeHash = byteHash(combinedInput);

  return { treeHash, files, totalSize };
}

export async function readManifest(workspaceRoot: string, hash: string): Promise<ArtifactManifest> {
  const mp = manifestPath(workspaceRoot, hash);
  if (!existsSync(mp)) {
    throw new Error(`[deploy] manifest not found for artifact ${hash}: ${mp}`);
  }
  const raw = await fs.readFile(mp, "utf8");
  return JSON.parse(raw) as ArtifactManifest;
}

export async function writeManifest(
  workspaceRoot: string,
  hash: string,
  manifest: ArtifactManifest,
): Promise<void> {
  const mp = manifestPath(workspaceRoot, hash);
  await fs.mkdir(path.dirname(mp), { recursive: true });
  await fs.writeFile(mp, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

export function readSymlinkTarget(symlinkPath: string): string | null {
  if (!existsSync(symlinkPath)) return null;
  try {
    return readlinkSync(symlinkPath);
  } catch {
    return null;
  }
}

export function readSymlinkBasename(symlinkPath: string): string | null {
  const target = readSymlinkTarget(symlinkPath);
  if (!target) return null;
  return path.basename(target);
}

export async function atomicSymlinkSwap(symlinkPath: string, targetDir: string): Promise<void> {
  const tmpPath = `${symlinkPath}.tmp-${process.pid}-${Date.now()}`;
  symlinkSync(targetDir, tmpPath);
  try {
    await fs.rename(tmpPath, symlinkPath);
  } catch (err) {
    try {
      await fs.unlink(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

export async function listArtifactHashes(workspaceRoot: string): Promise<string[]> {
  const base = platformArtifactsBase(workspaceRoot);
  if (!existsSync(base)) return [];
  const entries = await fs.readdir(base, { withFileTypes: true });
  const hashes: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== CURRENT_SYMLINK && entry.name !== PREVIOUS_SYMLINK) {
      hashes.push(entry.name);
    }
  }
  return hashes.sort();
}
