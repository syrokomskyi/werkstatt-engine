/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: test fingerprint core modules — primitives, canonical-json, path-matcher, fingerprint, types, semantic.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial fingerprint core tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { byteHash, stableStringify, stableJsonHash, isSha256Digest } from "@warpgogol/werkstatt-shared/fingerprint";
import { normalizePathSep, shouldIgnore } from "../path-matcher.ts";
import {
  snapshotCanonicalJsonObjectV1,
  isCanonicalJsonObjectV1,
  CANONICAL_JSON_V1,
} from "@warpgogol/werkstatt-shared/fingerprint";
import { fingerprintFile } from "../fingerprint.ts";
import type { FingerprintOptions, FingerprintFileResult, FingerprintResult } from "../types.ts";
import * as semantic from "../semantic.ts";

// --- primitives.ts ---

test("byteHash produces sha256 digest for string input", () => {
  const hash = byteHash("test");
  expect(isSha256Digest(hash)).toBe(true);
  expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
});

test("byteHash produces sha256 digest for Uint8Array input", () => {
  const hash = byteHash(new Uint8Array([1, 2, 3]));
  expect(isSha256Digest(hash)).toBe(true);
});

test("byteHash is deterministic", () => {
  expect(byteHash("test")).toBe(byteHash("test"));
});

test("byteHash differs for different inputs", () => {
  expect(byteHash("a")).not.toBe(byteHash("b"));
});

test("isSha256Digest validates correct format", () => {
  expect(isSha256Digest("sha256:" + "a".repeat(64))).toBe(true);
  expect(isSha256Digest("not-a-hash")).toBe(false);
  expect(isSha256Digest("sha256:short")).toBe(false);
});

test("stableStringify produces sorted keys", () => {
  const result = stableStringify({ b: 2, a: 1 });
  expect(result).toBe('{"a":1,"b":2}');
});

test("stableJsonHash is deterministic for equivalent objects", () => {
  expect(stableJsonHash({ b: 2, a: 1 })).toBe(stableJsonHash({ a: 1, b: 2 }));
});

// --- path-matcher.ts ---

test("normalizePathSep converts backslashes to forward slashes", () => {
  expect(normalizePathSep("a\\b\\c")).toBe("a/b/c");
  expect(normalizePathSep("a/b/c")).toBe("a/b/c");
});

test("shouldIgnore returns true when pattern is substring of path", () => {
  expect(shouldIgnore("src/node_modules/x", ["node_modules"])).toBe(true);
  expect(shouldIgnore("src/foo.ts", ["node_modules"])).toBe(false);
});

// --- canonical-json.ts ---

test("CANONICAL_JSON_V1 constant is defined", () => {
  expect(CANONICAL_JSON_V1).toBe("werkstatt/canonical-json@1");
});

test("snapshotCanonicalJsonObjectV1 succeeds for plain object", () => {
  const result = snapshotCanonicalJsonObjectV1({ a: 1, b: "test" });
  expect(result.ok).toBe(true);
});

test("snapshotCanonicalJsonObjectV1 fails for non-object input", () => {
  const result = snapshotCanonicalJsonObjectV1("not an object");
  expect(result.ok).toBe(false);
});

test("isCanonicalJsonObjectV1 guards correctly", () => {
  expect(isCanonicalJsonObjectV1(null)).toBe(false);
  expect(isCanonicalJsonObjectV1("string")).toBe(false);
});

// --- types.ts (load verification) ---

test("fingerprint types module loads without error", () => {
  const opts: FingerprintOptions = { mode: "byte" };
  expect(opts.mode).toBe("byte");
  const fileResult: FingerprintFileResult = {
    path: "test",
    mode: "byte",
    normalizer: "text",
    hash: "sha256:abc",
  };
  expect(fileResult.path).toBe("test");
  const treeResult: FingerprintResult = {
    algorithm: "sha256",
    mode: "byte",
    value: "sha256:abc",
    files: [fileResult],
  };
  expect(treeResult.algorithm).toBe("sha256");
});

// --- fingerprint.ts ---

test("fingerprintFile produces hash for text content", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "fp-test-"));
  try {
    const filePath = path.join(tmpDir, "test.txt");
    await fs.writeFile(filePath, "hello world\n");
    const result = await fingerprintFile(filePath, { mode: "byte" });
    expect(result.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.mode).toBe("byte");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- semantic.ts (load verification) ---

test("semantic module loads without error", () => {
  expect(semantic).toBeDefined();
});
