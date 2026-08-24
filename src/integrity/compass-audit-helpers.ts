/*
<MODULE_CONTRACT>
<purpose>Provides a revision-by-path lookup helper that wraps the integrity registry with a git-history fallback, for consumers like the Compass audit system (RFC-0352).</purpose>
<non-goals>
  <item>Do not compute a new per-file counter — reuse the existing integrity revision.</item>
  <item>Do not modify the registry or write any files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0352: initial implementation of getRevisionByPath helper.</item>
</CHANGE_SUMMARY>
*/

import { loadEntitiesById, loadPathsCurrent } from "./registry.ts";
import { getFileRevisionFromHistory } from "./git.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface RevisionByPathResult {
  revision: number;
  entityId: string | null;
  contentHash: string;
}

export async function getRevisionByPath(
  cwd: string,
  repoPath: string,
): Promise<RevisionByPathResult> {
  const paths = await loadPathsCurrent(cwd);
  const entityId = paths[repoPath];

  if (entityId) {
    const entities = await loadEntitiesById(cwd);
    const entity = entities[entityId];
    if (entity) {
      let contentHash = entity.contentHash;
      // Compute live hash if the file exists
      try {
        const abs = resolve(cwd, repoPath);
        const content = await readFile(abs, "utf8");
        contentHash = "sha256-" + createHash("sha256").update(content).digest("hex");
      } catch {
        // keep registry hash
      }
      return {
        revision: entity.revision,
        entityId,
        contentHash,
      };
    }
  }

  // Fallback: compute revision from git history
  const revision = await getFileRevisionFromHistory(cwd, repoPath);
  let contentHash = "";
  try {
    const abs = resolve(cwd, repoPath);
    const content = await readFile(abs, "utf8");
    contentHash = "sha256-" + createHash("sha256").update(content).digest("hex");
  } catch {
    // file may not exist
  }

  return { revision, entityId: null, contentHash };
}
