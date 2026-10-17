/*
<MODULE_CONTRACT>
<purpose>
Unit tests for execute command covering assertAllFlagAccepted; RFC-1231: allSites context carrier and flags.all injection; computeOwnershipMap.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the execute suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to kernel internals beyond the public surface under test

import { test, expect, describe } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertAllFlagAccepted,
  computeOwnershipMap,
  executeRegisteredCommand,
} from "../execute-command.ts";
import { createKernelLogger } from "../../logger.ts";
import {
  createDefaultIO,
  EMPTY_WORKPIECE_ENV,
  type KernelCommandInput,
} from "@warpgogol/werkstatt-shared/kernel";
import type {
  ActualState,
  KernelCommandDefinition,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";

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

describe("RFC-1231: allSites context carrier and flags.all injection", () => {
  function makeContext(root: string, allSites: boolean): KernelRuntimeContext {
    const { io, intents } = createDefaultIO();
    return {
      workspaceRoot: root,
      site: undefined,
      siteExplicit: false,
      logger: createKernelLogger("json"),
      dryRun: false,
      allSites,
      outputFormat: "json",
      io,
      fileIntents: intents,
      actualState: {
        components: new Map(),
        commands: new Map(),
        pipelines: new Map(),
      } as unknown as ActualState,
      workpieceEnv: EMPTY_WORKPIECE_ENV,
    };
  }

  function captureCommand(
    captured: { input?: KernelCommandInput },
    overrides: Partial<KernelCommandDefinition> = {},
  ): KernelCommandDefinition {
    return {
      ...mockCommand,
      execute: async (input) => {
        captured.input = input;
        return { exitCode: 0, ok: true, summary: "ok" };
      },
      ...overrides,
    };
  }

  test("injects flags.all when context.allSites and command declares all", async () => {
    const root = await mkdtemp(join(tmpdir(), "rfc1231-"));
    try {
      const captured: { input?: KernelCommandInput } = {};
      const cmd = captureCommand(captured, {
        flags: { all: { kind: "boolean", description: "all" } },
      });
      const report = await executeRegisteredCommand(cmd, makeContext(root, true), []);
      expect(report.ok).toBe(true);
      expect(captured.input?.flags.all).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not inject flags.all when the flag is not declared", async () => {
    const root = await mkdtemp(join(tmpdir(), "rfc1231-"));
    try {
      const captured: { input?: KernelCommandInput } = {};
      const cmd = captureCommand(captured);
      const report = await executeRegisteredCommand(cmd, makeContext(root, true), []);
      expect(report.ok).toBe(true);
      expect(captured.input?.flags.all).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not inject flags.all when context.allSites is false", async () => {
    const root = await mkdtemp(join(tmpdir(), "rfc1231-"));
    try {
      const captured: { input?: KernelCommandInput } = {};
      const cmd = captureCommand(captured, {
        flags: { all: { kind: "boolean", description: "all" } },
      });
      const report = await executeRegisteredCommand(cmd, makeContext(root, false), []);
      expect(report.ok).toBe(true);
      expect(captured.input?.flags.all).not.toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
