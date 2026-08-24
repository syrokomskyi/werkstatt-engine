import { test, expect, beforeEach, afterEach } from "vitest";
import {
  getOrBuildRegistry,
  clearRegistryCache,
  setRegistryCacheEnabled,
  isRegistryCacheEnabled,
} from "../runtime/registry-cache.ts";
import type { KernelAppConfig, KernelModule } from "../types.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    Verify ADR-0022 process-lifetime registry cache behavior: cache hit on second call,
    cache disabled by setRegistryCacheEnabled(false), and clearRegistryCache invalidation.
  </purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0022: initial test for process-lifetime registry cache.</item>
</CHANGE_SUMMARY>
*/

const mockModule: KernelModule = {
  name: "test-module",
  version: "1.0.0",
  register(registry) {
    registry.registerCommand({
      name: "test.ping",
      description: "Test command",
      scope: "workspace",
      execute: async () => ({ exitCode: 0, ok: true, summary: "pong" }),
    });
  },
};

const mockConfig: KernelAppConfig = {
  modules: [mockModule],
};

beforeEach(() => {
  clearRegistryCache();
  setRegistryCacheEnabled(true);
});

afterEach(() => {
  clearRegistryCache();
  setRegistryCacheEnabled(true);
});

test("getOrBuildRegistry returns the same instance on second call (cache hit)", async () => {
  const first = await getOrBuildRegistry("test-key-1", mockConfig);
  const second = await getOrBuildRegistry("test-key-1", mockConfig);

  expect(second).toBe(first);
});

test("getOrBuildRegistry returns different instances for different cache keys", async () => {
  const first = await getOrBuildRegistry("test-key-a", mockConfig);
  const second = await getOrBuildRegistry("test-key-b", mockConfig);

  expect(second).not.toBe(first);
});

test("setRegistryCacheEnabled(false) bypasses cache and builds fresh registry", async () => {
  const first = await getOrBuildRegistry("test-key-2", mockConfig);

  setRegistryCacheEnabled(false);

  const second = await getOrBuildRegistry("test-key-2", mockConfig);

  expect(second).not.toBe(first);
  expect(isRegistryCacheEnabled()).toBe(false);
});

test("setRegistryCacheEnabled(false) clears existing cached entries", async () => {
  await getOrBuildRegistry("test-key-3", mockConfig);

  setRegistryCacheEnabled(false);

  expect(isRegistryCacheEnabled()).toBe(false);
});

test("clearRegistryCache forces a fresh build on next call", async () => {
  const first = await getOrBuildRegistry("test-key-4", mockConfig);

  clearRegistryCache();

  const second = await getOrBuildRegistry("test-key-4", mockConfig);

  expect(second).not.toBe(first);
});

test("cached registry is functional — commands are registered", async () => {
  const registry = await getOrBuildRegistry("test-key-5", mockConfig);

  expect(registry.listCommandNames()).toContain("test.ping");
  expect(registry.getCommand("test.ping")?.description).toBe("Test command");
});

test("re-enabling cache after disable resumes caching", async () => {
  setRegistryCacheEnabled(false);
  const first = await getOrBuildRegistry("test-key-6", mockConfig);

  setRegistryCacheEnabled(true);
  const second = await getOrBuildRegistry("test-key-6", mockConfig);
  const third = await getOrBuildRegistry("test-key-6", mockConfig);

  expect(second).not.toBe(first);
  expect(third).toBe(second);
});
