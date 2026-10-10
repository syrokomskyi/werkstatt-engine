/*
<MODULE_CONTRACT>
<purpose>
Kernel registry assembly and app-target resolution: build an ActualState from a loaded
app/workspace config, list registered commands/pipelines across the workspace + every
discovered app, and resolve which app(s) a CLI invocation targets.
</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>The registry builds ActualState from a loaded app — resolution is explicit, not ambient.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1147/RFC-1148: listStaticCommandSurface — static enumeration over the workspace registry plus SITE_MODULE_MAP replaces listRegisteredKernelCommand*; commandInfo drops the siteName param (provider union narrowed to workspace | site-module).</item>
  <item>RFC-1147: site-module materialization memoized via getOrBuildSiteModuleStates — one materialization per workspaceRoot instead of 18 dynamic imports per call.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
  <item>RFC-1193: bound module hashing to src/os roots with constant fallbacks</item>
  <item>RFC-1231: step 1 — rename supportsAllSites to acceptsAllFlag

Mechanical sweep: the field only ever gated --all argv acceptance; fan-out
follows the parsed selector. Guard renamed assertAllSitesAllowed ->
assertAllFlagAccepted, message updated. 417 declaration sites + type
surfaces (KernelCommandMetadata, ForgeCommandMetadata) in one atomic pass.</item>
  <history>ADR-0022, RFC-0303, RFC-0960, RFC-1026, RFC-1038, RFC-1097, RFC-1138, RFC-1144</history>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import process from "node:process";
import { discoverSiteWorkspaces, loadKernelAppConfig } from "../discovery.ts";
import {
  getOrBuildRegistry,
  getOrBuildSiteModuleStates,
  getOrBuildWorkspaceRegistry,
} from "./registry-cache.ts";
import { buildActualState } from "../../runtime/reconciler.ts";
import { validateDeclarations } from "../../runtime/validate-declarations.ts";
import { siteModuleLoaders } from "../module-map.ts";
import type {
  DiscoveredSiteWorkspace,
  KernelAppConfig,
  SiteWorkspacesListResult,
  KernelCommandDefinition,
  KernelRegisteredCommandInfo,
} from "@warpgogol/werkstatt-shared/kernel";
import type { ActualState, ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function buildRegistry(config: KernelAppConfig): Promise<ActualState> {
  const exports: ModuleExport[] = [];

  if (config.modules) {
    for (const mod of config.modules) {
      process.stderr.write(`  [registry] loading module ${mod.name} …\n`);
      exports.push(mod);
    }
  } else if (config.moduleLoaders) {
    for (const [moduleName, loader] of Object.entries(config.moduleLoaders)) {
      process.stderr.write(`  [registry] loading module ${moduleName} …\n`);
      const mod = await loader();
      assertModuleExport(mod, moduleName);
      exports.push(mod);
    }
  }

  const actualState = buildActualState(exports);

  // RFC-1138: pass loaded module names — module-scoped GENERATOR_OWNERSHIP_EXEMPT
  // entries are only stale-checked when their owning module was loaded.
  validateDeclarations(actualState.commands, {
    loadedModules: new Set(exports.map((m) => m.name)),
  });

  return actualState;
}

/**
 * Fail fast when a module loader resolves to something that is not a
 * ModuleExport — a renamed/removed export surfaces as `undefined` and would
 * otherwise crash later with an opaque TypeError (or silently drop the
 * module's whole command surface).
 */
function assertModuleExport(
  mod: ModuleExport | undefined | null,
  loaderKey: string,
): asserts mod is ModuleExport {
  if (mod === undefined || mod === null || typeof mod !== "object" || typeof mod.name !== "string") {
    throw new Error(
      `Module loader \`${loaderKey}\` did not return a module (got ${
        mod === null ? "null" : typeof mod
      }) — the loader's import specifier or export name is likely stale.`,
    );
  }
}

