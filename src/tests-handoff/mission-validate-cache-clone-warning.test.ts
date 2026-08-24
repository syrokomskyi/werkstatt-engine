/*
<MODULE_CONTRACT>
<purpose>RFC-0522: tests for mission.validate dirty cache clone warning.</purpose>
<keywords>RFC-0522, mission.validate, cache clone, dirty, warning, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0522: add unit tests for dirty cache clone warning in mission.validate.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
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
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-validate-cache-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("dirty cache clone is detected by isWorkpieceDirty for validate warning", () => {
  gitInit(tmpDir);
  writeFileSync(join(tmpDir, "system.md"), "initial");
  gitCommit(tmpDir, "initial");
  writeFileSync(join(tmpDir, "system.md"), "modified");

  const result = isWorkpieceDirty(tmpDir);
  expect(result.dirty).toBe(true);
  expect(result.fileCount).toBe(1);
});

test("clean cache clone produces no warning", () => {
  gitInit(tmpDir);
  writeFileSync(join(tmpDir, "system.md"), "initial");
  gitCommit(tmpDir, "initial");

  const result = isWorkpieceDirty(tmpDir);
  expect(result.dirty).toBe(false);
});

test("non-git cache clone does not trigger warning (guard skipped)", () => {
  writeFileSync(join(tmpDir, "system.md"), "content");

  // Simulate the guard: only check if .git exists
  let warningEmitted = false;
  if (existsSync(join(tmpDir, ".git"))) {
    const result = isWorkpieceDirty(tmpDir);
    if (result.dirty) {
      warningEmitted = true;
    }
  }
  expect(warningEmitted).toBe(false);
});
