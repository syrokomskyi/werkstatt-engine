import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeRegisteredCommand } from "../runtime/execute-command.ts";
import { createCacheLayer, type CacheLayer } from "../cache/cache-layer.ts";
import { createKernelLogger } from "../logger.ts";
import { createDefaultIO, EMPTY_WORKPIECE_ENV } from "@warpgogol/werkstatt-shared/kernel";
import type {
  ActualState,
  KernelCommandDefinition,
  KernelResultCacheContext,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";

/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1133: end-to-end tests for the executor-level command-result cache.
    executeRegisteredCommand is the single choke point — driving it directly
    exercises the same block that executeKernelCommand and both pipeline
    executors flow through. Covers: second-run cache hit (AC-1), flag-variant
    key separation (AC-2), --force read-bypass + write-refresh (AC-3),
    --site/--id alias equivalence (AC-6), schema-less commands (AC-7), and
    cacheBypassFlags on the direct path (AC-9).
  </purpose>
</MODULE_CONTRACT>
*/

function makeCommand(
  executions: { count: number },
  overrides: Partial<KernelCommandDefinition> = {},
): KernelCommandDefinition {
  return {
    name: "test.cacheable",
    modulePath: "packages/test/src/mod.ts",
    description: "cacheable test command",
    scope: "workspace",
    reads: ["src/input.txt"],
    execute: () => {
      executions.count++;
      return { exitCode: 0, summary: "ran" };
    },
    ...overrides,
  };
}

function makeContext(
  root: string,
  resultCache?: KernelResultCacheContext,
  force = false,
  dryRun = false,
): KernelRuntimeContext {
  const { io, intents } = createDefaultIO();
  return {
    workspaceRoot: root,
    site: undefined,
    siteExplicit: false,
    logger: createKernelLogger("json"),
    dryRun,
    force,
    outputFormat: "json",
    io,
    fileIntents: intents,
    actualState: {
      components: new Map(),
      commands: new Map(),
      pipelines: new Map(),
    } as unknown as ActualState,
    workpieceEnv: EMPTY_WORKPIECE_ENV,
    resultCache,
  };
}

describe("RFC-1133: direct-path command-result cache", () => {
  let tmpDir: string;
  let layer: CacheLayer;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rfc1133-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src", "input.txt"), "test");
    layer = await createCacheLayer(tmpDir);
  });

  afterEach(async () => {
    await layer.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  function cacheCtx(): KernelResultCacheContext {
    return { layer, moduleHashCache: new Map() };
  }

  test("AC-1: second identical execution is served from cache", async () => {
    const executions = { count: 0 };
    const cmd = makeCommand(executions);
    const ctx = makeContext(tmpDir, cacheCtx());

    const first = await executeRegisteredCommand(cmd, ctx, []);
    const second = await executeRegisteredCommand(cmd, ctx, []);

    expect(first.ok).toBe(true);
    expect(executions.count).toBe(1);
    expect(second.cached).toBe(true);
    expect(second.ok).toBe(true);
  });

  test("AC-2: a different flag value produces a distinct cache entry", async () => {
    const executions = { count: 0 };
    const cmd = makeCommand(executions, {
      flags: { id: { kind: "string", description: "target id" } },
    });
    const ctx = makeContext(tmpDir, cacheCtx());

    await executeRegisteredCommand(cmd, ctx, ["--id", "a"]);
    const second = await executeRegisteredCommand(cmd, ctx, ["--id", "b"]);

    expect(executions.count).toBe(2);
    expect(second.cached).toBeFalsy();
  });

  test("AC-3: --force bypasses the read and refreshes the entry", async () => {
    const executions = { count: 0 };
    const cmd = makeCommand(executions);
    const cache = cacheCtx();

    await executeRegisteredCommand(cmd, makeContext(tmpDir, cache), []);
    const forced = await executeRegisteredCommand(cmd, makeContext(tmpDir, cache, true), []);
    const after = await executeRegisteredCommand(cmd, makeContext(tmpDir, cache), []);

    expect(executions.count).toBe(2);
    expect(forced.cached).toBeFalsy();
    expect(after.cached).toBe(true);
  });

  test("AC-6: --site alias and canonical --id share one entry", async () => {
    const executions = { count: 0 };
    const cmd = makeCommand(executions, {
      flags: { id: { kind: "string", description: "target id" } },
    });
    const ctx = makeContext(tmpDir, cacheCtx());

    await executeRegisteredCommand(cmd, ctx, ["--site", "foo"]);
    const second = await executeRegisteredCommand(cmd, ctx, ["--id", "foo"]);

    expect(executions.count).toBe(1);
    expect(second.cached).toBe(true);
  });

  test("AC-7: schema-less command caches; a non-invisible flag splits the key", async () => {
    const executions = { count: 0 };
    const cmd = makeCommand(executions); // no flags schema
    const ctx = makeContext(tmpDir, cacheCtx());

    await executeRegisteredCommand(cmd, ctx, []);
    const second = await executeRegisteredCommand(cmd, ctx, []);
    const third = await executeRegisteredCommand(cmd, ctx, ["--foo", "bar"]);

    expect(executions.count).toBe(2);
    expect(second.cached).toBe(true);
    expect(third.cached).toBeFalsy();
  });

  test("AC-9: cacheBypassFlags skips read and write on the direct path", async () => {
    const executions = { count: 0 };
    const cmd = makeCommand(executions, {
      flags: { rfc: { kind: "string", description: "rfc filter" } },
      cacheBypassFlags: ["rfc"],
    });
    const ctx = makeContext(tmpDir, cacheCtx());

    await executeRegisteredCommand(cmd, ctx, ["--rfc", "RFC-0001"]);
    const second = await executeRegisteredCommand(cmd, ctx, ["--rfc", "RFC-0001"]);

    expect(executions.count).toBe(2);
    expect(second.cached).toBeFalsy();
  });

  test("invisible universal flags do not fragment the cache key", async () => {
    const executions = { count: 0 };
    const cmd = makeCommand(executions);
    const ctx = makeContext(tmpDir, cacheCtx());

    await executeRegisteredCommand(cmd, ctx, ["--json"]);
    const second = await executeRegisteredCommand(cmd, ctx, ["--verbose"]);

    expect(executions.count).toBe(1);
    expect(second.cached).toBe(true);
  });

  test("--dry-run neither reads nor writes the cache", async () => {
    const executions = { count: 0 };
    const cmd = makeCommand(executions);
    const cache = cacheCtx();

    await executeRegisteredCommand(cmd, makeContext(tmpDir, cache), []);
    const dry = await executeRegisteredCommand(cmd, makeContext(tmpDir, cache, false, true), []);
    const after = await executeRegisteredCommand(cmd, makeContext(tmpDir, cache), []);

    expect(executions.count).toBe(2);
    expect(dry.cached).toBeFalsy();
    expect(after.cached).toBe(true);
  });
});
