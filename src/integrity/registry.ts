/*
<MODULE_CONTRACT>
<purpose>Facilitates management of entity and path registries for integrity tracking.</purpose>
<non-goals>
  <item>Do not handle raw content parsing or validation.</item>
  <item>Do not manage transport or configuration orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

/**
 * Entity and path registry management for integrity tracking.
 * Manages the central entity-by-id and paths-current indexes.
 */

import { pathExists } from "./fs.ts";
import { readJsonFile, writeJsonFile } from "./json.ts";
import { currentPathsPath, entitiesByIdPath } from "./paths.ts";
import type { EntitiesById, PathsCurrent } from "./types.ts";

export async function loadEntitiesById(cwd: string): Promise<EntitiesById> {
  const filePath = entitiesByIdPath(cwd);
  if (!(await pathExists(filePath))) return {};
  return readJsonFile<EntitiesById>(filePath);
}

export async function saveEntitiesById(cwd: string, value: EntitiesById): Promise<void> {
  await writeJsonFile(entitiesByIdPath(cwd), value);
}

export async function loadPathsCurrent(cwd: string): Promise<PathsCurrent> {
  const filePath = currentPathsPath(cwd);
  if (!(await pathExists(filePath))) return {};
  return readJsonFile<PathsCurrent>(filePath);
}

export async function savePathsCurrent(cwd: string, value: PathsCurrent): Promise<void> {
  await writeJsonFile(currentPathsPath(cwd), value);
}

export function bindPath(
  entities: EntitiesById,
  paths: PathsCurrent,
  entityId: string,
  repoPath: string,
): void {
  const previousPath = entities[entityId]?.currentPath;
  if (previousPath && previousPath !== repoPath) {
    delete paths[previousPath];
  }
  paths[repoPath] = entityId;
  if (entities[entityId]) {
    entities[entityId].currentPath = repoPath;
  }
}

export function unbindPath(entities: EntitiesById, paths: PathsCurrent, repoPath: string): void {
  const entityId = paths[repoPath];
  delete paths[repoPath];
  if (entityId && entities[entityId]) {
    entities[entityId].status = "deleted";
  }
}
