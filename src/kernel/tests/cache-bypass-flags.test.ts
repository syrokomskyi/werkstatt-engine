import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  hasCacheBypassFlag,
  readCommandResult,
  writeCommandResult,
  type CommandResultCacheCall,
} from "../runtime/result-cache.ts";
import {
  COMMAND_RESULT_CACHE_SCHEMA_VERSION,
  getCachedCommandResult,
  setCachedCommandResult,
  type CommandResultCacheKey,
} from "../cache/command-result-cache.ts";
import type { CacheLayer, CacheEntry } from "../cache/cache-layer.ts";
import type {
  KernelCommandDefinition,
  KernelExecutionReport,
  KernelResultCacheContext,
} from "@warpgogol/werkstatt-shared/kernel";

/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1130: Unit tests for cacheBypassFlags — flags that reduce coverage
    (e.g. --rfc) must skip both the cache read and the cache write so a
    filtered run can neither serve a stale full-run report nor poison the
    full-run cache entry (the cache key is flag-blind by design).
  </purpose>
</MODULE_CONTRACT>
*/

function makeCommand(overrides: Partial<KernelCommandDefinition> = {}): KernelCommandDefinition {
  return {
    name: "test.filtered",
    modulePath: "test",
    description: "Test command with a coverage-reducing flag",
    scope: "workspace",
    execute: () => undefined,
    reads: ["src/input.txt"],
    cacheBypassFlags: ["rfc"],
    ...overrides,
  };
}

function makeReport(): KernelExecutionReport {
  return {
    commandName: "test.filtered",
    exitCode: 0,
    ok: true,
    summary: "ran",
    timing: { durationMs: 10, exceededTimeout: false },
    filesModified: [],
    metadata: makeCommand(),
    logs: [],
  };
}

function makeKey(overrides: Partial<CommandResultCacheKey> = {}): CommandResultCacheKey {
  return {
    schemaVersion: COMMAND_RESULT_CACHE_SCHEMA_VERSION,
    commandName: "test.filtered",
    siteName: null,
    inputsHash: "aaa",
    moduleHash: "bbb",
    flagsHash: "",
    ...overrides,
  };
}

function makeCall(
  command: KernelCommandDefinition,
  tmpDir: string,
  argv: string[],
): CommandResultCacheCall {
  return {
    command,
    argv,
    flags: {},
    baseDir: tmpDir,
    workspaceRoot: tmpDir,
    siteName: null,
    force: false,
    dryRun: false,
  };
}

function makeCacheCtx(cache: CacheLayer): KernelResultCacheContext {
  return { layer: cache, moduleHashCache: new Map() };
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

describe("RFC-1130: hasCacheBypassFlag", () => {
  test("true when a listed flag is present as --name", () => {
    expect(hasCacheBypassFlag(makeCommand(), ["--rfc", "RFC-0001"])).toBe(true);
  });

  test("true when a listed flag is present as --name=value", () => {
    expect(hasCacheBypassFlag(makeCommand(), ["--rfc=RFC-0001"])).toBe(true);
  });

  test("false when no listed flag is present", () => {
    expect(hasCacheBypassFlag(makeCommand(), ["--site", "foo"])).toBe(false);
    expect(hasCacheBypassFlag(makeCommand(), [])).toBe(false);
  });

  test("false when the command declares no cacheBypassFlags", () => {
    expect(hasCacheBypassFlag(makeCommand({ cacheBypassFlags: undefined }), ["--rfc"])).toBe(false);
  });

  test("does not match a different flag sharing the prefix", () => {
    // --rfc-extra must not match the "rfc" bypass entry.
    expect(hasCacheBypassFlag(makeCommand(), ["--rfc-extra"])).toBe(false);
  });
});

describe("RFC-1130: executor cache bypass", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rfc1130-"));
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src", "input.txt"), "test");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("(a) bypass skips the cache read even when an entry exists", async () => {
    const cache = new MockCacheLayer();
    const cmd = makeCommand();
    await setCachedCommandResult(cache, makeKey(), makeReport());

    // RFC-1133: bypass is derived from argv inside the shared block — a listed
    // flag in argv skips the read regardless of a populated store.
    const result = await readCommandResult(
      makeCacheCtx(cache),
      makeCall(cmd, tmpDir, ["--rfc", "RFC-0001"]),
    );

    expect(
      result,
      "cacheBypassFlags must skip the cache read — a filtered run must not serve the full-run entry",
    ).toBeNull();
  });

  test("(b) bypass skips the cache write — filtered runs never poison the entry", async () => {
    const cache = new MockCacheLayer();
    const cmd = makeCommand();

    await writeCommandResult(
      makeCacheCtx(cache),
      makeCall(cmd, tmpDir, ["--rfc", "RFC-0001"]),
      makeReport(),
    );

    const stored = await getCachedCommandResult(cache, makeKey());
    expect(
      stored,
      "cacheBypassFlags must skip the cache write — a partial result must not overwrite the full-run entry",
    ).toBeNull();
  });

  test("(c) without bypass, the write stores normally", async () => {
    const cache = new MockCacheLayer();
    const cmd = makeCommand();

    await writeCommandResult(makeCacheCtx(cache), makeCall(cmd, tmpDir, []), makeReport());

    // The stored key carries the real inputsHash — assert via the mock's entry
    // rather than a guessed hash: any entry in the namespace proves the write.
    const status = await cache.status();
    expect(status.available).toBe(true);
    // Read back through the mock: setCachedCommandResult wrote one entry.
    const probe = await cache.get("command_results", "any");
    expect(probe, "non-bypass write must store the result").not.toBeNull();
  });
});
