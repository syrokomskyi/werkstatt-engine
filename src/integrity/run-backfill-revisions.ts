/*
<MODULE_CONTRACT>
<purpose>Coordinates the backfilling of revision counts for tracked entities using Git history.</purpose>
<non-goals>
  <item>Do not handle entity creation or deletion beyond revision updates.</item>
  <item>Do not perform any operations related to transport or configuration orchestration.</item>
  <item>Do not parse raw content from files or directories.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Refined the backfill process to ensure accurate revision counts for tracked entities.</item>
</CHANGE_SUMMARY>
*/

/**
 * Annotation revision counts from Git history for all tracked entities.
 * Updates entities and manifests with accurate revision numbers.
 */

import path from "node:path";
import { getFileRevisionFromHistory } from "./git.ts";
import {
  getManifestFileName,
  loadDirectoryManifest,
  saveDirectoryManifest,
  upsertManifestRecord,
} from "./manifests.ts";
import { readJsonFile, writeJsonFile } from "./json.ts";
import { deletedLogPath } from "./paths.ts";
import { loadEntitiesById, loadPathsCurrent, saveEntitiesById } from "./registry.ts";
import type { DeletedLogItem } from "./types.ts";

export async function runBackfillRevisions(args: { cwd: string }): Promise<void> {
  const { cwd } = args;
  const entities = await loadEntitiesById(cwd);
  const paths = await loadPathsCurrent(cwd);
  const deletedLog = await readJsonFile<DeletedLogItem[]>(deletedLogPath(cwd)).catch(() => []);
  const deletedByEntityId = new Map(deletedLog.map((item) => [item.entityId, item]));
  const manifestCache = new Map<string, Awaited<ReturnType<typeof loadDirectoryManifest>>>();

  let updatedEntities = 0;
  let updatedActiveRecords = 0;
  let updatedDeletedLog = 0;

  for (const [entityId, entity] of Object.entries(entities)) {
    const repoPath = entity.currentPath;
    if (!repoPath) {
      continue;
    }

    const revision = await getFileRevisionFromHistory(cwd, repoPath);
    if (revision === entity.revision) {
      continue;
    }

    entity.revision = revision;
    updatedEntities += 1;

    const deletedItem = deletedByEntityId.get(entityId);
    if (deletedItem) {
      deletedItem.lastRevision = revision;
      updatedDeletedLog += 1;
    }

    if (entity.status !== "active" || paths[repoPath] !== entityId) {
      continue;
    }

    const repoDir = path.posix.dirname(repoPath);
    const fileName = getManifestFileName(repoPath);
    let manifest = manifestCache.get(repoDir);
    if (manifest === undefined) {
      manifest = await loadDirectoryManifest(cwd, repoDir);
      manifestCache.set(repoDir, manifest);
    }
    if (!manifest) {
      continue;
    }

    upsertManifestRecord(manifest, fileName, {
      entityId,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      revision: entity.revision,
      contentHash: entity.contentHash,
      gitSha: entity.gitSha,
      status: entity.status,
    });
    updatedActiveRecords += 1;
  }

  await saveEntitiesById(cwd, entities);
  await Promise.all(
    Array.from(manifestCache.values())
      .filter((manifest): manifest is NonNullable<typeof manifest> => Boolean(manifest))
      .map((manifest) => saveDirectoryManifest(cwd, manifest)),
  );

  if (updatedDeletedLog > 0) {
    await writeJsonFile(deletedLogPath(cwd), deletedLog);
  }

  console.log("");
  console.log("Integrity revision backfill");
  console.log(`  updated entities      ${updatedEntities}`);
  console.log(`  updated manifest rows ${updatedActiveRecords}`);
  console.log(`  updated deleted log   ${updatedDeletedLog}`);
}
