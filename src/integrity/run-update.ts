/* 
<MODULE_CONTRACT>
<purpose>Facilitates the synchronization of integrity manifests with file system changes.</purpose>
<non-goals>
  <item>Do not handle raw file parsing or content validation.</item>
  <item>Do not manage external configuration or transport orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Migrated sha256FileHex from deleted ./hash.ts to byteHashFile from @warpgogol/fingerprint directly.</item>
</CHANGE_SUMMARY>
*/

/**
 * Update integrity manifests after file system changes.
 * Processes Git changes to update entities, manifests, and path bindings.
 */

import path from "node:path";
import { byteHashFile } from "@warpgogol/werkstatt-engine/fingerprint";
import { discoverManagedFiles } from "./discover.ts";
import { getChangedPaths, getFileHistory } from "./git.ts";
import { readJsonFile, writeJsonFile } from "./json.ts";
import {
  createEmptyManifest,
  getManifestFileName,
  loadDirectoryManifest,
  removeManifestRecord,
  saveDirectoryManifest,
  upsertManifestRecord,
} from "./manifests.ts";
import { deletedLogPath } from "./paths.ts";
import {
  loadEntitiesById,
  loadPathsCurrent,
  saveEntitiesById,
  savePathsCurrent,
} from "./registry.ts";
import { detectMoves } from "./move-detection.ts";
import { v7 as uuidv7 } from "uuid";
import type {
  DeletedLogItem,
  DirectoryManifest,
  EntitiesById,
  ManifestFileRecord,
  MoveCandidate,
  PathsCurrent,
  RegistryEntity,
} from "./types.ts";

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

async function findOutOfSyncActivePaths(args: {
  cwd: string;
  entities: EntitiesById;
  paths: PathsCurrent;
  currentManagedFiles: string[];
}): Promise<string[]> {
  const { cwd, entities, paths, currentManagedFiles } = args;
  const outOfSyncPaths: string[] = [];

  for (const repoPath of currentManagedFiles) {
    const entityId = paths[repoPath];
    if (!entityId) {
      continue;
    }

    const entity = entities[entityId];
    if (!entity || entity.status !== "active") {
      continue;
    }

    const actualHash = await byteHashFile(path.join(cwd, repoPath)).catch(() => null);
    if (!actualHash || actualHash === entity.contentHash) {
      continue;
    }

    outOfSyncPaths.push(repoPath);
  }

  return outOfSyncPaths;
}

function entityToManifestRecord(entityId: string, entity: RegistryEntity): ManifestFileRecord {
  return {
    entityId,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    revision: entity.revision,
    contentHash: entity.contentHash,
    gitSha: entity.gitSha,
    status: entity.status,
  };
}

async function loadDeletedLog(cwd: string): Promise<DeletedLogItem[]> {
  return readJsonFile<DeletedLogItem[]>(deletedLogPath(cwd)).catch(() => []);
}

function createManifestStore(cwd: string) {
  const cache = new Map<string, DirectoryManifest>();

  return {
    async get(repoDir: string): Promise<DirectoryManifest> {
      const existing = cache.get(repoDir);
      if (existing) return existing;
      const loaded = (await loadDirectoryManifest(cwd, repoDir)) ?? createEmptyManifest(repoDir);
      cache.set(repoDir, loaded);
      return loaded;
    },
    async saveAll(): Promise<void> {
      for (const manifest of cache.values()) {
        await saveDirectoryManifest(cwd, manifest);
      }
    },
  };
}

