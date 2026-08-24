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

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { missionManifestSchema, type MissionManifest } from "@warpgogol/werkstatt-engine/schemas";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import { resolveMissionDir } from "@warpgogol/werkstatt-engine/kernel";

export { resolveMissionDir };

const MISSIONS_DIR = "missions";

export function resolveMissionManifestPath(workspaceRoot: string, missionId: string): string {
  return path.join(resolveMissionDir(workspaceRoot, missionId), "mission.yaml");
}

export async function readMissionManifest(
  workspaceRoot: string,
  missionId: string,
): Promise<MissionManifest> {
  const filePath = resolveMissionManifestPath(workspaceRoot, missionId);
  const raw = await fs.readFile(filePath, "utf8");
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

export async function missionExists(workspaceRoot: string, missionId: string): Promise<boolean> {
  return existsSync(resolveMissionManifestPath(workspaceRoot, missionId));
}

export async function createMissionDirectories(
  workspaceRoot: string,
  missionId: string,
): Promise<void> {
  const missionDir = resolveMissionDir(workspaceRoot, missionId);
  await fs.mkdir(path.join(missionDir, "workpiece"), { recursive: true });
  await fs.mkdir(path.join(missionDir, "evidence"), { recursive: true });
}

export function resolveMissionEvidenceDir(workspaceRoot: string, missionId: string): string {
  return path.join(resolveMissionDir(workspaceRoot, missionId), "evidence", "axiom");
}

export async function listMissionDirs(workspaceRoot: string, systemId?: string): Promise<string[]> {
  const missionsPath = path.join(workspaceRoot, MISSIONS_DIR);
  if (!existsSync(missionsPath)) return [];

  const entries = await fs.readdir(missionsPath, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && e.name !== "archive").map((e) => e.name);

  if (systemId) {
    return dirs.filter((d) => d.startsWith(`${systemId}-m`));
  }
  return dirs;
}
