/******************************************************************************* 
<MODULE_CONTRACT> 
<purpose>Facilitates the management of directory manifests to ensure integrity and version tracking of files within specified directories.</purpose> 
 
 
<non-goals> 
  <item>Do not parse raw content of manifest files or enforce schema validation.</item> 
  <item>Do not manage the orchestration of transport or configuration settings.</item> 
</non-goals> 
</MODULE_CONTRACT> 
 
<CHANGE_SUMMARY>
  <item>Enhance Compass scaffolding to accurately reflect the functionality of directory manifest management.</item>
</CHANGE_SUMMARY> 
*******************************************************************************/

/**
 * Directory manifest management for integrity tracking.
 * Loads, saves, and updates per-directory file version manifests.
 */

import path from "node:path";
import { pathExists } from "./fs.ts";
import { readJsonFile, writeJsonFile } from "./json.ts";
import { manifestPathForDirectory } from "./paths.ts";
import type { DirectoryManifest, ManifestFileRecord } from "./types.ts";

export async function loadDirectoryManifest(
  cwd: string,
  repoDir: string,
): Promise<DirectoryManifest | null> {
  const filePath = manifestPathForDirectory(cwd, repoDir);
  if (!(await pathExists(filePath))) return null;
  return readJsonFile<DirectoryManifest>(filePath);
}

export async function saveDirectoryManifest(
  cwd: string,
  manifest: DirectoryManifest,
): Promise<void> {
  const filePath = manifestPathForDirectory(cwd, manifest.directory);
  await writeJsonFile(filePath, manifest);
}

export function createEmptyManifest(repoDir: string): DirectoryManifest {
  return {
    $schemaVersion: 1,
    directory: repoDir,
    generatedAt: new Date().toISOString(),
    files: {},
  };
}

export function upsertManifestRecord(
  manifest: DirectoryManifest,
  fileName: string,
  record: ManifestFileRecord,
): DirectoryManifest {
  manifest.files[fileName] = record;
  manifest.generatedAt = new Date().toISOString();
  return manifest;
}

export function removeManifestRecord(
  manifest: DirectoryManifest,
  fileName: string,
): DirectoryManifest {
  delete manifest.files[fileName];
  manifest.generatedAt = new Date().toISOString();
  return manifest;
}

export function getManifestFileName(repoPath: string): string {
  return path.posix.basename(repoPath);
}