async function moveEntity(args: {
  cwd: string;
  entities: EntitiesById;
  paths: PathsCurrent;
  manifestStore: ReturnType<typeof createManifestStore>;
  move: MoveCandidate;
}): Promise<void> {
  const { cwd, entities, paths, manifestStore, move } = args;
  const entity = entities[move.entityId];
  if (!entity) return;

  const oldPath = move.from;
  const newPath = move.to;
  const oldHash = entity.contentHash;
  const absNewPath = path.join(cwd, newPath);
  const nextHash = await byteHashFile(absNewPath).catch(() => oldHash);
  const history = await getFileHistory(cwd, newPath);
  const now = new Date().toISOString();
  const isContentChange = nextHash !== oldHash;

  entity.currentPath = newPath;
  entity.status = "active";
  entity.gitSha = history.lastCommitSha ?? entity.gitSha;

  if (isContentChange) {
    entity.contentHash = nextHash;
    entity.updatedAt = history.updatedAt ?? now;
    entity.revision += 1;
  }

  entity.moves = entity.moves ?? [];
  entity.moves.push({
    from: oldPath,
    to: newPath,
    detectedAt: now,
    confidence: move.confidence,
    method: move.method,
  });

  delete paths[oldPath];
  paths[newPath] = move.entityId;

  const oldDir = path.posix.dirname(oldPath);
  const newDir = path.posix.dirname(newPath);
  const oldFileName = getManifestFileName(oldPath);
  const newFileName = getManifestFileName(newPath);

  const oldManifest = await manifestStore.get(oldDir);
  removeManifestRecord(oldManifest, oldFileName);

  const newManifest = await manifestStore.get(newDir);
  upsertManifestRecord(newManifest, newFileName, entityToManifestRecord(move.entityId, entity));
}

async function markDeleted(args: {
  entities: EntitiesById;
  paths: PathsCurrent;
  deletedLog: DeletedLogItem[];
  manifestStore: ReturnType<typeof createManifestStore>;
  repoPath: string;
}): Promise<void> {
  const { entities, paths, deletedLog, manifestStore, repoPath } = args;
  const entityId = paths[repoPath];
  if (!entityId) return;
  const entity = entities[entityId];
  if (!entity) return;

  entity.status = "deleted";
  delete paths[repoPath];

  deletedLog.push({
    entityId,
    lastPath: repoPath,
    deletedAt: new Date().toISOString(),
    lastRevision: entity.revision,
    lastHash: entity.contentHash,
  });

  const repoDir = path.posix.dirname(repoPath);
  const fileName = getManifestFileName(repoPath);
  const manifest = await manifestStore.get(repoDir);
  removeManifestRecord(manifest, fileName);
}

async function addNewEntity(args: {
  cwd: string;
  entities: EntitiesById;
  paths: PathsCurrent;
  manifestStore: ReturnType<typeof createManifestStore>;
  repoPath: string;
}): Promise<void> {
  const { cwd, entities, paths, manifestStore, repoPath } = args;
  const absPath = path.join(cwd, repoPath);
  const hash = await byteHashFile(absPath);
  const history = await getFileHistory(cwd, repoPath);
  const now = new Date().toISOString();
  const entityId = uuidv7();

  entities[entityId] = {
    currentPath: repoPath,
    firstPath: repoPath,
    createdAt: history.createdAt ?? now,
    updatedAt: history.updatedAt ?? now,
    revision: 1,
    contentHash: hash,
    gitSha: history.lastCommitSha ?? "unknown",
    status: "active",
    moves: [],
  };

  paths[repoPath] = entityId;

  const repoDir = path.posix.dirname(repoPath);
  const fileName = getManifestFileName(repoPath);
  const manifest = await manifestStore.get(repoDir);
  upsertManifestRecord(manifest, fileName, entityToManifestRecord(entityId, entities[entityId]));
}

async function updateModifiedEntity(args: {
  cwd: string;
  entities: EntitiesById;
  paths: PathsCurrent;
  manifestStore: ReturnType<typeof createManifestStore>;
  repoPath: string;
}): Promise<void> {
  const { cwd, entities, paths, manifestStore, repoPath } = args;
  const entityId = paths[repoPath];
  if (!entityId) return;
  const entity = entities[entityId];
  if (!entity || entity.status !== "active") return;

  const absPath = path.join(cwd, repoPath);
  const nextHash = await byteHashFile(absPath);
  if (nextHash === entity.contentHash) return;

  const history = await getFileHistory(cwd, repoPath);
  entity.contentHash = nextHash;
  entity.updatedAt = history.updatedAt ?? new Date().toISOString();
  entity.gitSha = history.lastCommitSha ?? entity.gitSha;
  entity.revision += 1;

  const repoDir = path.posix.dirname(repoPath);
  const fileName = getManifestFileName(repoPath);
  const manifest = await manifestStore.get(repoDir);
  upsertManifestRecord(manifest, fileName, entityToManifestRecord(entityId, entity));
}

