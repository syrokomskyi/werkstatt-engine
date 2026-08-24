/*
<MODULE_CONTRACT>
<purpose>RFC-0355 §5.5: mission.list — list missions, optionally filtered by system.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0355: initial mission.list command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { listMissionDirs, readMissionManifest } from "./mission-io.ts";
import type { MissionManifest } from "@warpgogol/werkstatt-engine/schemas";

export interface MissionListData {
  missions: Array<{
    missionId: string;
    systemId: string;
    state: string;
    openedAt: string;
    closedAt: string | null;
    brief: string;
  }>;
  count: number;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runMissionList(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionListData>> {
  const { workspaceRoot, logger } = context;
  const systemId = flagString(input, "system");

  const dirs = await listMissionDirs(workspaceRoot, systemId);
  const missions: Array<{
    missionId: string;
    systemId: string;
    state: string;
    openedAt: string;
    closedAt: string | null;
    brief: string;
  }> = [];

  for (const dir of dirs) {
    try {
      const manifest: MissionManifest = await readMissionManifest(workspaceRoot, dir);
      missions.push({
        missionId: manifest.missionId,
        systemId: manifest.systemId,
        state: manifest.state,
        openedAt: manifest.openedAt,
        closedAt: manifest.closedAt,
        brief: manifest.brief,
      });
    } catch {
      // skip unreadable manifests
    }
  }

  for (const m of missions) {
    logger.info(`  ${m.missionId.padEnd(32)} ${m.state.padEnd(8)} ${m.brief}`);
  }

  return {
    data: { missions, count: missions.length },
    summary: `[mission.list] ${missions.length} mission${missions.length === 1 ? "" : "s"} found`,
    nextSteps:
      missions.length === 0
        ? [
            {
              action: `Open a mission: pnpm exec werkstatt run mission.open --system <system-id> --brief "<brief>"`,
              kind: "optional",
            },
          ]
        : undefined,
  };
}
