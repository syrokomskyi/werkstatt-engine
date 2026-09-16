/*
<MODULE_CONTRACT>
<purpose>Enables identification of file moves and renames by comparing content hashes, supporting integrity verification.</purpose>
<non-goals>
  <item>Do not perform raw content parsing or analysis beyond hash computation.</item>
  <item>Do not manage file system state or configurations outside of move detection.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
