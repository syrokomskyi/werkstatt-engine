/*
<MODULE_CONTRACT>
<purpose>Enables identification of file moves and renames by comparing content hashes, supporting integrity verification.</purpose>
<non-goals>
  <item>Do not perform raw content parsing or analysis beyond hash computation.</item>
  <item>Do not manage file system state or configurations outside of move detection.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Refine Compass scaffolding to accurately reflect the file's architectural role and responsibilities.</item>
  <item>Migrated sha256FileHex from deleted ./hash.ts to byteHashFile from @warpgogol/fingerprint directly.</item>
</CHANGE_SUMMARY>
*/

/**
 * Detect file moves and renames by matching content hashes.
 * Matches deleted and added files to identify moves without content changes.
 */

import path from "node:path";
import { byteHashFile } from "@warpgogol/werkstatt-engine/fingerprint";
import { loadEntitiesById } from "./registry.ts";
import type { MoveCandidate } from "./types.ts";

export async function detectMoves(args: {
  cwd: string;
  deletedPaths: string[];
  addedPaths: string[];
}): Promise<MoveCandidate[]> {
  const { cwd, deletedPaths, addedPaths } = args;
  if (!deletedPaths.length || !addedPaths.length) return [];

  const entities = await loadEntitiesById(cwd);
  const deletedByHash = new Map<string, { entityId: string; from: string }>();

  for (const from of deletedPaths) {
    const entityId = Object.keys(entities).find((id) => entities[id]?.currentPath === from);
    if (!entityId) continue;
    const hash = entities[entityId]?.contentHash;
    if (!hash) continue;
    deletedByHash.set(hash, { entityId, from });
  }

  const moves: MoveCandidate[] = [];
  for (const to of addedPaths) {
    const absPath = path.join(cwd, to);
    const hash = await byteHashFile(absPath).catch(() => null);
    if (!hash) continue;
    const match = deletedByHash.get(hash);
    if (!match) continue;
    moves.push({
      entityId: match.entityId,
      from: match.from,
      to,
      confidence: 1,
      method: "same-hash",
    });
  }

  return moves;
}
