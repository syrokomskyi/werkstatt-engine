/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/mission/mission-io.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0355: initial mission IO helpers.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
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

export async function resolveMissionManifestPath(
  workspaceRoot: string,
  missionId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string> {
  return path.join(await resolveMissionDir(workspaceRoot, missionId, io), "mission.yaml");
}

export async function readMissionManifest(
  workspaceRoot: string,
  missionId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<MissionManifest> {
  const filePath = await resolveMissionManifestPath(workspaceRoot, missionId, io);
  const raw = await io.readFile(filePath);
  const parsed = parseYaml(raw);
  return missionManifestSchema.parse(parsed);
}

export async function writeMissionManifest(
  workspaceRoot: string,
  manifest: MissionManifest,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const filePath = await resolveMissionManifestPath(workspaceRoot, manifest.missionId, io);
  const yaml = stringifyYaml(manifest);
  await atomicWriteFile(filePath, yaml + "\n");
}

export async function missionExists(
  workspaceRoot: string,
  missionId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<boolean> {
  return await io.exists(await resolveMissionManifestPath(workspaceRoot, missionId, io));
}

export async function createMissionDirectories(
  workspaceRoot: string,
  missionId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const missionDir = await resolveMissionDir(workspaceRoot, missionId, io);
  await io.mkdir(path.join(missionDir, "workpiece"));
  await io.mkdir(path.join(missionDir, "evidence"));
}

export async function resolveMissionEvidenceDir(
  workspaceRoot: string,
  missionId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string> {
  return path.join(await resolveMissionDir(workspaceRoot, missionId, io), "evidence", "axiom");
}

export async function listMissionDirs(
  workspaceRoot: string,
  systemId?: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string[]> {
  const missionsPath = path.join(workspaceRoot, MISSIONS_DIR);
  if (!(await io.exists(missionsPath))) return [];

  const entries = await io.readdir(missionsPath);
  const dirs = entries.filter((e) => e.isDirectory && e.name !== "archive").map((e) => e.name);

  if (systemId) {
    return dirs.filter((d) => d.startsWith(`${systemId}-m`));
  }
  return dirs;
}
