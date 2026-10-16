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
  <item>RFC-1159: step 3 — io.exec exit-code sweep via execOrThrow</item>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
  <item>RFC-1284: default system state gains accessPinSuspended: null — the durable suspension marker read/written via the non-smart cache-clone store (Q-6)</item>
  <item>REVIEW-CODE-2026-10-16-08 N6: writeSystemState threads the caller's WorkspaceIO through its internal git add/commit/push instead of falling back to the ambient adapter, and reports push failures through an injected warn channel.</item>
  <item>RFC-1307: review-08 N1-N7 — ref-scoped rollback, pre-existing content preservation, svg resolution, explicit io</item>
  <item>REVIEW-CODE-2026-10-16-09 N11: writeSystemState pushes via array-args execOrThrow — the remote-derived branch name never reaches a shell-interpolated command string.</item>
  <history>ADR-0040, RFC-0354, RFC-0574, RFC-0751, RFC-0790, RFC-0794, RFC-0966, RFC-0967, RFC-0981, RFC-1097, RFC-1149</history>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import {
  createDefaultIO,
  execOrThrow,
  type WorkspaceIO,
} from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { gitExec } from "../werkstatt/git-exec.ts";
import { cacheCloneCommit } from "../mission/mission-git-commit.ts";
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
  io: WorkspaceIO = createDefaultIO().io,
): Promise<SystemConfig> {
  const cacheClone = resolveCacheClonePath(workspaceRoot, systemId);
  const filePath = path.join(cacheClone, "system-config.yaml");
  const raw = await io.readFile(filePath);
  const parsed = parseYaml(raw);
  return systemConfigSchema.parse(parsed);
}

