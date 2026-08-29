/*
<MODULE_CONTRACT>
<purpose>
RFC-0790: Convention-based discovery IO helpers. Replaces registry-based readRegistry/writeRegistry
with per-system system-config.yaml and system-state.yaml in cache clones.
RFC-0574: mirror path resolution helpers (preserved, signature updated for SystemConfig).
RFC-0751: findServiceEntry helper (preserved, reads from services/registry.yaml).
</purpose>
<non-goals>
  <item>Do not implement command logic — that lives in the individual command files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0354: initial registry IO helpers.</item>
  <item>RFC-0574: add resolveMirrors() and resolveCachePath() for parameterized mirror topology.</item>
  <item>RFC-0751: add findServiceEntry() helper for service registry lookups.</item>
  <item>RFC-0790: replace registry IO with convention-based discovery. Add resolveCacheClonePath, readSystemConfig, readSystemState, writeSystemState, discoverSystems, readServicesRegistry. Remove readRegistry, writeRegistry, findEntry, findEntryByStar, resolveCachePath, registryExists, resolveRegistryPath. Change resolveMirrors to accept SystemConfig.</item>
  <item>ADR-0040: add JSDoc return-type contracts to path-returning functions (resolveCacheClonePath, resolveWorkpiecePath, resolveMirrorPath).</item>
  <item>RFC-0794: push system-state.yaml commit to bare repo in writeSystemState to survive syncCacheClone resets.</item>
  <item>RFC-0966: add readPassport, writePassport, resolvePassportPath helpers and passportRequired to default state.</item>
  <item>RFC-0967: add ownershipRequired to default state.</item>
  <item>RFC-0981: fix writeSystemState push to use symbolic-ref and fully-qualified refspec HEAD:refs/heads/{branch} instead of broken rev-parse --abbrev-ref HEAD in detached HEAD state.</item>
</CHANGE_SUMMARY>
*/

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { gitExec } from "../werkstatt/git-exec.js";
import { cacheCloneCommit } from "../mission/mission-git-commit.js";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  systemConfigSchema,
  systemStateSchema,
  servicesRegistrySchema,
  type SystemConfig,
  type SystemState,
  type ServicesRegistry,
  type MirrorEntry,
  type ServiceEntry,
} from "@warpgogol/werkstatt-engine/schemas";
import { atomicWriteFile } from "../werkstatt/atomic.ts";
import type { SignedSitePassport } from "./passport.ts";

// --- RFC-0790: Convention-based path resolution ---

const SYSTEMS_CACHE_DIR = path.join("..", "systems-cache");
const SERVICES_REGISTRY_PATH = path.join("services", "registry.yaml");

/**
 * Resolves the expected cache clone path for a system by convention.
 *
 * @returns The computed cache clone path. Always returns a string — the
 *          directory may not exist on disk. Callers MUST check with
 *          `existsSync` before relying on the path.
 */
export function resolveCacheClonePath(workspaceRoot: string, systemId: string): string {
  return path.resolve(workspaceRoot, SYSTEMS_CACHE_DIR, systemId);
}

/**
 * Resolves the expected workpiece path for a mission by convention.
 *
 * @returns The computed workpiece path. Always returns a string — the
 *          directory may not exist on disk. Callers MUST check with
 *          `existsSync` before relying on the path.
 */
export function resolveWorkpiecePath(workspaceRoot: string, missionId: string): string {
  return path.join(workspaceRoot, "missions", missionId, "workpiece");
}

// --- RFC-0790: Per-system config/state IO (cache clone — OUTSIDE mission) ---

export async function readSystemConfig(
  workspaceRoot: string,
  systemId: string,
): Promise<SystemConfig> {
  const cacheClone = resolveCacheClonePath(workspaceRoot, systemId);
  const filePath = path.join(cacheClone, "system-config.yaml");
  const raw = await readFile(filePath, "utf8");
  const parsed = parseYaml(raw);
  return systemConfigSchema.parse(parsed);
}

export async function readSystemConfigFromWorkpiece(workpieceDir: string): Promise<SystemConfig> {
  const filePath = path.join(workpieceDir, "system-config.yaml");
  const raw = await readFile(filePath, "utf8");
  const parsed = parseYaml(raw);
  return systemConfigSchema.parse(parsed);
}

