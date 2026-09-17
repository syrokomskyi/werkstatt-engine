import { test, expect, describe } from "vitest";
import { assertAllSitesAllowed, computeOwnershipMap } from "../execute-command.ts";
import type { KernelCommandDefinition } from "@warpgogol/werkstatt-shared/kernel";

const mockCommand: KernelCommandDefinition = {
  name: "test.cmd",
  description: "test",
  scope: "workspace",
  execute: async () => ({ exitCode: 0, ok: true, summary: "ok" }),
};

describe("assertAllSitesAllowed", () => {
  test("does not throw when allSites=false", () => {
    expect(() => assertAllSitesAllowed(mockCommand, false)).not.toThrow();
  });

  test("does not throw when allSites=true and supportsAllSites=true", () => {
    const cmd = { ...mockCommand, supportsAllSites: true };
    expect(() => assertAllSitesAllowed(cmd, true)).not.toThrow();
  });

  test("throws when allSites=true and supportsAllSites is undefined", () => {
    expect(() => assertAllSitesAllowed(mockCommand, true)).toThrow(/does not support --all/);
  });

  test("throws when allSites=true and supportsAllSites=false", () => {
    const cmd = { ...mockCommand, supportsAllSites: false };
    expect(() => assertAllSitesAllowed(cmd, true)).toThrow(/does not support --all/);
  });

  test("error message includes command name", () => {
    expect(() => assertAllSitesAllowed(mockCommand, true)).toThrow(/test\.cmd/);
  });
});

describe("computeOwnershipMap", () => {
  test("returns undefined or array without throwing", { timeout: 60_000 }, async () => {
    const registry = {
      commands: new Map(),
      pipelines: new Map(),
    } as never;
    const result = await computeOwnershipMap(registry);
    expect(result === undefined || Array.isArray(result)).toBe(true);
  });
});
