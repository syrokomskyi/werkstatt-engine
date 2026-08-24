/*
<MODULE_CONTRACT>
  <purpose>Resolve mission directory paths from workspace root — shared by site-kernel-checks and site-kernel-handoff.</purpose>
  <non-goals>
    <item>Do not include manifest reading or writing — those stay in site-kernel-handoff/mission/mission-io.ts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Extracted from site-kernel-handoff/src/mission/mission-io.ts to break cyclic dependency (ADR-0015).</item>
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
