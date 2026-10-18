/*
<MODULE_CONTRACT>
  <purpose>Resolve the systemId a mission belongs to — shared by evidence.sync and evidence.fetch so the derivation can never diverge between the R2 upload prefix and its download reader.</purpose>
  <non-goals>
    <item>Do not open or validate the mission — resolution is a read-only lookup, never a lifecycle check.</item>
  </non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>mission.yaml wins over the currentMission scan: the manifest records the system at open and survives close/archive, while system-state.currentMission clears at close — a closed mission (the evidence.sync call site after ship) can only resolve through the manifest.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1324: initial — replaces the duplicated `split("-m")[0]` derivation that cut `e2e-valid-minimal-m000001` at the mid-slug "-m" to `e2e-valid`.</item>
  <item>RFC-1324: cold-run defect: evidence.sync/fetch resolveSystemId split on bare '-m' — e2e-valid-minimal-m000001 resolved to e2e-valid, SYSTEM_MISMATCH blocked post-close deploy; shared resolveSystemIdForMission reads mission.yaml first</item>
</CHANGE_SUMMARY>
*/

import { discoverSystems, readSystemState } from "../sternsystem/registry-io.ts";
import { readMissionManifest } from "../mission/mission-io.ts";
import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export async function resolveSystemIdForMission(
  workspaceRoot: string,
  missionId: string,
  io: WorkspaceIO,
): Promise<string> {
  try {
    const manifest = await readMissionManifest(workspaceRoot, missionId, io);
    if (manifest.systemId) return manifest.systemId;
  } catch {
    // Manifest absent or unreadable — fall through to scan/derivation.
  }
  const { systems } = await discoverSystems(workspaceRoot);
  for (const sys of systems) {
    try {
      const state = await readSystemState(workspaceRoot, sys.id);
      if (state.currentMission === missionId) return sys.id;
    } catch {
      // State not available for this system — skip
    }
  }
  // Last resort: strip the canonical -mNNNNNN mission suffix. Never split on
  // a bare "-m" — system slugs like `e2e-valid-minimal` contain it mid-word.
  const m = /^(.*)-m\d{6}$/.exec(missionId);
  return m ? m[1] : missionId;
}
