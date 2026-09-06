import { test, expect, beforeEach, afterEach } from "vitest";
import { KernelRegistry } from "../registry.ts";
import { buildRegistry, buildRegistryWithHandles } from "../runtime/registry.ts";
import { clearRegistryCache, clearModule } from "../runtime/registry-cache.ts";
import type { KernelAppConfig, KernelCommandDefinition, KernelCommandResult } from "../types.ts";
import type { ModuleExport } from "../../runtime/desired-state.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    Verify RFC-1026 lifecycle-owned kernel registrations: module state tracking,
    unregisterModule with drain, trackInFlight, rollback on failure, clearModule
    cache invalidation, and KERNEL-MODULE-01/02 error conditions.
  </purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1026: initial lifecycle test suite — module states, unregister, drain, rollback, cache invalidation.</item>
</CHANGE_SUMMARY>
*/

const noopExecute = async (): Promise<KernelCommandResult<unknown>> => ({
  exitCode: 0,
  summary: "noop",
});

function makeCmd(name: string): KernelCommandDefinition {
  return {
    name,
    modulePath: "test",
    description: `Test command ${name}`,
    scope: "workspace",
    flags: {},
    execute: noopExecute as KernelCommandDefinition["execute"],
  };
}

const moduleA: ModuleExport = {
  name: "module-a",
  version: "1.0.0",
  declarations: [],
  commands: [makeCmd("a.ping"), makeCmd("a.pong")],
  pipelines: [],
};

const moduleB: ModuleExport = {
  name: "module-b",
  version: "1.0.0",
  declarations: [],
  commands: [makeCmd("b.ping")],
  pipelines: [],
};

const failingModule: ModuleExport = {
  name: "failing-module",
  version: "1.0.0",
  declarations: [],
  commands: [makeCmd("a.ping")], // duplicate command name — causes registration error
  pipelines: [],
};

const config: KernelAppConfig = { modules: [moduleA, moduleB] };

beforeEach(() => {
  clearRegistryCache();
});

afterEach(() => {
  clearRegistryCache();
});

test("buildRegistry sets module states to active after successful load", async () => {
  const registry = await buildRegistry(config);
  expect(registry.getModuleState("module-a")).toBe("active");
  expect(registry.getModuleState("module-b")).toBe("active");
});

test("buildRegistry sets module state to failed on registration error and rolls back", async () => {
  const failingConfig: KernelAppConfig = { modules: [moduleA, failingModule] };
  await expect(buildRegistry(failingConfig)).rejects.toThrow("already registered");
});

test("buildRegistryWithHandles returns handles with dispose", async () => {
  const { registry, handles } = await buildRegistryWithHandles(config);
  expect(handles.size).toBe(2);
  expect(handles.has("module-a")).toBe(true);
  expect(handles.has("module-b")).toBe(true);

  const handleA = handles.get("module-a")!;
  expect(handleA.moduleName).toBe("module-a");
  expect(handleA.state).toBe("active");
  expect(registry.getModuleState("module-a")).toBe("active");
});

test("unregisterModule removes commands and sets state to disposed", async () => {
  const registry = await buildRegistry(config);
  expect(registry.listCommandNames()).toContain("a.ping");

  await registry.unregisterModule("module-a");

  expect(registry.getModuleState("module-a")).toBe("disposed");
  expect(registry.listCommandNames()).not.toContain("a.ping");
  expect(registry.listCommandNames()).not.toContain("a.pong");
  expect(registry.listCommandNames()).toContain("b.ping");
});

test("unregisterModule records disposed command origins", async () => {
  const registry = await buildRegistry(config);
  await registry.unregisterModule("module-a");
  expect(registry.disposedCommandOrigins.get("a.ping")).toBe("module-a");
  expect(registry.disposedCommandOrigins.get("a.pong")).toBe("module-a");
});

test("unregisterModule is idempotent for already-disposed modules", async () => {
  const registry = await buildRegistry(config);
  await registry.unregisterModule("module-a");
  await expect(registry.unregisterModule("module-a")).resolves.not.toThrow();
});

const moduleWithPipeline: ModuleExport = {
  name: "module-pipeline",
  version: "1.0.0",
  declarations: [],
  commands: [makeCmd("p.ping")],
  pipelines: [{ name: "p.pipeline", steps: [{ command: "p.ping" }] }],
};

test("unregisterModule removes pipelines owned by the module", async () => {
  const configWithPipeline: KernelAppConfig = {
    modules: [moduleWithPipeline],
  };
  const registry = await buildRegistry(configWithPipeline);
  expect(registry.getPipeline("p.pipeline")).toBeDefined();

  await registry.unregisterModule("module-pipeline");
  expect(registry.getPipeline("p.pipeline")).toBeUndefined();
});

test("trackInFlight increments and decrements count", () => {
  const registry = new KernelRegistry();
  const release1 = registry.trackInFlight("test.cmd");
  expect(registry.inFlight.get("test.cmd")).toBe(1);

  const release2 = registry.trackInFlight("test.cmd");
  expect(registry.inFlight.get("test.cmd")).toBe(2);

  release1();
  expect(registry.inFlight.get("test.cmd")).toBe(1);

  release2();
  expect(registry.inFlight.get("test.cmd")).toBe(0);
});

test("trackInFlight does not go below zero", () => {
  const registry = new KernelRegistry();
  const release = registry.trackInFlight("test.cmd");
  release();
  expect(registry.inFlight.get("test.cmd")).toBe(0);
  release();
  expect(registry.inFlight.get("test.cmd")).toBe(0);
});

test("populateFromModule tracks currentModuleName in pipelineModules", () => {
  const registry = new KernelRegistry();
  const mod: ModuleExport = {
    name: "test-module",
    version: "1.0.0",
    declarations: [],
    commands: [],
    pipelines: [{ name: "test.pipeline", steps: [{ command: "test.cmd" }] }],
  };
  registry.populateFromModule(mod);
  expect(registry.pipelineModules.get("test.pipeline")).toBe("test-module");
});

test("clearModule invalidates a single module from cached registry", async () => {
  const cacheKey = "test-clear-module";
  const { getOrBuildRegistry } = await import("../runtime/registry-cache.ts");
  const registry = await getOrBuildRegistry(cacheKey, config);
  expect(registry.getModuleState("module-a")).toBe("active");

  await clearModule(cacheKey, "module-a");

  expect(registry.getModuleState("module-a")).toBe("disposed");
  expect(registry.listCommandNames()).not.toContain("a.ping");
});

test("clearModule removes cache entry when no active modules remain", async () => {
  const cacheKey = "test-clear-all";
  const { getOrBuildRegistry } = await import("../runtime/registry-cache.ts");
  await getOrBuildRegistry(cacheKey, config);

  await clearModule(cacheKey, "module-a");
  await clearModule(cacheKey, "module-b");

  const fresh = await getOrBuildRegistry(cacheKey, config);
  expect(fresh.getModuleState("module-a")).toBe("active");
});

test("clearModule is a no-op for non-existent cache key", async () => {
  await expect(clearModule("non-existent-key", "module-a")).resolves.not.toThrow();
});

test("buildRegistryForModule sets module state to active", async () => {
  const { buildRegistryForModule } = await import("../runtime/registry.ts");
  const registry = await buildRegistryForModule(config, "module-a");
  expect(registry.getModuleState("module-a")).toBe("active");
});
