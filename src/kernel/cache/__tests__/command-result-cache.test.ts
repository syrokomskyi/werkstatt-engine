/*
<MODULE_CONTRACT>
<purpose>
Unit tests for command result cache covering buildCommandResultCacheKey; parseCommandResultCacheKey; computeInputsHash.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the command suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to kernel internals beyond the public surface under test

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
  parseCommandResultCacheKey,
  setCachedCommandResult,
  type CommandResultCacheKey,
} from "../command-result-cache.ts";
import { NoopCacheLayer } from "../noop-cache-layer.ts";
import type {
  KernelCommandDefinition,
  KernelExecutionReport,
} from "@warpgogol/werkstatt-shared/kernel";
import { byteHash, stableJsonHash } from "@warpgogol/werkstatt-shared/fingerprint";
import { buildWorkspaceTreeIndex } from "../workspace-tree-index.ts";
import { getOrComputeModuleHash, resolveModuleSrcDir } from "../../runtime/result-cache.ts";

function makeReport(overrides: Partial<KernelExecutionReport> = {}): KernelExecutionReport {
  return {
    commandName: "test.command",
    exitCode: 0,
    ok: true,
    metadata: {
      name: "test.command",
      modulePath: "test",
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
    flagsHash: "",
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

describe("parseCommandResultCacheKey", () => {
  test("round-trips plain hashes", () => {
    const key = buildCommandResultCacheKey(
      makeKey({ siteName: "app", inputsHash: "abc", moduleHash: "def" }),
    );
    expect(parseCommandResultCacheKey(COMMAND_RESULT_CACHE_NAMESPACE, key)).toEqual({
      commandName: "test.command",
      siteName: "app",
      inputsHash: "abc",
      moduleHash: "def",
      flagsHash: "",
    });
  });

  test("round-trips algo-prefixed hashes (sha256:hex)", () => {
    // Real keys embed "sha256:<hex>" hashes — a naive split(":") truncates
    // them (inputsHash → "sha256", moduleHash → inputs hex). RFC-1127.
    const key = buildCommandResultCacheKey(
      makeKey({
        siteName: "app",
        inputsHash: "sha256:aaa111",
        moduleHash: "sha256:bbb222",
      }),
    );
    expect(parseCommandResultCacheKey(COMMAND_RESULT_CACHE_NAMESPACE, key)).toEqual({
      commandName: "test.command",
      siteName: "app",
      inputsHash: "sha256:aaa111",
      moduleHash: "sha256:bbb222",
      flagsHash: "",
    });
  });

  test("handles empty siteName with prefixed hashes", () => {
    const key = buildCommandResultCacheKey(
      makeKey({ siteName: null, inputsHash: "sha256:aaa", moduleHash: "sha256:bbb" }),
    );
    const parsed = parseCommandResultCacheKey(COMMAND_RESULT_CACHE_NAMESPACE, key);
    expect(parsed?.siteName).toBeNull();
    expect(parsed?.moduleHash).toBe("sha256:bbb");
  });

  test("returns null for other namespaces and malformed keys", () => {
    expect(parseCommandResultCacheKey("other_ns", "1:cmd:site:a:b")).toBeNull();
    expect(parseCommandResultCacheKey(COMMAND_RESULT_CACHE_NAMESPACE, "1:cmd")).toBeNull();
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

describe("RFC-1193: bounded module hashing", () => {
  const makeCmd = (modulePath?: string, modulePaths?: string[]): KernelCommandDefinition =>
    ({
      name: "test.cacheable",
      modulePath,
      modulePaths,
      reads: ["docs/**/*.md"],
      execute: () => undefined,
    }) as unknown as KernelCommandDefinition;

  test("resolveModuleSrcDir returns unpatched when modulePath is absent", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "mod-src-"));
    const resolved = await resolveModuleSrcDir(makeCmd(), ws);
    expect(resolved).toEqual({ fallbackReason: "unpatched" });
  });

  test("resolveModuleSrcDir returns unrooted when modulePath has no /src/ or /os/", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "mod-src-"));
    const resolved = await resolveModuleSrcDir(makeCmd("packages/x/kernel/mod.ts"), ws);
    expect(resolved).toEqual({ fallbackReason: "unrooted" });
  });

  test("resolveModuleSrcDir returns missing when derived dir does not exist", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "mod-src-"));
    const resolved = await resolveModuleSrcDir(makeCmd("packages/x/src/m.ts"), ws);
    expect(resolved).toEqual({ fallbackReason: "missing" });
  });

  test("resolveModuleSrcDir resolves /os/ roots to a real directory", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "mod-src-"));
    await fs.mkdir(path.join(ws, "packages/forge/os"), { recursive: true });
    const resolved = await resolveModuleSrcDir(makeCmd("packages/forge/os/rfc/rfc.module.ts"), ws);
    expect(resolved.srcDir).toBe(path.join(ws, "packages/forge/os"));
  });

  test("resolveModuleSrcDir resolves /src/ roots to a real directory", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "mod-src-"));
    await fs.mkdir(path.join(ws, "packages/x/src"), { recursive: true });
    const resolved = await resolveModuleSrcDir(makeCmd("packages/x/src/m.ts"), ws);
    expect(resolved.srcDir).toBe(path.join(ws, "packages/x/src"));
  });

  test("getOrComputeModuleHash returns deterministic constant for fallbacks, not workspaceRoot", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "mod-src-"));
    const cmd = makeCmd();
    const cache = new Map<string, string>();
    const resolved = await resolveModuleSrcDir(cmd, ws);
    const h = await getOrComputeModuleHash(resolved, cmd, cache, ws);
    expect(h).toBe(byteHash("module-hash-fallback:unpatched"));
    // Repeat calls hit the per-run cache and stay identical.
    const h2 = await getOrComputeModuleHash(resolved, cmd, cache, ws);
    expect(h2).toBe(h);
  });

  test("getOrComputeModuleHash fingerprints srcDir when resolvable", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "mod-src-"));
    const srcDir = path.join(ws, "packages/x/src");
    await fs.mkdir(srcDir, { recursive: true });
    const cmd = makeCmd("packages/x/src/m.ts");
    const cache = new Map<string, string>();
    const h = await getOrComputeModuleHash({ srcDir }, cmd, cache, ws);
    expect(h).toBeTruthy();
    expect(h).not.toBe(byteHash("module-hash-fallback:missing"));
  });
});