export async function writeSystemConfig(
  workspaceRoot: string,
  systemId: string,
  config: SystemConfig,
): Promise<void> {
  const cacheClone = resolveCacheClonePath(workspaceRoot, systemId);
  const filePath = path.join(cacheClone, "system-config.yaml");
  await mkdir(path.dirname(filePath), { recursive: true });
  const yaml = stringifyYaml(config);
  await atomicWriteFile(filePath, yaml + "\n");
}

export async function readSystemState(
  workspaceRoot: string,
  systemId: string,
): Promise<SystemState> {
  const cacheClone = resolveCacheClonePath(workspaceRoot, systemId);
  const filePath = path.join(cacheClone, "system-state.yaml");
  if (!existsSync(filePath)) {
    return {
      schemaVersion: "1.0.0",
      systemId,
      currentMission: null,
      lastRelease: null,
      lastPropagated: {},
      accessPin: null,
      passportRequired: false,
      ownershipRequired: false,
    };
  }
  const raw = await readFile(filePath, "utf8");
  const parsed = parseYaml(raw);
  return systemStateSchema.parse(parsed);
}

export async function readSystemStateFromWorkpiece(workpieceDir: string): Promise<SystemState> {
  const filePath = path.join(workpieceDir, "system-state.yaml");
  if (!existsSync(filePath)) {
    throw new Error(
      `[readSystemStateFromWorkpiece] system-state.yaml not found in workpiece ${workpieceDir}`,
    );
  }
  const raw = await readFile(filePath, "utf8");
  const parsed = parseYaml(raw);
  return systemStateSchema.parse(parsed);
}

export async function writeSystemStateToWorkpiece(
  workpieceDir: string,
  state: SystemState,
): Promise<void> {
  const filePath = path.join(workpieceDir, "system-state.yaml");
  await mkdir(path.dirname(filePath), { recursive: true });
  const yaml = stringifyYaml(state);
  await atomicWriteFile(filePath, yaml + "\n");
}

