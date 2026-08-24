/*
<MODULE_CONTRACT>
<purpose>RFC-0221 §4 steps 6-8: materialize a handoff bundle into the current ecosystem —
apply the migrator chain to the authored set, inject it into apps/&lt;target&gt;, then delegate
regeneration + validation to the standard build pipeline. Never round-trips generated files.</purpose>
<non-goals>
  <item>Do not regenerate derived artifacts here — that is delegated to site-kernel-codegen via the pipeline.</item>
  <item>Do not git-merge; injection overwrites authored files only, git is the rollback net.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: materialization write-path (inject + migrators + delegated regen).</item>
</CHANGE_SUMMARY>
*/

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { HandoffManifest } from "@warpgogol/werkstatt-engine/schemas";
import type { AuthoredSet } from "./types.ts";

const TEXT_EXT = new Set([
  ".md",
  ".mdx",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".css",
  ".yaml",
  ".yml",
  ".astro",
  ".txt",
  ".html",
  ".svg",
]);

function isTextPath(p: string): boolean {
  return TEXT_EXT.has(path.extname(p).toLowerCase());
}

/** Strip the leading "site/" segment from a bundle-relative manifest path → app-relative path. */
export function toAppRelative(bundlePath: string): string | null {
  const norm = bundlePath.replace(/\\/g, "/");
  if (!norm.startsWith("site/")) return null;
  return norm.slice("site/".length);
}

export interface LoadedBundle {
  /** App-relative text files (eligible for migrator transforms). */
  authored: AuthoredSet;
  /** App-relative binary files copied verbatim (bundle-absolute source path). */
  binaries: Map<string, string>;
}

/** Load the manifest's authored entries: text into memory, binaries tracked by source path. */
export async function loadAuthoredSet(
  bundleDir: string,
  manifest: HandoffManifest,
): Promise<LoadedBundle> {
  const authored: AuthoredSet = new Map();
  const binaries = new Map<string, string>();
  for (const entry of manifest.entries) {
    if (entry.kind !== "authored") continue;
    const appRel = toAppRelative(entry.path);
    if (!appRel) continue;
    const abs = path.join(bundleDir, entry.path);
    if (isTextPath(appRel)) {
      authored.set(appRel, await fs.readFile(abs, "utf8"));
    } else {
      binaries.set(appRel, abs);
    }
  }
  return { authored, binaries };
}

/** Write the (migrated) authored set + binaries into the target app directory. */
export async function injectAuthoredSet(targetDir: string, loaded: LoadedBundle): Promise<number> {
  let written = 0;
  for (const [appRel, content] of loaded.authored) {
    const dest = path.join(targetDir, appRel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content, "utf8");
    written++;
  }
  for (const [appRel, srcAbs] of loaded.binaries) {
    const dest = path.join(targetDir, appRel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(srcAbs, dest);
    written++;
  }
  return written;
}

function runKernel(workspaceRoot: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const bin = path.join(workspaceRoot, "packages", "os", "site-kernel", "bin", "werkstatt.mjs");
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: workspaceRoot,
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

function runPnpm(workspaceRoot: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", args, {
      cwd: workspaceRoot,
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

export interface RegenerationResult {
  installCode: number;
  prepareCode: number;
  checkCode: number;
}

/**
 * Delegate regeneration + validation to the standard pipelines for the app. When `install` is set
 * (a brand-new app that is not yet a resolved workspace member), run `pnpm install` first so the
 * app's dependencies and node_modules exist before regeneration/build.
 */
export async function runRegeneration(
  workspaceRoot: string,
  siteId: string,
  options: { install?: boolean } = {},
): Promise<RegenerationResult> {
  const installCode = options.install ? await runPnpm(workspaceRoot, ["install"]) : 0;
  if (installCode !== 0) return { installCode, prepareCode: -1, checkCode: -1 };
  const prepareCode = await runKernel(workspaceRoot, [
    "pipeline",
    "build.prepare",
    "--site",
    siteId,
  ]);
  if (prepareCode !== 0) return { installCode, prepareCode, checkCode: -1 };
  const checkCode = await runKernel(workspaceRoot, ["pipeline", "build.check", "--site", siteId]);
  return { installCode, prepareCode, checkCode };
}
