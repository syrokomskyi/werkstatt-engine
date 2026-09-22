/*
<MODULE_CONTRACT>
<purpose>werkstatt.platform.update — bump @warpgogol/* platform dependencies in a workshop and report Sternsystems whose pinnedPlatform drifts from the new installed version (RFC-1125).</purpose>
<keywords>platform, update, pnpm, pinnedPlatform, drift, workshop</keywords>
<responsibilities>
  <item>Runs `pnpm up` scoped to @warpgogol/* packages (latest or a target semver).</item>
  <item>Reads the installed @warpgogol/werkstatt-engine version before/after.</item>
  <item>Reports Sternsystems whose pinnedPlatform differs from the new version.</item>
</responsibilities>
<non-goals>
  <item>Do not rewrite pinnedPlatform — drift is reported, not auto-fixed (pin is a deliberate act).</item>
  <item>Do not touch non-@warpgogol dependencies.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1125: initial werkstatt.platform.update — pure platformUpdate() + thin kernel handler, idempotent, drift report.</item>
</CHANGE_SUMMARY>
*/

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { discoverSystems } from "../sternsystem/registry-io.ts";

export interface PlatformUpdateData {
  command: "werkstatt.platform.update";
  /** Installed @warpgogol/werkstatt-engine version before the update (null if unreadable). */
  from: string | null;
  /** Installed version after the update. */
  to: string | null;
  /** True when the installed version changed. */
  changed: boolean;
  /** The pnpm command that was run. */
  pnpmCommand: string;
  /** Sternsystems whose pinnedPlatform differs from the new installed version. */
  driftedSystems: Array<{ id: string; pinnedPlatform: string }>;
}

/** Injectable dependencies for testing. */
export interface PlatformUpdateDeps {
  /** Run the pnpm command (defaults to execSync). */
  exec?: (cmd: string, cwd: string) => void;
  /** Read the installed engine version (defaults to node_modules read). */
  installedVersion?: (root: string) => Promise<string | null>;
  /** List registered systems (defaults to discoverSystems). */
  listSystems?: (root: string) => Promise<Array<{ id: string; pinnedPlatform: string }>>;
}

const ENGINE_PKG = "@warpgogol/werkstatt-engine";
const UPDATE_SCOPE = "@warpgogol/*";

async function defaultInstalledVersion(workspaceRoot: string): Promise<string | null> {
  const pkgPath = join(workspaceRoot, "node_modules", "@warpgogol", "werkstatt-engine", "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function defaultExec(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: "pipe", timeout: 300_000 });
}

async function defaultListSystems(
  workspaceRoot: string,
): Promise<Array<{ id: string; pinnedPlatform: string }>> {
  const { systems } = await discoverSystems(workspaceRoot);
  return systems.map((s) => ({ id: s.id, pinnedPlatform: s.pinnedPlatform }));
}

/**
 * Pure update logic — callable from tests and non-kernel contexts.
 * `to` is a semver string or "latest". Idempotent: re-running on an
 * up-to-date workshop reports changed=false and no drift delta.
 */
export async function platformUpdate(
  workspaceRoot: string,
  to: string,
  deps: PlatformUpdateDeps = {},
): Promise<PlatformUpdateData> {
  const exec = deps.exec ?? defaultExec;
  const installedVersion = deps.installedVersion ?? defaultInstalledVersion;
  const listSystems = deps.listSystems ?? defaultListSystems;

  const from = await installedVersion(workspaceRoot);

  const pnpmCommand =
    to === "latest"
      ? `pnpm up -rL "${UPDATE_SCOPE}"`
      : `pnpm up -r "${UPDATE_SCOPE}@${to}"`;
  exec(pnpmCommand, workspaceRoot);

  const after = await installedVersion(workspaceRoot);

  const systems = await listSystems(workspaceRoot);
  const driftedSystems =
    after === null
      ? []
      : systems
          .filter((s) => s.pinnedPlatform !== after)
          .map((s) => ({ id: s.id, pinnedPlatform: s.pinnedPlatform }));

  return {
    command: "werkstatt.platform.update",
    from,
    to: after,
    changed: from !== after,
    pnpmCommand,
    driftedSystems,
  };
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

/** Thin kernel handler — delegates to the pure platformUpdate(). */
export async function runPlatformUpdate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<PlatformUpdateData>> {
  const { workspaceRoot, logger } = context;
  const to = flagString(input, "to") ?? "latest";

  const result = await platformUpdate(workspaceRoot, to);

  if (result.changed) {
    logger.info(`[werkstatt.platform.update] ${ENGINE_PKG} ${result.from} → ${result.to}`);
  } else {
    logger.info(`[werkstatt.platform.update] already at ${result.to ?? "unknown"} — no change`);
  }
  for (const s of result.driftedSystems) {
    logger.warn(
      `  [werkstatt.platform.update] '${s.id}' pinnedPlatform ${s.pinnedPlatform} drifts from installed ${result.to} — re-pin via sternsystem.pin when ready`,
    );
  }

  return {
    data: result,
    summary:
      result.driftedSystems.length > 0
        ? `[werkstatt.platform.update] ${result.from} → ${result.to}; ${result.driftedSystems.length} system(s) drift`
        : `[werkstatt.platform.update] ${result.from} → ${result.to}`,
    exitCode: 0,
  };
}
