/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/mission/mission-io.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0355: initial mission IO helpers.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { missionManifestSchema, type MissionManifest } from "@warpgogol/werkstatt-engine/schemas";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import { resolveMissionDir } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export { resolveMissionDir };

const MISSIONS_DIR = "missions";

export function resolveMissionManifestPath(workspaceRoot: string, missionId: string): string {
  return path.join(resolveMissionDir(workspaceRoot, missionId), "mission.yaml");
}

export async function readMissionManifest(
  workspaceRoot: string,
  missionId: string, io: WorkspaceIO = createDefaultIO().io,
): Promise<MissionManifest> {
  const filePath = resolveMissionManifestPath(workspaceRoot, missionId);
  const raw = await io.readFile(filePath);
  const parsed = parseYaml(raw);
  return missionManifestSchema.parse(parsed);
}

export async function writeMissionManifest(
  workspaceRoot: string,
  manifest: MissionManifest,
): Promise<void> {
  const filePath = resolveMissionManifestPath(workspaceRoot, manifest.missionId);
  const yaml = stringifyYaml(manifest);
  await atomicWriteFile(filePath, yaml + "\n");
}

export async function missionExists(workspaceRoot: string, missionId: string, io: WorkspaceIO = createDefaultIO().io): Promise<boolean> {
  return await io.exists(resolveMissionManifestPath(workspaceRoot, missionId));
}

export async function createMissionDirectories(
  workspaceRoot: string,
  missionId: string, io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const missionDir = resolveMissionDir(workspaceRoot, missionId);
  await io.mkdir(path.join(missionDir, "workpiece"));
  await io.mkdir(path.join(missionDir, "evidence"));
}

export function resolveMissionEvidenceDir(workspaceRoot: string, missionId: string): string {
  return path.join(resolveMissionDir(workspaceRoot, missionId), "evidence", "axiom");
}

export async function listMissionDirs(workspaceRoot: string, systemId?: string, io: WorkspaceIO = createDefaultIO().io): Promise<string[]> {
  const missionsPath = path.join(workspaceRoot, MISSIONS_DIR);
  if (!await io.exists(missionsPath)) return [];

  const entries = await io.readdir(missionsPath);
  const dirs = entries.filter((e) => e.isDirectory && e.name !== "archive").map((e) => e.name);

  if (systemId) {
    return dirs.filter((d) => d.startsWith(`${systemId}-m`));
  }
  return dirs;
}