describe("RFC-1194: modulePaths anchored to dirname(modulePath)", () => {
  const makeCmd = (modulePath: string, modulePaths: string[]): KernelCommandDefinition =>
    ({
      name: "test.cacheable",
      modulePath,
      modulePaths,
      reads: ["docs/**/*.md"],
      execute: () => undefined,
    }) as unknown as KernelCommandDefinition;

  test("AC-1: entry existing only under dirname(modulePath) changes the hash", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "mod-anchor-"));
    const modDir = path.join(ws, "packages/x/src/checks");
    await fs.mkdir(modDir, { recursive: true });
    await fs.writeFile(path.join(modDir, "check.ts"), "export const a = 1;");
    const cmd = makeCmd("packages/x/src/checks/mod.ts", ["check.ts"]);
    const cache = new Map<string, string>();
    const resolved = await resolveModuleSrcDir(cmd, ws);
    const h1 = await getOrComputeModuleHash(resolved, cmd, cache, ws);
    await fs.writeFile(path.join(modDir, "check.ts"), "export const a = 2;");
    const cache2 = new Map<string, string>();
    const h2 = await getOrComputeModuleHash(resolved, cmd, cache2, ws);
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(byteHash("module-hash-fallback:missing"));
  });

  test("AC-6: entry existing only under src/ root does not contribute", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "mod-anchor-"));
    const modDir = path.join(ws, "packages/x/src/checks");
    await fs.mkdir(modDir, { recursive: true });
    // "lonely.ts" exists under src/ but NOT under src/checks/.
    await fs.writeFile(path.join(ws, "packages/x/src/lonely.ts"), "export const l = 1;");
    const cmd = makeCmd("packages/x/src/checks/mod.ts", ["lonely.ts"]);
    const cache = new Map<string, string>();
    const resolved = await resolveModuleSrcDir(cmd, ws);
    const h = await getOrComputeModuleHash(resolved, cmd, cache, ws);
    // The entry resolves to nothing under dirname(modulePath) — silently
    // skipped at runtime (CRC-05 gates it statically), so the hash equals the
    // empty-allowlist constant.
    expect(h).toBe(stableJsonHash({ paths: [] }));
  });

  test(".. entry resolving within workspaceRoot contributes to the hash", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "mod-anchor-"));
    const modDir = path.join(ws, "packages/x/src/testing/contract");
    await fs.mkdir(modDir, { recursive: true });
    const helperDir = path.join(ws, "packages/x/src/checks");
    await fs.mkdir(helperDir, { recursive: true });
    await fs.writeFile(path.join(helperDir, "result-helpers.ts"), "export const h = 1;");
    const cmd = makeCmd("packages/x/src/testing/contract/mod.ts", [
      "../../checks/result-helpers.ts",
    ]);
    const cache = new Map<string, string>();
    const resolved = await resolveModuleSrcDir(cmd, ws);
    const h1 = await getOrComputeModuleHash(resolved, cmd, cache, ws);
    await fs.writeFile(path.join(helperDir, "result-helpers.ts"), "export const h = 2;");
    const h2 = await getOrComputeModuleHash(resolved, cmd, new Map<string, string>(), ws);
    expect(h1).not.toBe(h2);
  });

  test(".. entry escaping workspaceRoot is never fingerprinted", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "mod-anchor-"));
    const modDir = path.join(ws, "packages/x/src/checks");
    await fs.mkdir(modDir, { recursive: true });
    const cmd = makeCmd("packages/x/src/checks/mod.ts", ["../../../outside.ts"]);
    const cache = new Map<string, string>();
    const resolved = await resolveModuleSrcDir(cmd, ws);
    const h = await getOrComputeModuleHash(resolved, cmd, cache, ws);
    expect(h).toBe(stableJsonHash({ paths: [] }));
  });

  test("unrooted modulePath with modulePaths still anchors to its dirname", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "mod-anchor-"));
    const modDir = path.join(ws, "packages/x/kernel");
    await fs.mkdir(modDir, { recursive: true });
    await fs.writeFile(path.join(modDir, "helper.ts"), "export const k = 1;");
    const cmd = makeCmd("packages/x/kernel/mod.ts", ["helper.ts"]);
    const cache = new Map<string, string>();
    const resolved = await resolveModuleSrcDir(cmd, ws);
    expect(resolved).toEqual({ fallbackReason: "unrooted" });
    const h = await getOrComputeModuleHash(resolved, cmd, cache, ws);
    expect(h).not.toBe(byteHash("module-hash-fallback:unrooted"));
  });

  test("modulePaths with missing dirname falls back to constant missing hash", async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), "mod-anchor-"));
    const cmd = makeCmd("packages/x/src/checks/mod.ts", ["a.ts"]);
    const cache = new Map<string, string>();
    const resolved = await resolveModuleSrcDir(cmd, ws);
    const h = await getOrComputeModuleHash(resolved, cmd, cache, ws);
    expect(h).toBe(byteHash("module-hash-fallback:missing"));
  });
});

describe("COMMAND_RESULT_CACHE_SCHEMA_VERSION", () => {
  test("is 2 (RFC-1133: flagsHash appended to the key)", () => {
    expect(COMMAND_RESULT_CACHE_SCHEMA_VERSION).toBe(2);
  });
});