export async function buildRegistryForModule(
  config: KernelAppConfig,
  moduleName: string,
): Promise<ActualState> {
  if (config.moduleLoaders) {
    const loader = config.moduleLoaders[moduleName];
    if (!loader) {
      throw new Error(`No module loader registered for module \`${moduleName}\`.`);
    }
    const mod = await loader();
    assertModuleExport(mod, moduleName);
    const actualState = buildActualState([mod]);
    return actualState;
  } else if (config.modules) {
    const mod = config.modules.find((m) => m.name === moduleName);
    if (!mod) {
      throw new Error(`No module named \`${moduleName}\` in config.`);
    }
    const actualState = buildActualState([mod]);
    return actualState;
  }
  const emptyState = buildActualState([]);
  return emptyState;
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

function commandInfo(
  command: KernelCommandDefinition,
  provider: KernelRegisteredCommandInfo["provider"],
  moduleName?: string,
): KernelRegisteredCommandInfo {
  return {
    name: command.name,
    description: command.description,
    scope: command.scope,
    mutatesState: command.mutatesState,
    ...(command.execOnReadOnly ? { execOnReadOnly: command.execOnReadOnly } : {}),
    ...(command.mutatingFlags ? { mutatingFlags: command.mutatingFlags } : {}),
    requiresNetwork: command.requiresNetwork,
    acceptsAllFlag: command.acceptsAllFlag,
    timeoutMs: command.timeoutMs,
    expectedDurationMs: command.expectedDurationMs,
    longRunning: command.longRunning,
    ...(moduleName ? { module: moduleName } : {}),
    ...(command.flags ? { flags: command.flags } : {}),
    ...(command.reads ? { reads: command.reads } : {}),
    ...(command.writes ? { writes: command.writes } : {}),
    ...(command.cacheable !== undefined ? { cacheable: command.cacheable } : {}),
    ...(command.coverage ? { coverage: command.coverage } : {}),
    ...(command.coverageNote ? { coverageNote: command.coverageNote } : {}),
    ...(command.gate ? { gate: command.gate } : {}),
    ...(command.validatesOutputs ? { validatesOutputs: command.validatesOutputs } : {}),
    ...(command.generates ? { generates: command.generates } : {}),
    ...(command.modulePath
      ? { modulePath: command.modulePath, moduleBasePath: deriveModuleBasePath(command.modulePath) }
      : {}),
    ...(command.modulePaths ? { modulePaths: command.modulePaths } : {}),
    provider,
  };
}

/**
 * RFC-1028: Derive the module's src/ or os/ directory from a repo-relative
 * modulePath. Given "packages/werkstatt-engine/src/kernel/runtime/registry.ts",
 * returns "packages/werkstatt-engine/src" — everything up to and including the
 * src/ segment. RFC-1193: `/os/` is a module-root segment alongside `/src/`
 * ("packages/forge/os/rfc/rfc.module.ts" → "packages/forge/os"); the first
 * occurring segment wins. Returns undefined if neither segment is found.
 */
export function deriveModuleBasePath(modulePath: string): string | undefined {
  const srcIndex = modulePath.indexOf("/src/");
  const osIndex = modulePath.indexOf("/os/");
  if (srcIndex === -1 && osIndex === -1) return undefined;
  if (srcIndex !== -1 && (osIndex === -1 || srcIndex < osIndex)) {
    return modulePath.slice(0, srcIndex + 4); // include "/src"
  }
  return modulePath.slice(0, osIndex + 3); // include "/os"
}

/**
 * RFC-1147/RFC-1148: the static command surface — workspace registry plus the
 * canonical site module set (SITE_MODULE_MAP), enumerated without discovering
 * or loading any site instance. Pure function of source data: identical output
 * with or without a mission workpiece present.
 *
 * `siteModules` is injectable for unit tests; production callers omit it and
 * get siteModuleLoaders() (the same map kernel.config.template.ts delegates to).
 */
export interface StaticCommandSurface {
  commands: KernelRegisteredCommandInfo[];
  pipelines: Record<string, string[]>;
}

// @ai-invariant The static surface MUST be fail-fast: a throwing module
// loader kills the whole call (a partially-enumerated surface silently
// hides commands — route tolerant scans through loadSurfaceDeclarations
// instead). The surface is a union of the workspace registry AND the
// canonical site-module set — post RFC-1147, consumers resolving commands
// by name must check both (RFC-1157).
export async function listStaticCommandSurface(
  workspaceRoot: string,
  siteModules?: Record<string, () => Promise<ModuleExport>>,
): Promise<StaticCommandSurface> {
  const byKey = new Map<string, KernelRegisteredCommandInfo>();
  const pipelines: Record<string, string[]> = {};

  const wsRegistry = await getOrBuildWorkspaceRegistry(workspaceRoot);
  if (wsRegistry) {
    for (const [commandName, command] of wsRegistry.commands) {
      byKey.set(
        `workspace:${commandName}`,
        commandInfo(command, "workspace", wsRegistry.commandModules?.get(commandName)),
      );
    }
    for (const [name, decl] of wsRegistry.pipelines) {
      pipelines[name] = decl.steps.map((step) => step.command);
    }
  }

  // Production path materializes the canonical site set once per workspaceRoot
  // (process-lifetime cache); injected siteModules always materialize fresh.
  let siteStates: Map<string, ActualState>;
  if (siteModules === undefined) {
    siteStates = await getOrBuildSiteModuleStates(workspaceRoot, siteModuleLoaders());
  } else {
    siteStates = new Map();
    for (const [moduleName, loader] of Object.entries(siteModules)) {
      siteStates.set(moduleName, buildActualState([await loader()]));
    }
  }
  for (const [moduleName, actualState] of siteStates) {
    for (const [commandName, command] of actualState.commands) {
      byKey.set(
        `site-module:${commandName}`,
        commandInfo(
          command,
          "site-module",
          actualState.commandModules?.get(commandName) ?? moduleName,
        ),
      );
    }
    for (const [name, decl] of actualState.pipelines) {
      if (!(name in pipelines)) pipelines[name] = decl.steps.map((step) => step.command);
    }
  }

  const commands = [...byKey.values()].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.provider.localeCompare(b.provider);
  });

  return { commands, pipelines };
}
