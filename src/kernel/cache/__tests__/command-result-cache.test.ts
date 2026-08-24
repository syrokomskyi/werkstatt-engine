import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect, describe } from "vitest";
import {
  COMMAND_RESULT_CACHE_NAMESPACE,
  COMMAND_RESULT_CACHE_SCHEMA_VERSION,
  buildCommandResultCacheKey,
  computeInputsHash,
  computeModuleHash,
  getCachedCommandResult,
  setCachedCommandResult,
  type CommandResultCacheKey,
} from "../command-result-cache.ts";
import { NoopCacheLayer } from "../noop-cache-layer.ts";
import type { KernelExecutionReport } from "../../types.ts";
import { buildWorkspaceTreeIndex } from "../workspace-tree-index.ts";

function makeReport(overrides: Partial<KernelExecutionReport> = {}): KernelExecutionReport {
  return {
    commandName: "test.command",
    exitCode: 0,
    ok: true,
    metadata: {
      name: "test.command",
      description: "test",
      scope: "workspace",
      execute: () => undefined,
    },
    logs: [],
    timing: { durationMs: 10, exceededTimeout: false },
    ...overrides,
  };
}

function makeKey(overrides: Partial<CommandResultCacheKey> = {}): CommandResultCacheKey {
  return {
    schemaVersion: COMMAND_RESULT_CACHE_SCHEMA_VERSION,
    commandName: "test.command",
    siteName: null,
    inputsHash: "abc",
    moduleHash: "def",
    ...overrides,
  };
}

describe("buildCommandResultCacheKey", () => {
  test("includes schema version, command name, site name, hashes", () => {
    const key1 = buildCommandResultCacheKey(makeKey({ inputsHash: "aaa" }));
    const key2 = buildCommandResultCacheKey(makeKey({ inputsHash: "bbb" }));
    expect(key1).not.toBe(key2);
  });

  test("schema version bump changes key", () => {
    const key1 = buildCommandResultCacheKey(makeKey());
    const key2 = buildCommandResultCacheKey(
      makeKey({ schemaVersion: COMMAND_RESULT_CACHE_SCHEMA_VERSION + 1 }),
    );
    expect(key1).not.toBe(key2);
  });

  test("site name affects key", () => {
    const key1 = buildCommandResultCacheKey(makeKey({ siteName: null }));
    const key2 = buildCommandResultCacheKey(makeKey({ siteName: "warpgogol-com" }));
    expect(key1).not.toBe(key2);
  });
});

describe("computeInputsHash", () => {
  test("empty reads returns stable hash", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
    const h1 = await computeInputsHash([], ws, ws);
    const h2 = await computeInputsHash([], ws, ws);
    expect(h1.hash).toBe(h2.hash);
  });

  test("hash changes when file content changes", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
    const filePath = path.join(ws, "input.md");
    await fs.writeFile(filePath, "content v1");
    const h1 = await computeInputsHash(["input.md"], ws, ws);
    await fs.writeFile(filePath, "content v2");
    const h2 = await computeInputsHash(["input.md"], ws, ws);
    expect(h1.hash).not.toBe(h2.hash);
  });

  test("hash is stable for unchanged content", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
    const filePath = path.join(ws, "input.md");
    await fs.writeFile(filePath, "stable content");
    const h1 = await computeInputsHash(["input.md"], ws, ws);
    const h2 = await computeInputsHash(["input.md"], ws, ws);
    expect(h1.hash).toBe(h2.hash);
  });

  test("glob patterns match multiple files", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
    await fs.writeFile(path.join(ws, "a.md"), "a");
    await fs.writeFile(path.join(ws, "b.md"), "b");
    const h1 = await computeInputsHash(["*.md"], ws, ws);
    expect(h1.hash).toBeTruthy();
    await fs.writeFile(path.join(ws, "c.md"), "c");
    const h2 = await computeInputsHash(["*.md"], ws, ws);
    expect(h1.hash).not.toBe(h2.hash);
  });
});

describe("computeModuleHash", () => {
  test("directory hash changes when a file changes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mod-hash-"));
    await fs.writeFile(path.join(dir, "a.ts"), "export const x = 1;");
    const h1 = await computeModuleHash(dir);
    await fs.writeFile(path.join(dir, "a.ts"), "export const x = 2;");
    const h2 = await computeModuleHash(dir);
    expect(h1).not.toBe(h2);
  });

  test("returns fallback for nonexistent directory", async () => {
    const h = await computeModuleHash(path.join(os.tmpdir(), "nonexistent-dir-xyz"));
    expect(h).toBeTruthy();
  });

  test("RFC-0637: with modulePaths hashes only listed paths", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mod-hash-"));
    await fs.writeFile(path.join(dir, "a.ts"), "export const x = 1;");
    await fs.writeFile(path.join(dir, "b.ts"), "export const y = 1;");
    const h1 = await computeModuleHash(dir, ["a.ts"]);
    await fs.writeFile(path.join(dir, "b.ts"), "export const y = 2;");
    const h2 = await computeModuleHash(dir, ["a.ts"]);
    expect(h1).toBe(h2);
  });

  test("RFC-0637: without modulePaths hashes full src/ (existing behavior)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mod-hash-"));
    await fs.writeFile(path.join(dir, "a.ts"), "export const x = 1;");
    await fs.writeFile(path.join(dir, "b.ts"), "export const y = 1;");
    const h1 = await computeModuleHash(dir);
    await fs.writeFile(path.join(dir, "b.ts"), "export const y = 2;");
    const h2 = await computeModuleHash(dir);
    expect(h1).not.toBe(h2);
  });

  test("RFC-0637: different modulePaths values produce different hashes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mod-hash-"));
    await fs.writeFile(path.join(dir, "a.ts"), "export const x = 1;");
    await fs.writeFile(path.join(dir, "b.ts"), "export const y = 1;");
    const h1 = await computeModuleHash(dir, ["a.ts"]);
    const h2 = await computeModuleHash(dir, ["b.ts"]);
    expect(h1).not.toBe(h2);
  });

  test("RFC-0637: non-existent path in modulePaths is silently skipped", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mod-hash-"));
    await fs.writeFile(path.join(dir, "a.ts"), "export const x = 1;");
    const h = await computeModuleHash(dir, ["nonexistent.ts"]);
    expect(h).toBeTruthy();
  });
});

