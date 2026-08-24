/*
<MODULE_CONTRACT>
<purpose>Facilitates discovery and configuration loading for kernel applications within a workspace.</purpose>
<non-goals>
  <item>Do not handle application runtime or execution logic.</item>
  <item>Do not parse raw content from configuration files.</item>
  <item>Do not manage application dependencies or orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Added Compass scaffolding to enhance code navigation and maintainability.</item>
</CHANGE_SUMMARY>
*/

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import type { DiscoveredSiteWorkspace, KernelAppConfig } from "./types.ts";
import { discoverSiteWorkspaces as discoverSitesFromResolver } from "./site-workspace-resolver.ts";
// @ai-invariant: Workspace discovery must remain read-only and avoid app-specific path assumptions outside explicit adapters.

function unwrapConfig(moduleNamespace: Record<string, unknown>): unknown {
  let candidate: unknown = moduleNamespace.default ?? moduleNamespace.config;
  for (let depth = 0; depth < 8; depth++) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "default" in (candidate as Record<string, unknown>)
    ) {
      const inner = (candidate as Record<string, unknown>).default;
      if (inner && typeof inner === "object") {
        candidate = inner;
        continue;
      }
    }
    break;
  }
  return candidate;
}
const APP_CONFIG_FILENAMES = [
  "kernel.config.ts",
  "kernel.config.mts",
  "kernel.config.js",
  "kernel.config.mjs",
] as const;

async function resolveAppConfigPath(toolsDirectory: string): Promise<string | undefined> {
  for (const filename of APP_CONFIG_FILENAMES) {
    const filePath = path.join(toolsDirectory, filename);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      continue;
    }
  }

  return undefined;
}
export async function discoverSiteWorkspaces(
  workspaceRoot: string,
): Promise<DiscoveredSiteWorkspace[]> {
  return discoverSitesFromResolver(workspaceRoot);
}
export async function loadKernelAppConfig(site: DiscoveredSiteWorkspace): Promise<KernelAppConfig> {
  if (!site.configPath) {
    throw new Error(`No kernel config found for site \`${site.name}\`.`);
  }

  process.stderr.write(`  [config] loading ${site.configPath} …\n`);
  const moduleNamespace = await tsImport(pathToFileURL(site.configPath).href, import.meta.url);
  process.stderr.write(`  [config] loaded ${site.configPath}\n`);
  const candidate = unwrapConfig(moduleNamespace);

  if (!candidate || typeof candidate !== "object") {
    throw new Error(`Kernel config \`${site.configPath}\` does not export a valid config object.`);
  }

  const config = candidate as KernelAppConfig;

  if (!config.modules && !config.moduleLoaders) {
    throw new Error(
      `Kernel config \`${site.configPath}\` must provide either a modules array or moduleLoaders record.`,
    );
  }

  return config;
}
export async function loadWorkspaceConfig(
  workspaceRoot: string,
): Promise<KernelAppConfig | undefined> {
  const toolsDirectory = path.join(workspaceRoot, "tools");
  const configPath = await resolveAppConfigPath(toolsDirectory);

  if (!configPath) {
    return undefined;
  }

  process.stderr.write(`  [config] loading ${configPath} …\n`);
  const moduleNamespace = await tsImport(pathToFileURL(configPath).href, import.meta.url);
  process.stderr.write(`  [config] loaded ${configPath}\n`);
  const candidate = unwrapConfig(moduleNamespace);

  if (!candidate || typeof candidate !== "object") {
    throw new Error(
      `Workspace kernel config \`${configPath}\` does not export a valid config object.`,
    );
  }

  const config = candidate as KernelAppConfig;

  if (!config.modules && !config.moduleLoaders) {
    throw new Error(
      `Workspace kernel config \`${configPath}\` must provide either a modules array or moduleLoaders record.`,
    );
  }

  return config;
}

export async function findWorkspaceRoot(startDirectory: string = process.cwd()): Promise<string> {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    const packageJsonPath = path.join(currentDirectory, "package.json");
    const workspacePath = path.join(currentDirectory, "pnpm-workspace.yaml");

    try {
      await Promise.all([fs.access(packageJsonPath), fs.access(workspacePath)]);
      return currentDirectory;
    } catch {
      const parentDirectory = path.dirname(currentDirectory);
      if (parentDirectory === currentDirectory) {
        throw new Error(`Unable to locate a pnpm workspace root from ${startDirectory}.`);
      }

      currentDirectory = parentDirectory;
    }
  }
}
