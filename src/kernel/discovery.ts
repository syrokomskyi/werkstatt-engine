/*
<MODULE_CONTRACT>
<purpose>Facilitates discovery and configuration loading for kernel applications within a workspace.</purpose>
<non-goals>
  <item>Do not handle application runtime or execution logic.</item>
  <item>Do not parse raw content from configuration files.</item>
  <item>Do not manage application dependencies or orchestration.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Workspace discovery must remain read-only and avoid app-specific path assumptions outside explicit adapters.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import type { DiscoveredSiteWorkspace, KernelAppConfig } from "@warpgogol/werkstatt-shared/kernel";
import { discoverSiteWorkspaces as discoverSitesFromResolver } from "./site-workspace-resolver.ts";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";
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

async function resolveAppConfigPath(
  toolsDirectory: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string | undefined> {
  for (const filename of APP_CONFIG_FILENAMES) {
    const filePath = path.join(toolsDirectory, filename);
    if (await io.exists(filePath)) {
      return filePath;
    }
  }

  return undefined;
}

/**
 * tsx's CJS interop can fail under nested loader environments (vitest): a `.js`
 * dep's `require("node:fs")` gets a `?tsx-namespace=` specifier that the CJS
 * loader then opens as a path (ENOENT), or `import.meta.url` arrives with a
 * non-file scheme. Plain `import()` goes through the host module runner
 * (vitest) or Node type-stripping and succeeds where tsx breaks.
 */
function isLoaderInteropError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("tsx-namespace") || msg.includes("must be of scheme file");
}

async function importConfigModule(url: string): Promise<Record<string, unknown>> {
  // Under vitest, prefer the host module runner: a tsx-loaded config yields
  // tsx-bound loader closures whose internal dynamic imports hit the
  // CJS-namespace bug later in buildRegistry — catching tsImport's own throw
  // is not enough.
  if (process.env.VITEST) {
    try {
      return (await import(url)) as Record<string, unknown>;
    } catch {
      // vite-node cannot reach config files outside the workspace root
      // (e.g. /tmp fixture workspaces) — fall back to tsx for those.
      return (await tsImport(url, import.meta.url)) as Record<string, unknown>;
    }
  }
  try {
    return (await tsImport(url, import.meta.url)) as Record<string, unknown>;
  } catch (err) {
    if (!isLoaderInteropError(err)) throw err;
    return (await import(url)) as Record<string, unknown>;
  }
}
export async function discoverSiteWorkspaces(
  workspaceRoot: string,
): Promise<DiscoveredSiteWorkspace[]> {
  return discoverSitesFromResolver(workspaceRoot);
}
export interface KernelConfigLoadOptions {
  /** RFC-1309: suppress the `[config]` preamble lines on stderr. */
  quiet?: boolean;
}

export async function loadKernelAppConfig(
  site: DiscoveredSiteWorkspace,
  options?: KernelConfigLoadOptions,
): Promise<KernelAppConfig> {
  if (!site.configPath) {
    throw new Error(`No kernel config found for site \`${site.name}\`.`);
  }

  if (!options?.quiet) process.stderr.write(`  [config] loading ${site.configPath} …\n`);
  let moduleNamespace: Record<string, unknown>;
  try {
    moduleNamespace = await importConfigModule(pathToFileURL(site.configPath).href);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load kernel config \`${site.configPath}\` for site \`${site.name}\`: ${detail}`,
      { cause: error },
    );
  }
  if (!options?.quiet) process.stderr.write(`  [config] loaded ${site.configPath}\n`);
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
  options?: KernelConfigLoadOptions,
): Promise<KernelAppConfig | undefined> {
  const toolsDirectory = path.join(workspaceRoot, "tools");
  const configPath = await resolveAppConfigPath(toolsDirectory);

  if (!configPath) {
    return undefined;
  }

  if (!options?.quiet) process.stderr.write(`  [config] loading ${configPath} …\n`);
  let moduleNamespace: Record<string, unknown>;
  try {
    moduleNamespace = await importConfigModule(pathToFileURL(configPath).href);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load workspace kernel config \`${configPath}\`: ${detail}`, {
      cause: error,
    });
  }
  if (!options?.quiet) process.stderr.write(`  [config] loaded ${configPath}\n`);
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

export async function findWorkspaceRoot(
  startDirectory: string = process.cwd(),
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string> {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    const packageJsonPath = path.join(currentDirectory, "package.json");
    const workspacePath = path.join(currentDirectory, "pnpm-workspace.yaml");

    if ((await io.exists(packageJsonPath)) && (await io.exists(workspacePath))) {
      return currentDirectory;
    }
    {
      const parentDirectory = path.dirname(currentDirectory);
      if (parentDirectory === currentDirectory) {
        throw new Error(`Unable to locate a pnpm workspace root from ${startDirectory}.`);
      }

      currentDirectory = parentDirectory;
    }
  }
}
