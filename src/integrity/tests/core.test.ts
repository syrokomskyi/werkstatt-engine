/*
<MODULE_CONTRACT>
  <purpose>RFC-1051: test integrity core modules — paths, fs, json, types, discover, policy helpers.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1051: initial integrity core tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import * as paths from "../paths.ts";
import * as fsMod from "../fs.ts";
import * as jsonMod from "../json.ts";
import * as types from "../types.ts";
import { groupFilesByDirectory } from "../discover.ts";
import { stableStringify } from "../json.ts";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "integrity-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// --- paths.ts ---

test("integrityRoot returns integrity path under repo", () => {
  expect(paths.integrityRoot("/repo")).toContain("integrity");
  expect(paths.integrityRoot("/repo")).toContain("/repo");
});

test("configDir returns integrity config path", () => {
  expect(paths.configDir("/repo")).toContain("integrity");
});

test("schemaDir returns integrity schema path", () => {
  expect(paths.schemaDir("/repo")).toContain("schema");
});

test("policyPath returns policy file path", () => {
  expect(paths.policyPath("/repo")).toContain("policy");
});

test("indexDir returns index path", () => {
  expect(paths.indexDir("/repo")).toContain("index");
});

// --- fs.ts ---

test("ensureDir creates directory recursively", async () => {
  const dir = path.join(tmpDir, "a", "b", "c");
  await fsMod.ensureDir(dir);
  await expect(fsMod.pathExists(dir)).resolves.toBe(true);
});

test("pathExists returns false for non-existent path", async () => {
  await expect(fsMod.pathExists(path.join(tmpDir, "nope"))).resolves.toBe(false);
});

test("pathExists returns true for existing path", async () => {
  await expect(fsMod.pathExists(tmpDir)).resolves.toBe(true);
});

test("writeText and readText round-trip", async () => {
  const filePath = path.join(tmpDir, "test.txt");
  await fsMod.writeText(filePath, "hello world");
  const content = await fsMod.readText(filePath);
  expect(content).toBe("hello world");
});

test("readBuffer returns Buffer", async () => {
  const filePath = path.join(tmpDir, "test.bin");
  await fsMod.writeText(filePath, "data");
  const buf = await fsMod.readBuffer(filePath);
  expect(buf).toBeInstanceOf(Buffer);
});

// --- json.ts ---

test("stableStringify produces sorted keys", () => {
  const result = stableStringify({ b: 2, a: 1 });
  expect(result).toContain('"a"');
  expect(result).toContain('"b"');
  expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"b"'));
});

test("writeJsonFile and readJsonFile round-trip", async () => {
  const filePath = path.join(tmpDir, "test.json");
  await jsonMod.writeJsonFile(filePath, { name: "test", count: 42 });
  const result = await jsonMod.readJsonFile<{ name: string; count: number }>(filePath);
  expect(result.name).toBe("test");
  expect(result.count).toBe(42);
});

// --- types.ts (load verification) ---

test("integrity types module loads without error", () => {
  expect(types).toBeDefined();
  const status: types.IntegrityStatus = "active";
  expect(status).toBe("active");
});

// --- discover.ts ---

test("groupFilesByDirectory groups files by parent directory", async () => {
  const files = ["/repo/a.ts", "/repo/b.ts", "/repo/sub/c.ts"];
  const grouped = await groupFilesByDirectory(files);
  expect(grouped.get("/repo")).toEqual(["/repo/a.ts", "/repo/b.ts"]);
  expect(grouped.get("/repo/sub")).toEqual(["/repo/sub/c.ts"]);
});

test("groupFilesByDirectory handles empty input", async () => {
  const grouped = await groupFilesByDirectory([]);
  expect(grouped.size).toBe(0);
});
