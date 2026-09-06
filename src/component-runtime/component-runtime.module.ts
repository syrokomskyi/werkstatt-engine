/*
<MODULE_CONTRACT>
<purpose>RFC-1030: registers runtime.reflect.* kernel commands for live
  runtime reflection of the component graph, capabilities, health, and fibers.</purpose>
<non-goals>
  <item>Does not implement reflection logic — that lives in reflection.ts.</item>
  <item>Does not register non-reflection commands.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1030: initial implementation — registers 5 runtime.reflect.* commands.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../runtime/desired-state.ts";

export async function createComponentRuntimeModule(): Promise<ModuleExport> {
  const {
    runReflectGraph,
    runReflectCapabilities,
    runReflectHealth,
    runReflectFibers,
    runReflectCatalogGenerate,
  } = await import("./reflection-commands.ts");

  const modulePath = "packages/werkstatt-engine/src/component-runtime/component-runtime.module.ts";
  return {
    name: "component-runtime",
    version: "0.1.0",

    declarations: [],
    commands: [
      {
        name: "runtime.reflect.graph",
        modulePath,
        description:
          "Reflect the live component graph: all components, their fiber states, dependencies, " +
          "and health status. Returns RuntimeReflectionV1 as JSON (RFC-1030). " +
          "Flags: --component <id> to filter to a single component.",
        scope: "workspace",
        mutatesState: false,
        cacheable: false,
        generates: [],
        flags: {
          component: {
            kind: "string",
            description: "Filter to a single component by ID.",
          },
        },
        execute: runReflectGraph,
      },
      {
        name: "runtime.reflect.capabilities",
        modulePath,
        description:
          "Reflect the live capability catalog: all capability IDs, their providers, " +
          "lifecycle states, and callable status. Returns CapabilityCatalogV1 as JSON (RFC-1030).",
        scope: "workspace",
        mutatesState: false,
        cacheable: false,
        generates: [],
        execute: runReflectCapabilities,
      },
      {
        name: "runtime.reflect.health",
        modulePath,
        description:
          "Reflect health check results for all components with health checks defined. " +
          "Runs health checks in parallel with per-component timeout 5s and global batch " +
          "timeout 10s (RFC-1030).",
        scope: "workspace",
        mutatesState: false,
        cacheable: false,
        generates: [],
        flags: {
          "health-timeout": {
            kind: "string",
            description: "Per-component health check timeout (default: 5s).",
          },
        },
        execute: runReflectHealth,
      },
      {
        name: "runtime.reflect.fibers",
        modulePath,
        description:
          "Reflect a lightweight view of component fiber states only: " +
          "array of { componentId, fiberState }. Faster than runtime.reflect.graph (RFC-1030).",
        scope: "workspace",
        mutatesState: false,
        cacheable: false,
        generates: [],
        execute: runReflectFibers,
      },
      {
        name: "runtime.reflect.catalog.generate",
        modulePath,
        description:
          "Generate a freshness-gated capability catalog and write it to " +
          "docs/runtime-catalog.generated.yaml (gitignored). Detects staleness via " +
          "REFLECTION-01 hash mismatch (RFC-1030).",
        scope: "workspace",
        mutatesState: true,
        cacheable: false,
        writes: ["docs/runtime-catalog.generated.yaml"],
        generates: [{ path: "docs/runtime-catalog.generated.yaml", phase: "build.prepare" }],
        execute: runReflectCatalogGenerate,
      },
    ],
    pipelines: [],
  };
}
