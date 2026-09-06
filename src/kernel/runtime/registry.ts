/*
<MODULE_CONTRACT>
<purpose>
Kernel registry assembly and app-target resolution: build a KernelRegistry from a loaded
app/workspace config, list registered commands/pipelines across the workspace + every
discovered app, and resolve which app(s) a CLI invocation targets.
</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0303: split out of runtime.ts (Phase 3 file-size split, hot-path file 8/8).</item>
  <item>ADR-0022: loadAppRuntime and list functions now use process-lifetime registry cache from registry-cache.ts.</item>
  <item>RFC-0960: buildRegistry and buildRegistryForModule call config.postBuildValidation after all modules are loaded.</item>
  <item>RFC-1026: buildRegistry and buildRegistryForModule set moduleStates (loading → active, failed on throw); rollback on register() failure; buildRegistryWithHandles returns KernelModuleHandle map.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import process from "node:process";
import { discoverSiteWorkspaces, loadKernelAppConfig } from "../discovery.ts";
import { KernelRegistry } from "../registry.ts";
import { getOrBuildRegistry, getOrBuildWorkspaceRegistry } from "./registry-cache.ts";
import type {
  DiscoveredSiteWorkspace,
  KernelAppConfig,
  KernelModuleHandle,
  SiteWorkspacesListResult,
  KernelCommandDefinition,
  KernelRegisteredCommandInfo,
  KernelPipelineStep,
} from "../types.ts";
import type { ModuleExport } from "../../runtime/desired-state.ts";

function createModuleHandle(registry: KernelRegistry, moduleName: string): KernelModuleHandle {
  return {
    moduleName,
    get state() {
      return registry.getModuleState(moduleName) ?? "declared";
    },
    async dispose() {
      await registry.unregisterModule(moduleName);
    },
  };
}

export async function buildRegistry(config: KernelAppConfig): Promise<KernelRegistry> {
  const registry = new KernelRegistry();

  if (config.modules) {
    for (const mod of config.modules) {
      process.stderr.write(`  [registry] loading module ${mod.name} …\n`);
      try {
        registry.populateFromModule(mod);
      } catch (err) {
        rollbackModuleRegistrations(registry, mod.name);
        throw err;
      }
    }
  } else if (config.moduleLoaders) {
    for (const [moduleName, loader] of Object.entries(config.moduleLoaders)) {
      process.stderr.write(`  [registry] loading module ${moduleName} …\n`);
      const mod = await loader();
      try {
        registry.populateFromModule(mod);
      } catch (err) {
        rollbackModuleRegistrations(registry, moduleName);
        throw err;
      }
    }
  }
  registry.currentModuleName = undefined;

  return registry;
}

function rollbackModuleRegistrations(registry: KernelRegistry, moduleName: string): void {
  const commandsToRemove = [...registry.commandModules.entries()]
    .filter(([, mod]) => mod === moduleName)
    .map(([cmd]) => cmd);
  for (const cmd of commandsToRemove) {
    registry.commands.delete(cmd);
    registry.commandModules.delete(cmd);
  }
  const pipelinesToRemove = [...registry.pipelineModules.entries()]
    .filter(([, mod]) => mod === moduleName)
    .map(([pipe]) => pipe);
  for (const pipe of pipelinesToRemove) {
    registry.pipelines.delete(pipe);
    registry.pipelineModules.delete(pipe);
  }
}

export async function buildRegistryWithHandles(
  config: KernelAppConfig,
): Promise<{ registry: KernelRegistry; handles: Map<string, KernelModuleHandle> }> {
  const handles = new Map<string, KernelModuleHandle>();
  const registry = new KernelRegistry();

  if (config.modules) {
    for (const mod of config.modules) {
      process.stderr.write(`  [registry] loading module ${mod.name} …\n`);
      try {
        registry.populateFromModule(mod);
        handles.set(mod.name, createModuleHandle(registry, mod.name));
      } catch (err) {
        rollbackModuleRegistrations(registry, mod.name);
        throw err;
      }
    }
  } else if (config.moduleLoaders) {
    for (const [moduleName, loader] of Object.entries(config.moduleLoaders)) {
      process.stderr.write(`  [registry] loading module ${moduleName} …\n`);
      const mod = await loader();
      try {
        registry.populateFromModule(mod);
        handles.set(moduleName, createModuleHandle(registry, moduleName));
      } catch (err) {
        rollbackModuleRegistrations(registry, moduleName);
        throw err;
      }
    }
  }
  registry.currentModuleName = undefined;

  return { registry, handles };
}

export async function buildRegistryForModule(
  config: KernelAppConfig,
  moduleName: string,
): Promise<KernelRegistry> {
  const registry = new KernelRegistry();

  if (config.moduleLoaders) {
    const loader = config.moduleLoaders[moduleName];
    if (!loader) {
      throw new Error(`No module loader registered for module \`${moduleName}\`.`);
    }
    const mod = await loader();
    try {
      registry.populateFromModule(mod);
    } catch (err) {
      rollbackModuleRegistrations(registry, moduleName);
      throw err;
    }
  } else if (config.modules) {
    const mod = config.modules.find((m) => m.name === moduleName);
    if (!mod) {
      throw new Error(`No module named \`${moduleName}\` in config.`);
    }
    try {
      registry.populateFromModule(mod);
    } catch (err) {
      rollbackModuleRegistrations(registry, moduleName);
      throw err;
    }
  }
  registry.currentModuleName = undefined;

  return registry;
}

export async function loadAppRuntime(workspaceRoot: string, site: DiscoveredSiteWorkspace) {
  const config = await loadKernelAppConfig(site);
  const cacheKey = `site:${site.configPath}`;
  const registry = await getOrBuildRegistry(cacheKey, config);
  return { config, registry };
}

export async function listSiteWorkspaces(workspaceRoot: string): Promise<SiteWorkspacesListResult> {
  const sites = await discoverSiteWorkspaces(workspaceRoot);
  return {
    workspaceRoot,
    sites,
  };
}

async function resolveSiteByName(
  workspaceRoot: string,
  siteName?: string,
): Promise<DiscoveredSiteWorkspace | undefined> {
  const sites = await discoverSiteWorkspaces(workspaceRoot);
  if (sites.length === 0) {
    return undefined;
  }

  if (siteName) {
    return sites.find((site) => site.name === siteName);
  }

  const currentWorkingDirectory = path.resolve(process.cwd());
  const currentSite = sites.find((site) => {
    const resolvedSiteDir = path.resolve(site.directory);
    return currentWorkingDirectory.toLowerCase().startsWith(resolvedSiteDir.toLowerCase());
  });
  if (currentSite) {
    return currentSite;
  }

  if (sites.length === 1) {
    return sites[0];
  }

  return undefined;
}

export async function ensureTargetSites(
  workspaceRoot: string,
  allSites: boolean,
  siteName?: string,
): Promise<DiscoveredSiteWorkspace[]> {
  const sites = await discoverSiteWorkspaces(workspaceRoot);

  if (allSites) {
    return sites.filter((site) => site.configPath);
  }

  const site = await resolveSiteByName(workspaceRoot, siteName);
  return site ? [site] : [];
}

export async function listRegisteredKernelCommandNames(workspaceRoot: string): Promise<string[]> {
  const names = new Set<string>();
  const wsRegistry = await getOrBuildWorkspaceRegistry(workspaceRoot);
  if (wsRegistry) {
    for (const commandName of wsRegistry.listCommandNames()) names.add(commandName);
  }

  const sites = await discoverSiteWorkspaces(workspaceRoot);
  for (const site of sites.filter((candidate) => candidate.configPath)) {
    try {
      const { registry } = await loadAppRuntime(workspaceRoot, site);
      for (const commandName of registry.listCommandNames()) names.add(commandName);
    } catch (err) {
      process.stderr.write(
        `  [registry] WARNING: skipped site "${site.name}" — failed to load app runtime: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  return [...names].sort();
}

function commandInfo(
  command: KernelCommandDefinition,
  provider: KernelRegisteredCommandInfo["provider"],
  siteName?: string,
  moduleName?: string,
): KernelRegisteredCommandInfo {
  return {
    name: command.name,
    description: command.description,
    scope: command.scope,
    mutatesState: command.mutatesState,
    requiresNetwork: command.requiresNetwork,
    supportsAllSites: command.supportsAllSites,
    timeoutMs: command.timeoutMs,
    expectedDurationMs: command.expectedDurationMs,
    longRunning: command.longRunning,
    ...(moduleName ? { module: moduleName } : {}),
    ...(command.flags ? { flags: command.flags } : {}),
    ...(command.reads ? { reads: command.reads } : {}),
    ...(command.writes ? { writes: command.writes } : {}),
    ...(command.cacheable !== undefined ? { cacheable: command.cacheable } : {}),
    ...(command.gate ? { gate: command.gate } : {}),
    ...(command.validatesOutputs ? { validatesOutputs: command.validatesOutputs } : {}),
    ...(command.generates ? { generates: command.generates } : {}),
    ...(command.modulePath ? { moduleBasePath: deriveModuleBasePath(command.modulePath) } : {}),
    provider,
    siteName,
  };
}

/**
 * RFC-1028: Derive the module's src/ directory from a repo-relative modulePath.
 * Given "packages/werkstatt-engine/src/kernel/runtime/registry.ts", returns
 * "packages/werkstatt-engine/src" — everything up to and including the src/ segment.
 * Returns undefined if no src/ segment is found.
 */
