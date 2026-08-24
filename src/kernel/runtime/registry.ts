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
  SiteWorkspacesListResult,
  KernelCommandDefinition,
  KernelRegisteredCommandInfo,
} from "../types.ts";

export async function buildRegistry(config: KernelAppConfig): Promise<KernelRegistry> {
  const registry = new KernelRegistry();

  if (config.modules) {
    for (const moduleDefinition of config.modules) {
      process.stderr.write(`  [registry] loading module ${moduleDefinition.name} …\n`);
      registry.currentModuleName = moduleDefinition.name;
      await moduleDefinition.register(registry);
    }
  } else if (config.moduleLoaders) {
    for (const [moduleName, loader] of Object.entries(config.moduleLoaders)) {
      process.stderr.write(`  [registry] loading module ${moduleName} …\n`);
      const moduleDefinition = await loader();
      registry.currentModuleName = moduleName;
      await moduleDefinition.register(registry);
    }
  }
  registry.currentModuleName = undefined;

  if (config.pipelines) {
    for (const [name, steps] of Object.entries(config.pipelines)) {
      registry.registerPipeline(name, steps);
    }
  }

  return registry;
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
    const moduleDefinition = await loader();
    registry.currentModuleName = moduleName;
    await moduleDefinition.register(registry);
  } else if (config.modules) {
    const moduleDefinition = config.modules.find((m) => m.name === moduleName);
    if (!moduleDefinition) {
      throw new Error(`No module named \`${moduleName}\` in config.`);
    }
    registry.currentModuleName = moduleName;
    await moduleDefinition.register(registry);
  }
  registry.currentModuleName = undefined;

  if (config.pipelines) {
    for (const [name, steps] of Object.entries(config.pipelines)) {
      registry.registerPipeline(name, steps);
    }
  }

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
    const { registry } = await loadAppRuntime(workspaceRoot, site);
    for (const commandName of registry.listCommandNames()) names.add(commandName);
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
    provider,
    siteName,
  };
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
    const { registry } = await loadAppRuntime(workspaceRoot, site);
    for (const commandName of registry.listCommandNames()) {
      const command = registry.getCommand(commandName);
      if (command)
        byKey.set(
          `site:${site.name}:${commandName}`,
          commandInfo(command, "site", site.name, registry.commandModules.get(commandName)),
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
    const { registry } = await loadAppRuntime(workspaceRoot, site);
    for (const [name, steps] of registry.pipelines) {
      if (!(name in pipelines)) pipelines[name] = steps.map((step) => step.command);
    }
  }

  return pipelines;
}
