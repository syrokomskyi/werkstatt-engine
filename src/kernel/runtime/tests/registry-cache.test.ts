import { test, expect, beforeEach, afterEach } from "vitest";
import {
  getOrBuildRegistry,
  clearRegistryCache,
  setRegistryCacheEnabled,
  isRegistryCacheEnabled,
} from "../registry-cache.ts";
import type { KernelAppConfig } from "@warpgogol/werkstatt-shared/kernel";
import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

const mockModule: ModuleExport = {
  name: "test-module",
  version: "1.0.0",
  declarations: [],
  commands: [
    {
      name: "test.ping",
      modulePath: "test",
      description: "Test command",
      scope: "workspace",
      flags: {},
      execute: async () => ({ exitCode: 0, ok: true, summary: "pong" }),
    },
  ],
  pipelines: [],
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

test("getOrBuildRegistry builds and caches actual state", async () => {
  const r1 = await getOrBuildRegistry("test-key-1", mockConfig);
  expect(r1).toBeDefined();
  const r2 = await getOrBuildRegistry("test-key-1", mockConfig);
  expect(r2).toBe(r1);
});

test("getOrBuildRegistry returns different instances for different keys", async () => {
  const r1 = await getOrBuildRegistry("test-key-a", mockConfig);
  const r2 = await getOrBuildRegistry("test-key-b", mockConfig);
  expect(r1).not.toBe(r2);
});

test("clearRegistryCache invalidates cached entries", async () => {
  const r1 = await getOrBuildRegistry("test-key-clear", mockConfig);
  clearRegistryCache();
  const r2 = await getOrBuildRegistry("test-key-clear", mockConfig);
  expect(r2).not.toBe(r1);
});

test("setRegistryCacheEnabled(false) forces fresh builds", async () => {
  setRegistryCacheEnabled(false);
  const r1 = await getOrBuildRegistry("test-key-disabled", mockConfig);
  const r2 = await getOrBuildRegistry("test-key-disabled", mockConfig);
  expect(r2).not.toBe(r1);
});

test("setRegistryCacheEnabled(false) clears existing cache", async () => {
  await getOrBuildRegistry("test-key-clear-on-disable", mockConfig);
  setRegistryCacheEnabled(false);
  expect(isRegistryCacheEnabled()).toBe(false);
});

test("isRegistryCacheEnabled reflects cache state", () => {
  expect(isRegistryCacheEnabled()).toBe(true);
  setRegistryCacheEnabled(false);
  expect(isRegistryCacheEnabled()).toBe(false);
  setRegistryCacheEnabled(true);
  expect(isRegistryCacheEnabled()).toBe(true);
});
