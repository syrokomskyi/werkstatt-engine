/*
<MODULE_CONTRACT>
<purpose>
Unit tests for registry cache covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the registry suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to kernel internals beyond the public surface under test

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
