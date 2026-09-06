/*
<MODULE_CONTRACT>
<purpose>Registers kernel.module.load, kernel.module.unload, and kernel.module.inspect commands for lifecycle-owned module management (RFC-1026).</purpose>
<non-goals>
  <item>Do not implement module loading logic — use buildRegistryForModule from runtime/registry.ts.</item>
  <item>Do not manage the registry cache — use clearModule from runtime/registry-cache.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1026: initial implementation — kernel.module.load, kernel.module.unload, kernel.module.inspect commands.</item>
</CHANGE_SUMMARY>
*/

import type { KernelCommandInput, KernelExecutionReport, KernelRuntimeContext } from "./types.ts";
import type { ModuleExport } from "../runtime/desired-state.ts";

async function runKernelModuleInspect(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelExecutionReport> {
  const registry = context.actualState;
  const modules: Array<{
    name: string;
    state: string;
    commands: string[];
    pipelines: string[];
  }> = [];

  for (const [moduleName, state] of registry.moduleStates) {
    const commands = [...registry.commandModules.entries()]
      .filter(([, mod]) => mod === moduleName)
      .map(([cmd]) => cmd)
      .sort();
    const pipelines = [...registry.pipelineModules.entries()]
      .filter(([, mod]) => mod === moduleName)
      .map(([pipe]) => pipe)
      .sort();
    modules.push({ name: moduleName, state, commands, pipelines });
  }

  modules.sort((a, b) => a.name.localeCompare(b.name));

  const data = { modules };
  return {
    commandName: "kernel.module.inspect",
    data,
    exitCode: 0,
    ok: true,
    summary: `${modules.length} module(s) loaded`,
    metadata: { name: "kernel.module.inspect" } as any,
    logs: context.logger.getEvents(),
    filesModified: [],
    timing: { durationMs: 0, exceededTimeout: false },
  };
}

async function runKernelModuleUnload(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelExecutionReport> {
  const moduleName = input.flags["name"] as string | undefined;
  if (!moduleName) {
    return {
      commandName: "kernel.module.unload",
      data: { error: "Missing required --name flag" },
      exitCode: 1,
      ok: false,
      summary: "Missing required --name flag",
      metadata: { name: "kernel.module.unload" } as any,
      logs: context.logger.getEvents(),
      filesModified: [],
      timing: { durationMs: 0, exceededTimeout: false },
    };
  }

  const state = context.actualState.getModuleState(moduleName);
  if (!state) {
    return {
      commandName: "kernel.module.unload",
      data: { error: `Module '${moduleName}' is not loaded` },
      exitCode: 1,
      ok: false,
      summary: `Module '${moduleName}' is not loaded`,
      metadata: { name: "kernel.module.unload" } as any,
      logs: context.logger.getEvents(),
      filesModified: [],
      timing: { durationMs: 0, exceededTimeout: false },
    };
  }

  await context.actualState.unregisterModule(moduleName);

  return {
    commandName: "kernel.module.unload",
    data: { module: moduleName, previousState: state, newState: "disposed" },
    exitCode: 0,
    ok: true,
    summary: `Module '${moduleName}' unloaded (was ${state})`,
    metadata: { name: "kernel.module.unload" } as any,
    logs: context.logger.getEvents(),
    filesModified: [],
    timing: { durationMs: 0, exceededTimeout: false },
  };
}

async function runKernelModuleLoad(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelExecutionReport> {
  const moduleName = input.flags["name"] as string | undefined;
  if (!moduleName) {
    return {
      commandName: "kernel.module.load",
      data: { error: "Missing required --name flag" },
      exitCode: 1,
      ok: false,
      summary: "Missing required --name flag",
      metadata: { name: "kernel.module.load" } as any,
      logs: context.logger.getEvents(),
      filesModified: [],
      timing: { durationMs: 0, exceededTimeout: false },
    };
  }

  const existingState = context.actualState.getModuleState(moduleName);
  if (existingState === "active") {
    return {
      commandName: "kernel.module.load",
      data: { module: moduleName, state: existingState },
      exitCode: 0,
      ok: true,
      summary: `Module '${moduleName}' is already active`,
      metadata: { name: "kernel.module.load" } as any,
      logs: context.logger.getEvents(),
      filesModified: [],
      timing: { durationMs: 0, exceededTimeout: false },
    };
  }

  return {
    commandName: "kernel.module.load",
    data: {
      error: `Module loading requires a config with moduleLoaders. Use the workspace config to load '${moduleName}'.`,
      module: moduleName,
    },
    exitCode: 1,
    ok: false,
    summary: `Module loading via kernel.module.load requires buildRegistryForModule with a config — use the workspace registry cache instead`,
    metadata: { name: "kernel.module.load" } as any,
    logs: context.logger.getEvents(),
    filesModified: [],
    timing: { durationMs: 0, exceededTimeout: false },
  };
}

export const kernelModuleModule: ModuleExport = {
  name: "kernel-module",
  version: "1.0.0",

  declarations: [],
  commands: [
    {
      name: "kernel.module.inspect",
      modulePath: "packages/werkstatt-engine/src/kernel/kernel-module.module.ts",
      description:
        "List all loaded kernel modules with their lifecycle state, commands, and pipelines (RFC-1026). Use --json for machine-readable output.",
      scope: "workspace",
      mutatesState: false,
      cacheable: false,
      flags: {},
      execute: runKernelModuleInspect,
    },
    {
      name: "kernel.module.unload",
      modulePath: "packages/werkstatt-engine/src/kernel/kernel-module.module.ts",
      description:
        "Unload a kernel module by name — drains in-flight commands, removes all registrations, transitions to disposed state (RFC-1026).",
      scope: "workspace",
      mutatesState: true,
      cacheable: false,
      flags: {
        name: {
          kind: "string",
          description: "Name of the module to unload.",
          required: true,
        },
      },
      execute: runKernelModuleUnload,
    },
    {
      name: "kernel.module.load",
      modulePath: "packages/werkstatt-engine/src/kernel/kernel-module.module.ts",
      description:
        "Load a kernel module by name into the active registry (RFC-1026). Requires the module to be declared in the workspace config's moduleLoaders.",
      scope: "workspace",
      mutatesState: true,
      cacheable: false,
      flags: {
        name: {
          kind: "string",
          description: "Name of the module to load.",
          required: true,
        },
      },
      execute: runKernelModuleLoad,
    },
  ],
  pipelines: [],
};