export async function runUpdate(args: { cwd: string; baseRef?: string }): Promise<void> {
  const { cwd, baseRef } = args;
  const entities = await loadEntitiesById(cwd);
  const paths = await loadPathsCurrent(cwd);
  const deletedLog = await loadDeletedLog(cwd);
  const manifestStore = createManifestStore(cwd);

  const currentManagedFiles = await discoverManagedFiles(cwd);
  const currentManagedSet = new Set(currentManagedFiles);
  const changes = await getChangedPaths(cwd, baseRef);
  const outOfSyncActivePaths = await findOutOfSyncActivePaths({
    cwd,
    entities,
    paths,
    currentManagedFiles,
  });

  const activePaths = Object.entries(paths)
    .filter(([, entityId]) => entities[entityId]?.status === "active")
    .map(([repoPath]) => repoPath)
    .sort((a, b) => a.localeCompare(b));

  const deletedCandidates = uniqueSorted([
    ...changes.deleted,
    ...activePaths.filter((repoPath) => !currentManagedSet.has(repoPath)),
  ]).filter((repoPath) => paths[repoPath]);

  const addedCandidates = uniqueSorted([
    ...changes.added,
    ...currentManagedFiles.filter((repoPath) => !paths[repoPath]),
  ]).filter((repoPath) => currentManagedSet.has(repoPath));

  const modifiedCandidates = uniqueSorted([
    ...changes.modified,
    ...changes.renamed.map((item) => item.to),
    ...outOfSyncActivePaths,
  ]).filter((repoPath) => currentManagedSet.has(repoPath) && Boolean(paths[repoPath]));

  const matchedDeleted = new Set<string>();
  const matchedAdded = new Set<string>();

  const explicitMoves: MoveCandidate[] = changes.renamed
    .filter(({ from, to }) => Boolean(paths[from]) && currentManagedSet.has(to))
    .map(({ from, to }) => ({
      entityId: paths[from],
      from,
      to,
      confidence: 1,
      method: "heuristic",
    }));

  for (const move of explicitMoves) {
    if (matchedDeleted.has(move.from) || matchedAdded.has(move.to)) continue;
    await moveEntity({ cwd, entities, paths, manifestStore, move });
    matchedDeleted.add(move.from);
    matchedAdded.add(move.to);
  }

  const inferredMoves = await detectMoves({
    cwd,
    deletedPaths: deletedCandidates.filter((repoPath) => !matchedDeleted.has(repoPath)),
    addedPaths: addedCandidates.filter((repoPath) => !matchedAdded.has(repoPath)),
  });

  for (const move of inferredMoves) {
    if (matchedDeleted.has(move.from) || matchedAdded.has(move.to)) continue;
    await moveEntity({ cwd, entities, paths, manifestStore, move });
    matchedDeleted.add(move.from);
    matchedAdded.add(move.to);
  }

  for (const repoPath of deletedCandidates) {
    if (matchedDeleted.has(repoPath)) continue;
    await markDeleted({ entities, paths, deletedLog, manifestStore, repoPath });
  }

  for (const repoPath of addedCandidates) {
    if (matchedAdded.has(repoPath)) continue;
    await addNewEntity({ cwd, entities, paths, manifestStore, repoPath });
  }

  for (const repoPath of modifiedCandidates) {
    if (!paths[repoPath]) continue;
    await updateModifiedEntity({ cwd, entities, paths, manifestStore, repoPath });
  }

  await manifestStore.saveAll();
  await saveEntitiesById(cwd, entities);
  await savePathsCurrent(cwd, paths);
  await writeJsonFile(deletedLogPath(cwd), deletedLog);

  console.log("");
  console.log("Integrity update");
  console.log(`  base ref  ${baseRef ?? "(working tree)"}`);
  console.log(`  added     ${addedCandidates.length - matchedAdded.size}`);
  console.log(`  deleted   ${deletedCandidates.length - matchedDeleted.size}`);
  console.log(`  moved     ${matchedAdded.size}`);
  console.log(`  modified  ${modifiedCandidates.length}`);
}
