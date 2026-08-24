/*
<MODULE_CONTRACT>
<purpose>
RFC-0555: workpiece.read — read a file from a mission workpiece with DNA-22
path validation. The command loads the mission manifest, resolves the workpiece
root, validates the requested path against the client-editable surface, and
returns the file content.
</purpose>
<non-goals>
  <item>Does not auto-commit — LLMs must call mission.git.commit separately.</item>
  <item>Does not handle system.md partial field edits — future enhancement.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0555: initial workpiece.read command handler.</item>
</CHANGE_SUMMARY>
*/

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { readMissionManifest, resolveMissionDir } from "../mission/mission-io.ts";
import { isClientEditable } from "./dna-22-checker.ts";

export interface WorkpieceReadResult {
  path: string;
  content: string;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

export async function runWorkpieceRead(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<WorkpieceReadResult>> {
  const missionId = flagString(input, "mission");
  const relativePath = flagString(input, "path");

  if (!missionId) {
    throw new Error("[workpiece.read] --mission flag is required");
  }
  if (!relativePath) {
    throw new Error("[workpiece.read] --path flag is required");
  }

  const { workspaceRoot, logger } = context;

  const manifestPath = path.join(resolveMissionDir(workspaceRoot, missionId), "mission.yaml");
  if (!existsSync(manifestPath)) {
    throw new Error(`[workpiece.read] Mission '${missionId}' is not open or does not exist`);
  }

  const manifest = await readMissionManifest(workspaceRoot, missionId);
  if (manifest.state !== "open") {
    throw new Error(
      `[workpiece.read] Mission '${missionId}' is not open (state: ${manifest.state})`,
    );
  }

  const workpieceDir = path.join(resolveMissionDir(workspaceRoot, missionId), "workpiece");
  if (!existsSync(workpieceDir)) {
    throw new Error(
      `[workpiece.read] Workpiece for mission '${missionId}' not found. Run mission.materialize first.`,
    );
  }

  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const resolvedPath = path.resolve(workpieceDir, normalizedPath);
  if (!resolvedPath.startsWith(workpieceDir)) {
    throw new Error("[workpiece.read] Path traversal detected");
  }

  const allowed = await isClientEditable(workpieceDir, normalizedPath);
  if (!allowed) {
    throw new Error(`Path '${normalizedPath}' is outside client-editable surface (DNA-22)`);
  }

  if (!existsSync(resolvedPath)) {
    throw new Error(`[workpiece.read] File not found: ${normalizedPath}`);
  }

  const content = await readFile(resolvedPath, "utf8");
  logger.info(`[workpiece.read] ${missionId}: read ${normalizedPath}`);

  return {
    data: { path: normalizedPath, content },
    exitCode: 0,
  };
}
