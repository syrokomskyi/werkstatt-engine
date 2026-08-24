/*
<MODULE_CONTRACT>
<purpose>
Site workspace resolver: resolves a site id to its runnable workspace across transitional
apps/<id> directories and materialized mission workpieces missions/<missionId>/workpiece/.
</purpose>
<non-goals>
  <item>Do not define mission lifecycle or materialization semantics — that is RFC-0355/RFC-0356.</item>
  <item>Do not manage fleet registry state — that is system-config.yaml ownership.</item>
  <item>Do not handle deployment or propagation — that is RFC-0379.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0378: initial creation of the site workspace resolver seam.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import { fileExists } from "@warpgogol/werkstatt-shared/share/fs";
import { discoverSystems, readSystemState } from "../sternsystem/registry-io.ts";
import type { DiscoveredSiteWorkspace } from "./types.ts";
// @ai-invariant: The resolver must refuse dual representation — a site existing as both apps/<id> and a mission workpiece is an error, not a fallback.

export type SiteWorkspaceSource = "apps" | "mission";

export interface SiteWorkspace extends DiscoveredSiteWorkspace {
  source: SiteWorkspaceSource;
  missionId: string | null;
}

const APP_CONFIG_FILENAMES = [
  "kernel.config.ts",
  "kernel.config.mts",
  "kernel.config.js",
  "kernel.config.mjs",
] as const;

function shouldIgnoreName(name: string): boolean {
  return name.startsWith("-") || name.startsWith("old-");
}

async function readPackageName(packageJsonPath: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const data = JSON.parse(raw) as { name?: unknown };
    return typeof data.name === "string" ? data.name : undefined;
  } catch {
    return undefined;
  }
}

async function resolveConfigPath(directory: string): Promise<string | null> {
  const toolsDirectory = path.join(directory, "tools");
  for (const filename of APP_CONFIG_FILENAMES) {
    const filePath = path.join(toolsDirectory, filename);
    if (await fileExists(filePath)) return filePath;
  }
  return null;
}

interface SystemInfo {
  id: string;
  currentMission?: string;
}

async function discoverSystemInfos(workspaceRoot: string): Promise<SystemInfo[]> {
  const { systems } = await discoverSystems(workspaceRoot);
  const infos: SystemInfo[] = [];
  for (const sys of systems) {
    let currentMission: string | undefined;
    try {
      const state = await readSystemState(workspaceRoot, sys.id);
      currentMission = state.currentMission ?? undefined;
    } catch {
      // State not available
    }
    infos.push({ id: sys.id, currentMission });
  }
  return infos;
}

async function tryResolveMissionWorkpiece(
  workspaceRoot: string,
  info: SystemInfo,
): Promise<SiteWorkspace | null> {
  if (!info.currentMission) return null;
  const workpieceDir = path.join(workspaceRoot, "missions", info.currentMission, "workpiece");
  if (!(await fileExists(path.join(workpieceDir, "package.json")))) return null;
  const configPath = await resolveConfigPath(workpieceDir);
  const packageName = await readPackageName(path.join(workpieceDir, "package.json"));
  return {
    name: info.id,
    source: "mission",
    directory: workpieceDir,
    toolsDirectory: path.join(workpieceDir, "tools"),
    missionId: info.currentMission,
    configPath: configPath ?? undefined,
    packageName,
  };
}

async function tryResolveAppsDirectory(
  workspaceRoot: string,
  siteId: string,
): Promise<SiteWorkspace | null> {
  const appDir = path.join(workspaceRoot, "apps", siteId);
  if (!(await fileExists(path.join(appDir, "package.json")))) return null;
  const configPath = await resolveConfigPath(appDir);
  const packageName = await readPackageName(path.join(appDir, "package.json"));
  return {
    name: siteId,
    source: "apps",
    directory: appDir,
    toolsDirectory: path.join(appDir, "tools"),
    missionId: null,
    configPath: configPath ?? undefined,
    packageName,
  };
}

export async function resolveSiteWorkspace(
  workspaceRoot: string,
  siteId: string,
): Promise<SiteWorkspace> {
  const infos = await discoverSystemInfos(workspaceRoot);
  const info = infos.find((i) => i.id === siteId);
  const missionWorkspace = info ? await tryResolveMissionWorkpiece(workspaceRoot, info) : null;
  const appsWorkspace = await tryResolveAppsDirectory(workspaceRoot, siteId);

  if (missionWorkspace && appsWorkspace) {
    if (info?.currentMission) {
      return missionWorkspace;
    }
    throw new Error(
      `dual-representation: site "${siteId}" exists both as apps/${siteId} and as mission workpiece missions/${missionWorkspace.missionId}/workpiece. RFC-0354 §6.4 forbids dual representation. Remove one before proceeding.`,
    );
  }

  if (missionWorkspace) return missionWorkspace;
  if (appsWorkspace) return appsWorkspace;

  const resolvable = await discoverSiteWorkspaces(workspaceRoot);
  const known = resolvable.map((ws) => ws.name).join(", ");
  throw new Error(`Unknown site id "${siteId}". Resolvable sites: ${known || "(none)"}`);
}

export async function discoverSiteWorkspaces(workspaceRoot: string): Promise<SiteWorkspace[]> {
  const infos = await discoverSystemInfos(workspaceRoot);
  const results: SiteWorkspace[] = [];
  const seen = new Set<string>();

  // Mission workpieces from discovered systems
  for (const info of infos) {
    const ws = await tryResolveMissionWorkpiece(workspaceRoot, info);
    if (ws) {
      results.push(ws);
      seen.add(info.id);
    }
  }

  // Transitional apps/ discovery
  const appsRoot = path.join(workspaceRoot, "apps");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(appsRoot, { withFileTypes: true, encoding: "utf8" });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || shouldIgnoreName(entry.name)) continue;
    if (seen.has(entry.name)) {
      // Dual representation: both mission workpiece and apps/<id> exist.
      // When the registry entry has currentMission set, the mission workpiece
      // wins (mirrors resolveSiteWorkspace logic). Otherwise this is a real
      // dual-representation error (RFC-0354 §6.4).
      const sysInfo = infos.find((r) => r.id === entry.name);
      if (sysInfo?.currentMission) continue;
      const missionWs = results.find((ws) => ws.name === entry.name);
      throw new Error(
        `dual-representation: site "${entry.name}" exists both as apps/${entry.name} and as mission workpiece missions/${missionWs?.missionId}/workpiece. RFC-0354 §6.4 forbids dual representation.`,
      );
    }
    const ws = await tryResolveAppsDirectory(workspaceRoot, entry.name);
    if (ws) results.push(ws);
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
