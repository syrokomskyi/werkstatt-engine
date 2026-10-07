import { test, expect, describe } from "vitest";
import { assertAllFlagAccepted, computeOwnershipMap } from "../execute-command.ts";
import type { KernelCommandDefinition } from "@warpgogol/werkstatt-shared/kernel";

const mockCommand: KernelCommandDefinition = {
  name: "test.cmd",
  description: "test",
  scope: "workspace",
  execute: async () => ({ exitCode: 0, ok: true, summary: "ok" }),
};

describe("assertAllFlagAccepted", () => {
  test("does not throw when allSites=false", () => {
    expect(() => assertAllFlagAccepted(mockCommand, false)).not.toThrow();
  });

  test("does not throw when allSites=true and acceptsAllFlag=true", () => {
    const cmd = { ...mockCommand, acceptsAllFlag: true };
    expect(() => assertAllFlagAccepted(cmd, true)).not.toThrow();
  });

  test("throws when allSites=true and acceptsAllFlag is undefined", () => {
    expect(() => assertAllFlagAccepted(mockCommand, true)).toThrow(/does not accept --all/);
  });

  test("throws when allSites=true and acceptsAllFlag=false", () => {
    const cmd = { ...mockCommand, acceptsAllFlag: false };
    expect(() => assertAllFlagAccepted(cmd, true)).toThrow(/does not accept --all/);
  });

  test("error message includes command name", () => {
    expect(() => assertAllFlagAccepted(mockCommand, true)).toThrow(/test\.cmd/);
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
