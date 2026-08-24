/*
<MODULE_CONTRACT>
<purpose>RFC-0522: tests for dirty cache clone guard in mission.reconcile.</purpose>
<keywords>RFC-0522, reconcile, cache clone, dirty guard, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0522: add unit tests for dirty cache clone guard and non-git fallback.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { isWorkpieceDirty } from "../mission/mission-git-commit.ts";
import { tmpdir } from "node:os";

function gitInit(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-cache-guard-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("isWorkpieceDirty detects dirty cache clone directory", () => {
  gitInit(tmpDir);
  writeFileSync(join(tmpDir, "system.md"), "initial");
  gitCommit(tmpDir, "initial");

  writeFileSync(join(tmpDir, "system.md"), "modified");
  const result = isWorkpieceDirty(tmpDir);
  expect(result.dirty).toBe(true);
  expect(result.fileCount).toBe(1);
  expect(result.files).toHaveLength(1);
});

test("isWorkpieceDirty returns false for clean cache clone", () => {
  gitInit(tmpDir);
  writeFileSync(join(tmpDir, "system.md"), "initial");
  gitCommit(tmpDir, "initial");

  const result = isWorkpieceDirty(tmpDir);
  expect(result.dirty).toBe(false);
});

test("isWorkpieceDirty returns false for non-git cache clone (copyDir fallback)", () => {
  writeFileSync(join(tmpDir, "system.md"), "content");

  const result = isWorkpieceDirty(tmpDir);
  expect(result.dirty).toBe(false);
  expect(result.fileCount).toBe(0);
  expect(result.files).toEqual([]);
});

test("isWorkpieceDirty files[] can be used for error messages", () => {
  gitInit(tmpDir);
  writeFileSync(join(tmpDir, "file1.txt"), "a");
  writeFileSync(join(tmpDir, "file2.txt"), "b");
  gitCommit(tmpDir, "initial");

  writeFileSync(join(tmpDir, "file1.txt"), "modified");
  writeFileSync(join(tmpDir, "file3.txt"), "new");

  const result = isWorkpieceDirty(tmpDir);
  expect(result.dirty).toBe(true);
  expect(result.files).toHaveLength(2);
});
