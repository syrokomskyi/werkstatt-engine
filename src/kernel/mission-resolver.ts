/*
<MODULE_CONTRACT>
  <purpose>Resolve mission directory paths from workspace root — shared by site-kernel-checks and site-kernel-handoff.</purpose>
  <non-goals>
    <item>Do not include manifest reading or writing — those stay in site-kernel-handoff/mission/mission-io.ts.</item>
  </non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Mission paths resolve from workspace root only — no ambient state is consulted.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import path from "node:path";

const MISSIONS_DIR = "missions";

export function resolveMissionDir(workspaceRoot: string, missionId: string): string {
  const primary = path.join(workspaceRoot, MISSIONS_DIR, missionId);
  if (existsSync(primary)) return primary;

  for (const state of ["closed", "aborted"]) {
    const archived = path.join(workspaceRoot, MISSIONS_DIR, "archive", state, missionId);
    if (existsSync(archived)) return archived;
  }

  return primary;
}