export async function writeSystemState(
  workspaceRoot: string,
  systemId: string,
  state: SystemState,
): Promise<void> {
  const cacheClone = resolveCacheClonePath(workspaceRoot, systemId);
  const filePath = path.join(cacheClone, "system-state.yaml");
  await mkdir(path.dirname(filePath), { recursive: true });
  const yaml = stringifyYaml(state);
  await atomicWriteFile(filePath, yaml + "\n");

  // Auto-commit to cache clone git
  if (existsSync(path.join(cacheClone, ".git"))) {
    try {
      execSync(`git add system-state.yaml`, {
        cwd: cacheClone,
        stdio: ["pipe", "pipe", "pipe"],
      });
      cacheCloneCommit(cacheClone, `system-state: update ${systemId}`);
    } catch {
      // Git commit may fail if nothing changed — non-fatal
    }

    // RFC-0794: Push to bare repo so syncCacheClone's git reset --hard origin/main
    // does not discard the commit. Without this push, mission.materialize loses
    // the system-state.yaml update written by mission.open.
    // RFC-0981: Cache clones are in detached HEAD state — rev-parse --abbrev-ref
    // HEAD returns "HEAD", causing "git push origin HEAD" to fail. Resolve the
    // branch name via symbolic-ref and use a fully-qualified refspec.
    try {
      let branch = "main";
      try {
        const ref = gitExec(cacheClone, "symbolic-ref --short refs/remotes/origin/HEAD", {
          allowNonZero: true,
        });
        branch = ref.replace("origin/", "") || "main";
      } catch {
        // No remote HEAD set — default to main
      }
      gitExec(cacheClone, `push origin HEAD:refs/heads/${branch}`);
    } catch (err) {
      // Push may fail if no bare repo is configured or branch diverged — non-fatal
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[writeSystemState] git push failed for ${systemId}: ${msg}`);
    }
  }
}

// --- RFC-0790: Discovery (scan ../systems-cache/) ---

export interface DiscoveryResult {
  systems: SystemConfig[];
  errors: Array<{ id: string; error: string }>;
}

export async function discoverSystems(workspaceRoot: string): Promise<DiscoveryResult> {
  const cacheRoot = path.resolve(workspaceRoot, SYSTEMS_CACHE_DIR);
  const systems: SystemConfig[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  if (!existsSync(cacheRoot)) {
    return { systems, errors };
  }

  const entries = await readdir(cacheRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const systemId = entry.name;
    if (systemId.startsWith(".")) continue;

    try {
      const config = await readSystemConfigSmart(workspaceRoot, systemId);
      systems.push(config);
    } catch (err) {
      errors.push({
        id: systemId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { systems, errors };
}

// --- RFC-0790: Smart IO (workpiece-aware, falls back to cache clone) ---
// During an active mission, system-config.yaml and system-state.yaml live in the
// workpiece. These functions check for an active mission workpiece and read/write
// there. When no mission is active, they fall back to the cache clone.

export async function resolveActiveWorkpieceDir(
  workspaceRoot: string,
  systemId: string,
): Promise<string | null> {
  // Read state from cache clone to find currentMission
  const cacheClone = resolveCacheClonePath(workspaceRoot, systemId);
  const statePath = path.join(cacheClone, "system-state.yaml");
  if (!existsSync(statePath)) return null;

  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = parseYaml(raw);
    const state = systemStateSchema.parse(parsed);
    if (!state.currentMission) return null;

    const workpieceDir = resolveWorkpiecePath(workspaceRoot, state.currentMission);
    if (!existsSync(workpieceDir)) return null;
    // Verify system-config.yaml exists in workpiece (materialized)
    if (!existsSync(path.join(workpieceDir, "system-config.yaml"))) return null;
    return workpieceDir;
  } catch {
    return null;
  }
}

export async function readSystemConfigSmart(
  workspaceRoot: string,
  systemId: string,
): Promise<SystemConfig> {
  const workpieceDir = await resolveActiveWorkpieceDir(workspaceRoot, systemId);
  if (workpieceDir) {
    return readSystemConfigFromWorkpiece(workpieceDir);
  }
  return readSystemConfig(workspaceRoot, systemId);
}

export async function readSystemStateSmart(
  workspaceRoot: string,
  systemId: string,
): Promise<SystemState> {
  const workpieceDir = await resolveActiveWorkpieceDir(workspaceRoot, systemId);
  if (workpieceDir) {
    const filePath = path.join(workpieceDir, "system-state.yaml");
    if (existsSync(filePath)) {
      const raw = await readFile(filePath, "utf8");
      const parsed = parseYaml(raw);
      return systemStateSchema.parse(parsed);
    }
    // Fallback: read from cache clone if not yet in workpiece
  }
  return readSystemState(workspaceRoot, systemId);
}

export async function writeSystemStateSmart(
  workspaceRoot: string,
  systemId: string,
  state: SystemState,
): Promise<void> {
  const workpieceDir = await resolveActiveWorkpieceDir(workspaceRoot, systemId);
  if (workpieceDir) {
    await writeSystemStateToWorkpiece(workpieceDir, state);
    return;
  }
  await writeSystemState(workspaceRoot, systemId, state);
}

export async function writeSystemConfigSmart(
  workspaceRoot: string,
  systemId: string,
  config: SystemConfig,
): Promise<void> {
  const workpieceDir = await resolveActiveWorkpieceDir(workspaceRoot, systemId);
  if (workpieceDir) {
    const filePath = path.join(workpieceDir, "system-config.yaml");
    await mkdir(path.dirname(filePath), { recursive: true });
    const yaml = stringifyYaml(config);
    await atomicWriteFile(filePath, yaml + "\n");
    return;
  }
  await writeSystemConfig(workspaceRoot, systemId, config);
}

// --- RFC-0790: Services registry (remains in monorepo) ---

export async function readServicesRegistry(workspaceRoot: string): Promise<ServicesRegistry> {
  const filePath = path.join(workspaceRoot, SERVICES_REGISTRY_PATH);
  const raw = await readFile(filePath, "utf8");
  const parsed = parseYaml(raw);
  return servicesRegistrySchema.parse(parsed);
}

export function findServiceEntry(registry: ServicesRegistry, id: string): ServiceEntry | undefined {
  return registry.services.find((s) => s.id === id);
}

export async function writeServicesRegistry(
  workspaceRoot: string,
  registry: ServicesRegistry,
): Promise<void> {
  const filePath = path.join(workspaceRoot, SERVICES_REGISTRY_PATH);
  const yaml = stringifyYaml(registry) + "\n";
  await writeFile(filePath, yaml, "utf8");
}

// --- Existing helpers (preserved) ---

export function hasAppsCollision(workspaceRoot: string, id: string): boolean {
  const appsDir = path.join(workspaceRoot, "apps", id);
  return existsSync(appsDir);
}

// --- RFC-0574: Mirror path resolution (signature updated for SystemConfig) ---

export type MirrorProtocol = "file" | "ssh" | "https" | "ftp" | "s3" | "rsync";

const GIT_PROTOCOLS: MirrorProtocol[] = ["file", "ssh", "https"];

export function inferMirrorProtocol(mirrorPath: string): MirrorProtocol {
  if (mirrorPath.startsWith("git@") || mirrorPath.startsWith("ssh://")) return "ssh";
  if (mirrorPath.startsWith("https://") || mirrorPath.startsWith("http://")) return "https";
  if (mirrorPath.startsWith("ftp://") || mirrorPath.startsWith("sftp://")) return "ftp";
  if (mirrorPath.startsWith("s3://")) return "s3";
  if (mirrorPath.startsWith("rsync://")) return "rsync";
  return "file";
}

export function isGitAccessible(mirrorPath: string): boolean {
  return GIT_PROTOCOLS.includes(inferMirrorProtocol(mirrorPath));
}

/**
 * Resolves a mirror path relative to the workspace root.
 *
 * @returns The resolved mirror path. Always returns a string — the
 *          path may not exist on disk. Callers MUST check with
 *          `existsSync` before relying on the path. For non-local
 *          protocols (ssh, https, ftp, s3, rsync) the returned string
 *          is the raw mirror path as-is.
 */
export function resolveMirrorPath(workspaceRoot: string, mirrorPath: string): string {
  if (mirrorPath.startsWith("file://")) {
    return path.resolve(workspaceRoot, mirrorPath.slice("file://".length));
  }
  if (mirrorPath.startsWith("./") || mirrorPath.startsWith("../") || mirrorPath.startsWith("/")) {
    return path.resolve(workspaceRoot, mirrorPath);
  }
  return mirrorPath;
}

export interface MirrorResolution {
  cachePath: string;
  gitMirrors: MirrorEntry[];
  backupMirrors: MirrorEntry[];
}

export function resolveMirrors(workspaceRoot: string, config: SystemConfig): MirrorResolution {
  const cacheMirror = config.mirrors[0];
  const cachePath = resolveMirrorPath(workspaceRoot, cacheMirror.path);
  const gitMirrors: MirrorEntry[] = [];
  const backupMirrors: MirrorEntry[] = [];

  for (let i = 1; i < config.mirrors.length; i++) {
    const m = config.mirrors[i];
    if (m.storageType === "bundle") {
      backupMirrors.push(m);
    } else if (isGitAccessible(m.path)) {
      gitMirrors.push(m);
    }
  }

  return { cachePath, gitMirrors, backupMirrors };
}

// --- RFC-0966: Passport IO helpers ---

export function resolvePassportPath(workspaceRoot: string, systemId: string): string {
  const cachePath = resolveCacheClonePath(workspaceRoot, systemId);
  return path.join(cachePath, "passport.json");
}

export async function readPassport(
  workspaceRoot: string,
  systemId: string,
): Promise<SignedSitePassport | null> {
  const filePath = resolvePassportPath(workspaceRoot, systemId);
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as SignedSitePassport;
}

export async function writePassport(
  workspaceRoot: string,
  systemId: string,
  doc: SignedSitePassport,
): Promise<string> {
  const filePath = resolvePassportPath(workspaceRoot, systemId);
  const content = JSON.stringify(doc, null, 2) + "\n";
  await atomicWriteFile(filePath, content);
  return filePath;
}
