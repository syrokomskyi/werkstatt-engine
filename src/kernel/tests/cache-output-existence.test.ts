import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tryCacheRead } from "../runtime/execute-pipeline.ts";
import {
  COMMAND_RESULT_CACHE_SCHEMA_VERSION,
  setCachedCommandResult,
  type CommandResultCacheKey,
} from "../cache/command-result-cache.ts";
import type { CacheLayer, CacheEntry } from "../cache/cache-layer.ts";
import type { KernelCommandDefinition, KernelExecutionReport } from "@warpgogol/werkstatt-shared/kernel";

/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1057: Unit tests for cache output-existence guard in tryCacheRead.
    Verifies that cached results are invalidated when declared output files
    are missing from disk, forcing re-execution of the generating command.
  </purpose>
</MODULE_CONTRACT>
*/

function makeCommand(overrides: Partial<KernelCommandDefinition> = {}): KernelCommandDefinition {
  return {
    name: "test.generator",
    modulePath: "test",
    description: "Test generator",
    scope: "workspace",
    execute: () => undefined,
    reads: ["src/input.txt"],
    writes: ["dist/output.txt"],
    ...overrides,
  };
}

function makeReport(): KernelExecutionReport {
  return {
    commandName: "test.generator",
    exitCode: 0,
    ok: true,
    summary: "generated output",
    timing: { durationMs: 10, exceededTimeout: false },
    filesModified: [],
    metadata: makeCommand(),
    logs: [],
  };
}

function makeKey(overrides: Partial<CommandResultCacheKey> = {}): CommandResultCacheKey {
  return {
    schemaVersion: COMMAND_RESULT_CACHE_SCHEMA_VERSION,
    commandName: "test.generator",
    siteName: null,
    inputsHash: "aaa",
    moduleHash: "bbb",
    ...overrides,
  };
}

class MockCacheLayer implements CacheLayer {
  readonly available = true;
  private entry: CacheEntry | null = null;

  async get(_namespace: string, _key: string): Promise<CacheEntry | null> {
    return this.entry;
  }

  async set(
    _namespace: string,
    _key: string,
    data: unknown,
    mtime: number,
    contentHash: string,
  ): Promise<void> {
    this.entry = { key: _key, data, mtime, contentHash, updatedAt: Date.now() };
  }

  async clear(): Promise<void> {
    this.entry = null;
  }

  async status() {
    return {
      available: true,
      dbPath: ":memory:",
      dbSizeBytes: 0,
      namespaces: [],
    };
  }

  async close(): Promise<void> {}
}

describe("RFC-1057: tryCacheRead output-existence guard", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rfc1057-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("(a) cache hit when output file exists", async () => {
    const cache = new MockCacheLayer();
    const cmd = makeCommand();
    const inputPath = join(tmpDir, "src", "input.txt");
    const outputPath = join(tmpDir, "dist", "output.txt");
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await mkdir(join(tmpDir, "dist"), { recursive: true });
    await writeFile(inputPath, "test");
    await writeFile(outputPath, "generated");

    // Populate cache using the real setCachedCommandResult
    await setCachedCommandResult(cache, makeKey(), makeReport());

    const result = await tryCacheRead(
      cache,
      cmd,
      tmpDir,
      tmpDir,
      null,
      join(tmpDir, "src"),
      new Map(),
      false,
      false,
      undefined,
    );

    expect(result).not.toBeNull();
    expect(result?.ok).toBe(true);
  });

  test("(b) cache miss when output file is missing", async () => {
    const cache = new MockCacheLayer();
    const cmd = makeCommand();
    const inputPath = join(tmpDir, "src", "input.txt");
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(inputPath, "test");
    // Note: dist/output.txt is NOT created

    await setCachedCommandResult(cache, makeKey(), makeReport());

    const result = await tryCacheRead(
      cache,
      cmd,
      tmpDir,
      tmpDir,
      null,
      join(tmpDir, "src"),
      new Map(),
      false,
      false,
      undefined,
    );

    expect(result).toBeNull();
  });

  test("(c) cache miss when one of multiple output files is missing", async () => {
    const cache = new MockCacheLayer();
    const cmd = makeCommand({
      writes: ["dist/output1.txt", "dist/output2.txt"],
    });
    const inputPath = join(tmpDir, "src", "input.txt");
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await mkdir(join(tmpDir, "dist"), { recursive: true });
    await writeFile(inputPath, "test");
    await writeFile(join(tmpDir, "dist", "output1.txt"), "generated");
    // output2.txt is missing

    await setCachedCommandResult(cache, makeKey(), makeReport());

    const result = await tryCacheRead(
      cache,
      cmd,
      tmpDir,
      tmpDir,
      null,
      join(tmpDir, "src"),
      new Map(),
      false,
      false,
      undefined,
    );

    expect(result).toBeNull();
  });

  test("(d) no writes field — cache hit regardless of file existence", async () => {
    const cache = new MockCacheLayer();
    const cmd = makeCommand({ writes: undefined });
    const inputPath = join(tmpDir, "src", "input.txt");
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(inputPath, "test");

    await setCachedCommandResult(cache, makeKey(), makeReport());

    const result = await tryCacheRead(
      cache,
      cmd,
      tmpDir,
      tmpDir,
      null,
      join(tmpDir, "src"),
      new Map(),
      false,
      false,
      undefined,
    );

    expect(result).not.toBeNull();
  });

  test("(e) empty writes array — cache hit", async () => {
    const cache = new MockCacheLayer();
    const cmd = makeCommand({ writes: [] });
    const inputPath = join(tmpDir, "src", "input.txt");
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(inputPath, "test");

    await setCachedCommandResult(cache, makeKey(), makeReport());

    const result = await tryCacheRead(
      cache,
      cmd,
      tmpDir,
      tmpDir,
      null,
      join(tmpDir, "src"),
      new Map(),
      false,
      false,
      undefined,
    );

    expect(result).not.toBeNull();
  });
});
