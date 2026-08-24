/*
<MODULE_CONTRACT>
<purpose>RFC-0480: tests for isWorkpieceDirty() helper and reconcile dirty guard.</purpose>
<keywords>RFC-0480, RFC-0522, isWorkpieceDirty, reconcile, guard, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0480: add unit tests for isWorkpieceDirty() and reconcile dirty guard.</item>
  <item>RFC-0522: update tests to assert files[] field in WorkpieceDirtyResult.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { isWorkpieceDirty } from "../mission/mission-git-commit.ts";
import { tmpdir } from "node:os";

function gitInit(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-dirty-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("isWorkpieceDirty returns false for a clean workpiece", () => {
  gitInit(tmpDir);
  writeFileSync(join(tmpDir, "file.txt"), "hello");
  gitCommit(tmpDir, "initial");
  const result = isWorkpieceDirty(tmpDir);
  expect(result.dirty).toBe(false);
  expect(result.fileCount).toBe(0);
  expect(result.files).toEqual([]);
});

test("isWorkpieceDirty returns true when there are uncommitted changes", () => {
  gitInit(tmpDir);
  writeFileSync(join(tmpDir, "file.txt"), "hello");
  gitCommit(tmpDir, "initial");
  writeFileSync(join(tmpDir, "file.txt"), "modified");
  const result = isWorkpieceDirty(tmpDir);
  expect(result.dirty).toBe(true);
  expect(result.fileCount).toBe(1);
  expect(result.files).toEqual(["file.txt"]);
});

test("isWorkpieceDirty returns true for untracked files", () => {
  gitInit(tmpDir);
  writeFileSync(join(tmpDir, "file.txt"), "hello");
  gitCommit(tmpDir, "initial");
  writeFileSync(join(tmpDir, "new-file.txt"), "new");
  const result = isWorkpieceDirty(tmpDir);
  expect(result.dirty).toBe(true);
  expect(result.fileCount).toBe(1);
  expect(result.files).toEqual(["new-file.txt"]);
});

test("isWorkpieceDirty returns false for a non-git directory", () => {
  const result = isWorkpieceDirty(tmpDir);
  expect(result.dirty).toBe(false);
  expect(result.fileCount).toBe(0);
  expect(result.files).toEqual([]);
});

test("isWorkpieceDirty counts multiple dirty files", () => {
  gitInit(tmpDir);
  writeFileSync(join(tmpDir, "a.txt"), "a");
  writeFileSync(join(tmpDir, "b.txt"), "b");
  gitCommit(tmpDir, "initial");
  writeFileSync(join(tmpDir, "a.txt"), "modified");
  writeFileSync(join(tmpDir, "c.txt"), "new");
  const result = isWorkpieceDirty(tmpDir);
  expect(result.dirty).toBe(true);
  expect(result.fileCount).toBe(2);
  expect(result.files).toContain("a.txt");
  expect(result.files).toContain("c.txt");
});

test("isWorkpieceDirty ignores gitignored-but-tracked files", () => {
  gitInit(tmpDir);
  writeFileSync(join(tmpDir, "file.txt"), "hello");
  writeFileSync(join(tmpDir, "generated.json"), '{"v":1}');
  writeFileSync(join(tmpDir, ".gitignore"), "generated.json\n");
  gitCommit(tmpDir, "initial");
  // Modify the gitignored-but-tracked file
  writeFileSync(join(tmpDir, "generated.json"), '{"v":2}');
  const result = isWorkpieceDirty(tmpDir);
  expect(result.dirty).toBe(false);
  expect(result.fileCount).toBe(0);
  expect(result.files).toEqual([]);
});

test("isWorkpieceDirty reports dirty when both gitignored and non-gitignored files change", () => {
  gitInit(tmpDir);
  writeFileSync(join(tmpDir, "file.txt"), "hello");
  writeFileSync(join(tmpDir, "generated.json"), '{"v":1}');
  writeFileSync(join(tmpDir, ".gitignore"), "generated.json\n");
  gitCommit(tmpDir, "initial");
  writeFileSync(join(tmpDir, "generated.json"), '{"v":2}');
  writeFileSync(join(tmpDir, "file.txt"), "modified");
  const result = isWorkpieceDirty(tmpDir);
  expect(result.dirty).toBe(true);
  expect(result.fileCount).toBe(1);
  expect(result.files).toEqual(["file.txt"]);
});