describe("getCachedCommandResult / setCachedCommandResult", () => {
  test("miss returns null on noop cache", async () => {
    const cache = new NoopCacheLayer("/tmp/test.db", "test");
    const result = await getCachedCommandResult(cache, makeKey());
    expect(result).toBeNull();
  });

  test("noop cache does not store", async () => {
    const cache = new NoopCacheLayer("/tmp/test.db", "test");
    await setCachedCommandResult(cache, makeKey(), makeReport());
    const result = await getCachedCommandResult(cache, makeKey());
    expect(result).toBeNull();
  });
});

describe("RFC-0685: computeInputsHash with tree index", () => {
  test("tree index produces same hash as filesystem walk", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
    await fs.writeFile(path.join(ws, "a.md"), "content a");
    await fs.writeFile(path.join(ws, "b.md"), "content b");
    const treeIndex = await buildWorkspaceTreeIndex(ws);
    const withoutTree = await computeInputsHash(["*.md"], ws, ws);
    const withTree = await computeInputsHash(["*.md"], ws, ws, treeIndex);
    expect(withTree.hash).toBe(withoutTree.hash);
  });

  test("tree index produces same metadata as filesystem walk", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
    await fs.writeFile(path.join(ws, "a.md"), "content a");
    const treeIndex = await buildWorkspaceTreeIndex(ws);
    const withoutTree = await computeInputsHash(["a.md"], ws, ws);
    const withTree = await computeInputsHash(["a.md"], ws, ws, treeIndex);
    expect(withTree.metadata).toHaveLength(1);
    expect(withTree.metadata[0]!.path).toBe(withoutTree.metadata[0]!.path);
    expect(withTree.metadata[0]!.size).toBe(withoutTree.metadata[0]!.size);
  });

  test("metadata entries have path, mtimeMs, and size", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
    await fs.writeFile(path.join(ws, "input.md"), "test content");
    const result = await computeInputsHash(["input.md"], ws, ws);
    expect(result.metadata).toHaveLength(1);
    const entry = result.metadata[0]!;
    expect(entry.path).toBe("input.md");
    expect(typeof entry.mtimeMs).toBe("number");
    expect(entry.size).toBe(12);
  });

  test("metadata is sorted by path", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
    await fs.writeFile(path.join(ws, "c.md"), "c");
    await fs.writeFile(path.join(ws, "a.md"), "a");
    await fs.writeFile(path.join(ws, "b.md"), "b");
    const result = await computeInputsHash(["*.md"], ws, ws);
    expect(result.metadata.map((m) => m.path)).toEqual(["a.md", "b.md", "c.md"]);
  });
});

describe("RFC-0685: byte-mode fingerprint selection", () => {
  test("md files use byte mode (hash changes with content only)", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
    await fs.writeFile(path.join(ws, "doc.md"), "hello");
    const h1 = await computeInputsHash(["doc.md"], ws, ws);
    await fs.writeFile(path.join(ws, "doc.md"), "world");
    const h2 = await computeInputsHash(["doc.md"], ws, ws);
    expect(h1.hash).not.toBe(h2.hash);
  });

  test("ts files use semantic mode (whitespace-insensitive)", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
    await fs.writeFile(path.join(ws, "mod.ts"), "export const x = 1;");
    const h1 = await computeInputsHash(["mod.ts"], ws, ws);
    await fs.writeFile(path.join(ws, "mod.ts"), "export   const   x   =   1;");
    const h2 = await computeInputsHash(["mod.ts"], ws, ws);
    expect(h1.hash).toBe(h2.hash);
  });
});

describe("RFC-0685: getCachedCommandResult wrapper format", () => {
  test("returns null on noop cache", async () => {
    const cache = new NoopCacheLayer("/tmp/test.db", "test");
    const result = await getCachedCommandResult(cache, makeKey());
    expect(result).toBeNull();
  });

  test("noop cache does not store wrapper", async () => {
    const cache = new NoopCacheLayer("/tmp/test.db", "test");
    const metadata = [{ path: "input.md", mtimeMs: Date.now(), size: 100 }];
    await setCachedCommandResult(cache, makeKey(), makeReport(), metadata);
    const result = await getCachedCommandResult(cache, makeKey());
    expect(result).toBeNull();
  });
});

describe("COMMAND_RESULT_CACHE_NAMESPACE", () => {
  test("is command_results", () => {
    expect(COMMAND_RESULT_CACHE_NAMESPACE).toBe("command_results");
  });
});

describe("COMMAND_RESULT_CACHE_SCHEMA_VERSION", () => {
  test("is 1", () => {
    expect(COMMAND_RESULT_CACHE_SCHEMA_VERSION).toBe(1);
  });
});
