/*
<MODULE_CONTRACT>
<purpose>Establishes integrity tracking for managed files by creating necessary manifests and entity records.</purpose>
<non-goals>
  <item>Do not perform file content parsing; focus solely on metadata and integrity tracking.</item>
  <item>Do not manage the orchestration of file transport or configuration settings.</item>
  <item>Do not handle user input validation beyond the initial policy file check.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Refine Compass scaffolding to improve clarity and maintainability of the runInit function.</item>
  <item>Migrated sha256FileHex from deleted ./hash.ts to byteHashFile from @warpgogol/fingerprint directly.</item>
</CHANGE_SUMMARY>
*/

/**
 * Initialize integrity tracking by registering all managed files.
 * Creates manifests, entities registry, and path bindings from scratch.
 */

import path from "node:path";
import { byteHashFile } from "@warpgogol/werkstatt-engine/fingerprint";
import { discoverManagedFiles, groupFilesByDirectory } from "./discover.ts";
import { getFileHistory, getFileRevisionFromHistory } from "./git.ts";
import { writeJsonFile } from "./json.ts";
import {
  createEmptyManifest,
  getManifestFileName,
  saveDirectoryManifest,
  upsertManifestRecord,
} from "./manifests.ts";
import { deletedLogPath } from "./paths.ts";
import { saveEntitiesById, savePathsCurrent } from "./registry.ts";
import { v7 as uuidv7 } from "uuid";
import { ensurePolicyFile } from "./policy.ts";
import type { DirectoryManifest, EntitiesById, PathsCurrent } from "./types.ts";

export async function runInit(args: { cwd: string }): Promise<void> {
  const { cwd } = args;
  await ensurePolicyFile(cwd);

  const files = await discoverManagedFiles(cwd);
  const grouped = await groupFilesByDirectory(files);
  const manifests = new Map<string, DirectoryManifest>();
  const entities: EntitiesById = {};
  const paths: PathsCurrent = {};

  for (const file of files) {
    const absPath = path.join(cwd, file);
    const entityId = uuidv7();
    const hash = await byteHashFile(absPath);
    const [history, revision] = await Promise.all([
      getFileHistory(cwd, file),
      getFileRevisionFromHistory(cwd, file),
    ]);
    const now = new Date().toISOString();

    const record = {
      entityId,
      createdAt: history.createdAt ?? now,
      updatedAt: history.updatedAt ?? now,
      revision,
      contentHash: hash,
      gitSha: history.lastCommitSha ?? "unknown",
      status: "active" as const,
    };

    const repoDir = path.posix.dirname(file);
    const fileName = getManifestFileName(file);
    const manifest = manifests.get(repoDir) ?? createEmptyManifest(repoDir);
    upsertManifestRecord(manifest, fileName, record);
    manifests.set(repoDir, manifest);

    entities[entityId] = {
      currentPath: file,
      firstPath: file,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      revision: record.revision,
      contentHash: record.contentHash,
      gitSha: record.gitSha,
      status: "active",
      moves: [],
    };
    paths[file] = entityId;
  }

  for (const repoDir of grouped.keys()) {
    const manifest = manifests.get(repoDir);
    if (manifest) await saveDirectoryManifest(cwd, manifest);
  }

  await saveEntitiesById(cwd, entities);
  await savePathsCurrent(cwd, paths);
  await writeJsonFile(deletedLogPath(cwd), []);

  console.log("");
  console.log("Integrity init");
  console.log(`  managed files       ${files.length}`);
  console.log(`  managed directories ${grouped.size}`);
  console.log(`  registered entities ${Object.keys(entities).length}`);
}