export async function readSystemConfigFromWorkpiece(
  workpieceDir: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<SystemConfig> {
  const filePath = path.join(workpieceDir, "system-config.yaml");
  const raw = await io.readFile(filePath);
  const parsed = parseYaml(raw);
  return systemConfigSchema.parse(parsed);
}

export async function writeSystemConfig(
  workspaceRoot: string,
  systemId: string,
  config: SystemConfig,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const cacheClone = resolveCacheClonePath(workspaceRoot, systemId);
  const filePath = path.join(cacheClone, "system-config.yaml");
  await io.mkdir(path.dirname(filePath));
  const yaml = stringifyYaml(config);
  await atomicWriteFile(filePath, yaml + "\n", io);
}

export async function readSystemState(
  workspaceRoot: string,
  systemId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<SystemState> {
  const cacheClone = resolveCacheClonePath(workspaceRoot, systemId);
  const filePath = path.join(cacheClone, "system-state.yaml");
  if (!(await io.exists(filePath))) {
    return {
      schemaVersion: "1.0.0",
      systemId,
      currentMission: null,
      lastRelease: null,
      lastPropagated: {},
      accessPin: null,
      accessPinSuspended: null,
      passportRequired: false,
      ownershipRequired: false,
    };
  }
  const raw = await io.readFile(filePath);
  const parsed = parseYaml(raw);
  return systemStateSchema.parse(parsed);
}

export async function readSystemStateFromWorkpiece(
  workpieceDir: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<SystemState> {
  const filePath = path.join(workpieceDir, "system-state.yaml");
  if (!(await io.exists(filePath))) {
    throw new Error(
      `[readSystemStateFromWorkpiece] system-state.yaml not found in workpiece ${workpieceDir}`,
    );
  }
  const raw = await io.readFile(filePath);
  const parsed = parseYaml(raw);
  return systemStateSchema.parse(parsed);
}

export async function writeSystemStateToWorkpiece(
  workpieceDir: string,
  state: SystemState,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const filePath = path.join(workpieceDir, "system-state.yaml");
  await io.mkdir(path.dirname(filePath));
  const yaml = stringifyYaml(state);
  await atomicWriteFile(filePath, yaml + "\n", io);
}

export async function writeSystemState(
  workspaceRoot: string,
  systemId: string,
  state: SystemState,
  io: WorkspaceIO = createDefaultIO().io,
  onWarn?: (message: string) => void,
): Promise<void> {
  const cacheClone = resolveCacheClonePath(workspaceRoot, systemId);
  const filePath = path.join(cacheClone, "system-state.yaml");
  await io.mkdir(path.dirname(filePath));
  const yaml = stringifyYaml(state);
  await atomicWriteFile(filePath, yaml + "\n", io);

  // Auto-commit to cache clone git
  if (await io.exists(path.join(cacheClone, ".git"))) {
    try {
      await execOrThrow(io, "git", ["add", "system-state.yaml"], { cwd: cacheClone });
      await cacheCloneCommit(cacheClone, `system-state: update ${systemId}`, undefined, io);
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
        const ref = await gitExec(
          cacheClone,
          "symbolic-ref --short refs/remotes/origin/HEAD",
          { allowNonZero: true },
          io,
        );
        branch = ref.replace("origin/", "") || "main";
      } catch {
        // No remote HEAD set — default to main
      }
      // RFC-0986: Use --force-with-lease — cache clone is the source of truth.
      // Fixes non-fast-forward errors when bare repo diverged after last fetch.
      // Array-args exec — the remote-derived branch name must never reach a
      // shell-interpolated command string (REVIEW-CODE-2026-10-16-09 N11).
      await execOrThrow(
        io,
        "git",
        ["push", "--force-with-lease", "origin", `HEAD:refs/heads/${branch}`],
        { cwd: cacheClone },
      );
    } catch (err) {
      // Push may fail if no bare repo is configured or branch diverged — non-fatal
      const msg = err instanceof Error ? err.message : String(err);
      (onWarn ?? console.warn)(`[writeSystemState] git push failed for ${systemId}: ${msg}`);
    }
  }
}

// --- RFC-0790: Discovery (scan ../systems-cache/) ---

export interface DiscoveryResult {
  systems: SystemConfig[];
  errors: Array<{ id: string; error: string }>;
}

export async function discoverSystems(
  workspaceRoot: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<DiscoveryResult> {
  const cacheRoot = path.resolve(workspaceRoot, SYSTEMS_CACHE_DIR);
  const systems: SystemConfig[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  if (!(await io.exists(cacheRoot))) {
    return { systems, errors };
  }

  const entries = await io.readdir(cacheRoot);
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const systemId = entry.name;
    if (systemId.startsWith(".")) continue;

    try {
      const config = await readSystemConfigSmart(workspaceRoot, systemId, io);
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
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string | null> {
  // Read state from cache clone to find currentMission
  const cacheClone = resolveCacheClonePath(workspaceRoot, systemId);
  const statePath = path.join(cacheClone, "system-state.yaml");
  if (!(await io.exists(statePath))) return null;

  try {
    const raw = await io.readFile(statePath);
    const parsed = parseYaml(raw);
    const state = systemStateSchema.parse(parsed);
    if (!state.currentMission) return null;

    const workpieceDir = resolveWorkpiecePath(workspaceRoot, state.currentMission);
    if (!(await io.exists(workpieceDir))) return null;
    // Verify system-config.yaml exists in workpiece (materialized)
    if (!(await io.exists(path.join(workpieceDir, "system-config.yaml")))) return null;
    return workpieceDir;
  } catch {
    return null;
  }
}

export async function readSystemConfigSmart(
  workspaceRoot: string,
  systemId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<SystemConfig> {
  const workpieceDir = await resolveActiveWorkpieceDir(workspaceRoot, systemId, io);
  if (workpieceDir) {
    return readSystemConfigFromWorkpiece(workpieceDir, io);
  }
  return readSystemConfig(workspaceRoot, systemId, io);
}

export async function readSystemStateSmart(
  workspaceRoot: string,
  systemId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<SystemState> {
  const workpieceDir = await resolveActiveWorkpieceDir(workspaceRoot, systemId, io);
  if (workpieceDir) {
    const filePath = path.join(workpieceDir, "system-state.yaml");
    if (await io.exists(filePath)) {
      const raw = await io.readFile(filePath);
      const parsed = parseYaml(raw);
      return systemStateSchema.parse(parsed);
    }
    // Fallback: read from cache clone if not yet in workpiece
  }
  return readSystemState(workspaceRoot, systemId, io);
}

export async function writeSystemStateSmart(
  workspaceRoot: string,
  systemId: string,
  state: SystemState,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const workpieceDir = await resolveActiveWorkpieceDir(workspaceRoot, systemId, io);
  if (workpieceDir) {
    await writeSystemStateToWorkpiece(workpieceDir, state, io);
    return;
  }
  await writeSystemState(workspaceRoot, systemId, state, io);
}

export async function writeSystemConfigSmart(
  workspaceRoot: string,
  systemId: string,
  config: SystemConfig,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const workpieceDir = await resolveActiveWorkpieceDir(workspaceRoot, systemId, io);
  if (workpieceDir) {
    const filePath = path.join(workpieceDir, "system-config.yaml");
    await io.mkdir(path.dirname(filePath));
    const yaml = stringifyYaml(config);
    await atomicWriteFile(filePath, yaml + "\n", io);
    return;
  }
  await writeSystemConfig(workspaceRoot, systemId, config, io);
}

// --- RFC-0790: Services registry (remains in monorepo) ---

export async function readServicesRegistry(
  workspaceRoot: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<ServicesRegistry> {
  const filePath = path.join(workspaceRoot, SERVICES_REGISTRY_PATH);
  const raw = await io.readFile(filePath);
  const parsed = parseYaml(raw);
  return servicesRegistrySchema.parse(parsed);
}

export function findServiceEntry(registry: ServicesRegistry, id: string): ServiceEntry | undefined {
  return registry.services.find((s) => s.id === id);
}

export async function writeServicesRegistry(
  workspaceRoot: string,
  registry: ServicesRegistry,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const filePath = path.join(workspaceRoot, SERVICES_REGISTRY_PATH);
  const yaml = stringifyYaml(registry) + "\n";
  await io.writeFile(filePath, yaml);
}

// --- Existing helpers (preserved) ---

export async function hasAppsCollision(
  workspaceRoot: string,
  id: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<boolean> {
  const appsDir = path.join(workspaceRoot, "apps", id);
  return io.exists(appsDir);
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
  io: WorkspaceIO = createDefaultIO().io,
): Promise<SignedSitePassport | null> {
  const filePath = resolvePassportPath(workspaceRoot, systemId);
  if (!(await io.exists(filePath))) return null;
  const raw = await io.readFile(filePath);
  return JSON.parse(raw) as SignedSitePassport;
}

export async function writePassport(
  workspaceRoot: string,
  systemId: string,
  doc: SignedSitePassport,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string> {
  const filePath = resolvePassportPath(workspaceRoot, systemId);
  const content = JSON.stringify(doc, null, 2) + "\n";
  await atomicWriteFile(filePath, content, io);
  return filePath;
}