export function deriveModuleBasePath(modulePath: string): string | undefined {
  const srcIndex = modulePath.indexOf("/src/");
  if (srcIndex === -1) return undefined;
  return modulePath.slice(0, srcIndex + 4); // include "/src"
}

export async function listRegisteredKernelCommands(
  workspaceRoot: string,
): Promise<KernelRegisteredCommandInfo[]> {
  const byKey = new Map<string, KernelRegisteredCommandInfo>();

  const wsRegistry = await getOrBuildWorkspaceRegistry(workspaceRoot);
  if (wsRegistry) {
    for (const commandName of wsRegistry.listCommandNames()) {
      const command = wsRegistry.getCommand(commandName);
      if (command)
        byKey.set(
          `workspace:${commandName}`,
          commandInfo(command, "workspace", undefined, wsRegistry.commandModules.get(commandName)),
        );
    }
  }

  const sites = await discoverSiteWorkspaces(workspaceRoot);
  for (const site of sites.filter((candidate) => candidate.configPath)) {
    try {
      const { registry } = await loadAppRuntime(workspaceRoot, site);
      for (const commandName of registry.listCommandNames()) {
        const command = registry.getCommand(commandName);
        if (command)
          byKey.set(
            `site:${site.name}:${commandName}`,
            commandInfo(command, "site", site.name, registry.commandModules.get(commandName)),
          );
      }
    } catch (err) {
      process.stderr.write(
        `  [registry] WARNING: skipped site "${site.name}" — failed to load app runtime: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  return [...byKey.values()].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    const byProvider = a.provider.localeCompare(b.provider);
    if (byProvider !== 0) return byProvider;
    return (a.siteName ?? "").localeCompare(b.siteName ?? "");
  });
}

/**
 * RFC-0266: pipeline name -> ordered list of member command names, across the
 * workspace-root registry and every discovered app's registry. Used to derive
 * each command manifest entry's `pipelines` membership.
 */
export async function listRegisteredKernelPipelines(
  workspaceRoot: string,
): Promise<Record<string, string[]>> {
  const pipelines: Record<string, string[]> = {};

  const wsRegistry = await getOrBuildWorkspaceRegistry(workspaceRoot);
  if (wsRegistry) {
    for (const [name, steps] of wsRegistry.pipelines) {
      pipelines[name] = steps.map((step) => step.command);
    }
  }

  const sites = await discoverSiteWorkspaces(workspaceRoot);
  for (const site of sites.filter((candidate) => candidate.configPath)) {
    try {
      const { registry } = await loadAppRuntime(workspaceRoot, site);
      for (const [name, steps] of registry.pipelines) {
        if (!(name in pipelines)) pipelines[name] = steps.map((step) => step.command);
      }
    } catch (err) {
      process.stderr.write(
        `  [registry] WARNING: skipped site "${site.name}" — failed to load app runtime: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  return pipelines;
}
