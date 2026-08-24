/*
<MODULE_CONTRACT>
  <purpose>RFC-0878: Tests for closed-workpiece commit guard — .closed sentinel file
  blocks all commits (raw git, MISSION_GIT_COMMIT bypass, and commitWorkpieceIfDirty).</purpose>
  <keywords>RFC-0878, closed, workpiece, sentinel, commit, guard, hook</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0878: initial tests for .closed sentinel — hook blocks raw git commit, hook blocks MISSION_GIT_COMMIT bypass, commitWorkpieceIfDirty throws on closed workpiece.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { commitWorkpieceIfDirty } from "../mission/mission-git-commit.ts";
import { installWorkpieceCommitHook } from "../mission/workpiece-commit-hook.ts";

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function gitCommitExpectFail(cwd: string, env?: Record<string, string>): { stderr: string } {
  try {
    execSync("git commit -m 'should fail'", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    throw new Error("Expected git commit to fail but it succeeded");
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (!stderr.includes("blocked") && !stderr.includes("closed")) {
      throw new Error(`Expected 'blocked' or 'closed' in stderr, got: ${stderr}`);
    }
    return { stderr };
  }
}

let tmpDir: string;
let workpieceDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0878-test-"));
  workpieceDir = path.join(tmpDir, "workpiece");

  await fs.mkdir(workpieceDir, { recursive: true });
  git(workpieceDir, "init");
  git(workpieceDir, 'config user.email "test@example.com"');
  git(workpieceDir, 'config user.name "Test"');

  await fs.writeFile(path.join(workpieceDir, "system.md"), "# System\n");
  git(workpieceDir, "add -A");
  git(workpieceDir, 'commit -m "initial"');

  await installWorkpieceCommitHook(workpieceDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// --- Fix 1: Pre-commit hook blocks commits in closed workpieces ---

test("hook blocks raw git commit (no MISSION_GIT_COMMIT) in closed workpiece", async () => {
  await fs.writeFile(path.join(workpieceDir, ".closed"), "2026-08-18T00:00:00.000Z\n");
  await fs.writeFile(path.join(workpieceDir, "new-file.txt"), "content\n");
  git(workpieceDir, "add -A");

  gitCommitExpectFail(workpieceDir);
});

test("hook blocks MISSION_GIT_COMMIT=1 bypass in closed workpiece", async () => {
  await fs.writeFile(path.join(workpieceDir, ".closed"), "2026-08-18T00:00:00.000Z\n");
  await fs.writeFile(path.join(workpieceDir, "new-file.txt"), "content\n");
  git(workpieceDir, "add -A");

  gitCommitExpectFail(workpieceDir, { MISSION_GIT_COMMIT: "1" });
});

test("hook allows commits in open workpiece (no .closed sentinel)", async () => {
  await fs.writeFile(path.join(workpieceDir, "new-file.txt"), "content\n");
  git(workpieceDir, "add -A");

  execSync('git commit -m "allowed"', {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, MISSION_GIT_COMMIT: "1" },
  });

  const log = git(workpieceDir, "log --oneline -1");
  expect(log).toContain("allowed");
});

test("hook allows raw git commit blocked by RFC-0821 (no MISSION_GIT_COMMIT) in open workpiece", async () => {
  await fs.writeFile(path.join(workpieceDir, "new-file.txt"), "content\n");
  git(workpieceDir, "add -A");

  // Without MISSION_GIT_COMMIT, the hook blocks (RFC-0821, not .closed)
  try {
    execSync('git commit -m "should fail"', {
      cwd: workpieceDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    throw new Error("Expected git commit to fail but it succeeded");
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    expect(stderr).toContain("RFC-0821");
  }
});

// --- Fix 3: commitWorkpieceIfDirty throws on closed workpiece ---

test("commitWorkpieceIfDirty throws on closed workpiece (defence-in-depth)", async () => {
  await fs.writeFile(path.join(workpieceDir, ".closed"), "2026-08-18T00:00:00.000Z\n");
  await fs.writeFile(path.join(workpieceDir, "dirty-file.txt"), "content\n");

  expect(() => commitWorkpieceIfDirty(workpieceDir, "test-mission")).toThrow(/closed.*RFC-0878/);
});

test("commitWorkpieceIfDirty succeeds on open workpiece (no .closed sentinel)", async () => {
  await fs.writeFile(path.join(workpieceDir, "dirty-file.txt"), "content\n");

  const result = commitWorkpieceIfDirty(workpieceDir, "test-mission");

  expect(result.committed).toBe(true);
  expect(result.commitSha).not.toBeNull();
});

// --- Hook script content verification ---

test("hook script contains .closed sentinel check (RFC-0878)", async () => {
  const hookPath = path.join(workpieceDir, ".git", "hooks", "pre-commit");
  const content = await fs.readFile(hookPath, "utf8");

  expect(content).toContain("RFC-0878");
  expect(content).toContain(".closed");
  expect(content).toContain("workpiece is closed");
});
