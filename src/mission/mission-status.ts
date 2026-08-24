/*
<MODULE_CONTRACT>
<purpose>RFC-0355 §5.2: mission.status — print mission manifest and Bordbuch entries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0355: initial mission.status command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { readMissionManifest } from "./mission-io.ts";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";

export interface MissionStatusData {
  manifest: Record<string, unknown>;
  bordbuchEntries: number;
  bordbuch: Array<Record<string, unknown>>;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runMissionStatus(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionStatusData>> {
  const { workspaceRoot, logger } = context;
  const missionId = flagString(input, "mission");

  if (!missionId) throw new Error("[mission.status] --mission is required");

  const manifest = await readMissionManifest(workspaceRoot, missionId);
  const entries = await readBordbuch(workspaceRoot, manifest.systemId);
  const missionEntries = entries.filter((e) => e.missionId === missionId);

  logger.info(`  Mission: ${manifest.missionId}`);
  logger.info(`  System:  ${manifest.systemId}`);
  logger.info(`  State:   ${manifest.state}`);
  logger.info(`  Opened:  ${manifest.openedAt} by ${manifest.openedBy}`);
  logger.info(`  Brief:   ${manifest.brief}`);
  if (manifest.closedAt) {
    logger.info(`  Closed:  ${manifest.closedAt} by ${manifest.closedBy}`);
  }
  logger.info(`  Bordbuch entries: ${missionEntries.length}`);

  return {
    data: {
      manifest: manifest as unknown as Record<string, unknown>,
      bordbuchEntries: missionEntries.length,
      bordbuch: missionEntries as Array<Record<string, unknown>>,
    },
    summary: `[mission.status] ${missionId}: state=${manifest.state}, ${missionEntries.length} Bordbuch entries`,
    nextSteps:
      manifest.state === "open"
        ? [
            {
              action: `Validate the mission: pnpm exec werkstatt run mission.validate --mission ${missionId}`,
              kind: "optional",
            },
          ]
        : undefined,
  };
}
