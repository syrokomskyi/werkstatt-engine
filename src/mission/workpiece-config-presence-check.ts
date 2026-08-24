/*
<MODULE_CONTRACT>
<purpose>
RFC-0844: workpiece.config.presence.check command handler — pre-build gate
that verifies all OPERATOR_CONFIG_FILES entries are present in the active
mission's workpiece directory before the build pipeline starts. Returns
pass/fail status with restore commands for missing files.
</purpose>
<non-goals>
  <item>Do not validate file contents — only presence (existsSync).</item>
  <item>Do not make the check fatal if the command itself throws in mission.validate — follow non-fatal pattern from RFC-0813.</item>
  <item>Do not add new files to OPERATOR_CONFIG_FILES — that requires a superseding RFC.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0844: initial workpiece.config.presence.check command handler.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { OPERATOR_CONFIG_FILES } from "./operator-config-files.ts";
import { resolveMissionDir } from "./mission-io.ts";

export interface WorkpieceConfigPresenceResult {
  command: "workpiece.config.presence.check";
  status: "pass" | "fail";
  missionId: string;
  missing: Array<{
    file: string;
    restoreCommand: string;
  }>;
  present: string[];
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function resolveSystemId(missionId: string): string {
  const match = missionId.match(/^(.+)-m\d+$/);
  return match ? match[1] : missionId;
}

function buildRestoreCommand(entry: string, systemId: string, missionId: string): string {
  const cachePath = `../systems-cache/${systemId}/${entry}`;
  const workpiecePath = `missions/${missionId}/workpiece/${entry}`;
  const targetDir = path.dirname(`missions/${missionId}/workpiece/${entry}`);
  if (entry.includes("/")) {
    return `mkdir -p ${targetDir} && cp ${cachePath} ${workpiecePath}`;
  }
  return `cp ${cachePath} ${workpiecePath}`;
}

export async function runWorkpieceConfigPresenceCheck(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<WorkpieceConfigPresenceResult>> {
  const { workspaceRoot } = context;
  const missionId = flagString(input, "mission");
  if (!missionId) throw new Error("[workpiece.config.presence.check] --mission is required");

  const missionDir = resolveMissionDir(workspaceRoot, missionId);
  const workpieceDir = path.join(missionDir, "workpiece");

  if (!existsSync(workpieceDir)) {
    return {
      data: {
        command: "workpiece.config.presence.check",
        status: "fail",
        missionId,
        missing: [],
        present: [],
      },
      exitCode: 1,
      summary: `Workpiece directory not found: missions/${missionId}/workpiece/`,
    };
  }

  const systemId = resolveSystemId(missionId);
  const missing: Array<{ file: string; restoreCommand: string }> = [];
  const present: string[] = [];

  for (const entry of OPERATOR_CONFIG_FILES) {
    const fullPath = path.join(workpieceDir, entry);
    if (existsSync(fullPath)) {
      present.push(entry);
    } else {
      missing.push({
        file: entry,
        restoreCommand: buildRestoreCommand(entry, systemId, missionId),
      });
    }
  }

  const status: WorkpieceConfigPresenceResult["status"] =
    missing.length > 0 ? "fail" : "pass";

  return {
    data: {
      command: "workpiece.config.presence.check",
      status,
      missionId,
      missing,
      present,
    },
    exitCode: missing.length > 0 ? 1 : 0,
    summary:
      missing.length > 0
        ? `Missing operator config files: ${missing.map((m) => m.file).join(", ")}`
        : "All operator config files present",
  };
}
