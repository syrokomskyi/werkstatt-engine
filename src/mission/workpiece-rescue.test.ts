/*
<MODULE_CONTRACT>
  <purpose>Test RFC-0954: rescueWorkpieceEdits preserves uncommitted and unpushed
  workpiece edits before re-materialization overwrites the workpiece directory.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0954: test rescue of dirty workpiece, new commits, no-op cases, merge failure backup, and bordbuch evidence fallback.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

// Mock bordbuch-commit-helper to avoid real bordbuch I/O in tests
vi.mock("../bordbuch/bordbuch-commit-helper.ts", () => ({
  appendAndCommitBordbuch: vi.fn().mockResolvedValue({
    entry: { id: "event-000001", kind: "operator-note" } as any,
    commitResult: { commitSha: "abc123", pushed: true, error: null },
  }),
}));

import { rescueWorkpieceEdits } from "./workpiece-rescue.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";

const mockAppendBordbuch = vi.mocked(appendAndCommitBordbuch);

const silentLogger = {
  info: () => {},
  warn: () => {},
};

function gitInit(dir: string, branch = "main"): void {
  execSync(`git init -b ${branch}`, { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.local"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string): string {
  execSync(`git commit --allow-empty -m ${JSON.stringify(msg)}`, {
    cwd: dir,
    stdio: "pipe",
    encoding: "utf-8",
  });
  return execSync("git rev-parse HEAD", { cwd: dir, encoding: "utf-8", stdio: "pipe" }).trim();
}

let testRoot: string;
let cacheCloneDir: string;
let workpieceDir: string;

beforeEach(() => {
  testRoot = mkdtempSync(path.join(os.tmpdir(), "workpiece-rescue-test-"));
  cacheCloneDir = path.join(testRoot, "cache-clone");
  workpieceDir = path.join(testRoot, "workpiece");
  mkdirSync(cacheCloneDir, { recursive: true });
  mkdirSync(workpieceDir, { recursive: true });
  mockAppendBordbuch.mockClear();
  mockAppendBordbuch.mockResolvedValue({
    entry: { id: "event-000001", kind: "operator-note" } as any,
    commitResult: { commitSha: "abc123", pushed: true, error: null },
  });
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

test("no-op when workpiece does not exist", async () => {
  const result = await rescueWorkpieceEdits(
    "/nonexistent/workpiece",
    cacheCloneDir,
    "test-m000001",
    silentLogger,
  );
  expect(result.rescued).toBe(false);
  expect(result.reason).toContain("workpiece not found");
});

test("no-op when workpiece is not a git repo", async () => {
  const result = await rescueWorkpieceEdits(
    workpieceDir,
    cacheCloneDir,
    "test-m000001",
    silentLogger,
  );
  expect(result.rescued).toBe(false);
  expect(result.reason).toContain("not a git repo");
});

test("no-op when workpiece is closed (.closed sentinel)", async () => {
  gitInit(workpieceDir);
  gitCommit(workpieceDir, "initial");
  writeFileSync(path.join(workpieceDir, ".closed"), "");
  gitInit(cacheCloneDir);
  gitCommit(cacheCloneDir, "initial");

  const result = await rescueWorkpieceEdits(
    workpieceDir,
    cacheCloneDir,
    "test-m000001",
    silentLogger,
  );
  expect(result.rescued).toBe(false);
  expect(result.reason).toContain("closed");
});

test("no-op when cache clone is not a git repo", async () => {
  gitInit(workpieceDir);
  gitCommit(workpieceDir, "initial");

  const result = await rescueWorkpieceEdits(
    workpieceDir,
    cacheCloneDir,
    "test-m000001",
    silentLogger,
  );
  expect(result.rescued).toBe(false);
  expect(result.reason).toContain("cache clone is not a git repo");
});

test("rescues uncommitted changes — commits and merges into cache clone", async () => {
  gitInit(cacheCloneDir);
  const initialSha = gitCommit(cacheCloneDir, "initial");

  execSync(`git clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`, {
    stdio: "pipe",
  });

  writeFileSync(path.join(workpieceDir, "content.md"), "new content");

  const result = await rescueWorkpieceEdits(
    workpieceDir,
    cacheCloneDir,
    "test-m000001",
    silentLogger,
  );

  expect(result.rescued).toBe(true);
  expect(result.committedChanges).toBe(true);
  expect(result.mergedToCacheClone).toBe(true);
  expect(result.commitSha).not.toBe(null);
  expect(result.commitSha).not.toBe(initialSha);

  const cacheContent = execSync("git show HEAD:content.md", {
    cwd: cacheCloneDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  expect(cacheContent).toBe("new content");
});

test("rescues new commits in workpiece — merges into cache clone", async () => {
  gitInit(cacheCloneDir);
  const initialSha = gitCommit(cacheCloneDir, "initial");

  execSync(`git clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`, {
    stdio: "pipe",
  });

  writeFileSync(path.join(workpieceDir, "page.md"), "page content");
  execSync("git add -A", { cwd: workpieceDir, stdio: "pipe" });
  execSync('git commit -m "add page"', { cwd: workpieceDir, stdio: "pipe" });

  const result = await rescueWorkpieceEdits(
    workpieceDir,
    cacheCloneDir,
    "test-m000001",
    silentLogger,
  );

  expect(result.rescued).toBe(true);
  expect(result.committedChanges).toBe(false);
  expect(result.mergedToCacheClone).toBe(true);
  expect(result.commitSha).not.toBe(initialSha);

  const cacheContent = execSync("git show HEAD:page.md", {
    cwd: cacheCloneDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  expect(cacheContent).toBe("page content");
});

test("no-op when workpiece HEAD is already ancestor of cache clone HEAD", async () => {
  gitInit(cacheCloneDir);
  gitCommit(cacheCloneDir, "initial");

  execSync(`git clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`, {
    stdio: "pipe",
  });

  const result = await rescueWorkpieceEdits(
    workpieceDir,
    cacheCloneDir,
    "test-m000001",
    silentLogger,
  );

  expect(result.rescued).toBe(false);
  expect(result.committedChanges).toBe(false);
  expect(result.reason).toContain("no new commits");
});

test("backs up old workpiece on merge failure", async () => {
  gitInit(cacheCloneDir);
  gitCommit(cacheCloneDir, "initial");
  writeFileSync(path.join(cacheCloneDir, "conflict.md"), "cache version");
  execSync("git add -A", { cwd: cacheCloneDir, stdio: "pipe" });
  execSync('git commit -m "cache adds conflict.md"', { cwd: cacheCloneDir, stdio: "pipe" });

  execSync(`git clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`, {
    stdio: "pipe",
  });
  execSync("git reset --hard HEAD~1", { cwd: workpieceDir, stdio: "pipe" });

  writeFileSync(path.join(workpieceDir, "conflict.md"), "workpiece version");
  execSync("git add -A", { cwd: workpieceDir, stdio: "pipe" });
  execSync('git commit -m "workpiece adds conflict.md"', { cwd: workpieceDir, stdio: "pipe" });

  const logs: string[] = [];
  const result = await rescueWorkpieceEdits(workpieceDir, cacheCloneDir, "test-m000001", {
    info: (msg: string) => logs.push(msg),
    warn: (msg: string) => logs.push(msg),
  });

  expect(result.rescued).toBe(false);
  expect(result.mergedToCacheClone).toBe(false);
  expect(result.backupDir).not.toBe(null);
  expect(existsSync(result.backupDir!)).toBe(true);
  expect(logs.some((l) => l.includes("backed up"))).toBe(true);
});

test("pushes rescued commits to bare repo when origin is configured", async () => {
  const bareRepoDir = path.join(testRoot, "bare.git");
  execSync(`git init --bare ${JSON.stringify(bareRepoDir)}`, { stdio: "pipe" });

  gitInit(cacheCloneDir);
  execSync(`git remote add origin ${JSON.stringify(bareRepoDir)}`, {
    cwd: cacheCloneDir,
    stdio: "pipe",
  });
  gitCommit(cacheCloneDir, "initial");
  execSync("git push -u origin main", { cwd: cacheCloneDir, stdio: "pipe" });

  execSync(`git clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`, {
    stdio: "pipe",
  });

  writeFileSync(path.join(workpieceDir, "content.md"), "rescued content");

  const logs: string[] = [];
  const result = await rescueWorkpieceEdits(workpieceDir, cacheCloneDir, "test-m000001", {
    info: (msg: string) => logs.push(msg),
    warn: (msg: string) => logs.push(msg),
  });

  expect(result.rescued).toBe(true);
  expect(result.mergedToCacheClone).toBe(true);
  expect(result.pushedToBareRepo).toBe(true);
  expect(logs.some((l) => l.includes("Pushed rescued commits"))).toBe(true);

  const bareContent = execSync("git show refs/heads/main:content.md", {
    cwd: bareRepoDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  expect(bareContent).toBe("rescued content");
});

test("records bordbuch evidence when push to bare repo fails", async () => {
  // Cache clone with a broken origin (push will fail)
  gitInit(cacheCloneDir);
  gitCommit(cacheCloneDir, "initial");
  execSync("git remote add origin /nonexistent/bare.git", {
    cwd: cacheCloneDir,
    stdio: "pipe",
  });

  execSync(`git clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`, {
    stdio: "pipe",
  });

  writeFileSync(path.join(workpieceDir, "content.md"), "rescued content");

  const logs: string[] = [];
  const result = await rescueWorkpieceEdits(
    workpieceDir,
    cacheCloneDir,
    "test-m000001",
    {
      info: (msg: string) => logs.push(msg),
      warn: (msg: string) => logs.push(msg),
    },
    testRoot,
    "test-system",
  );

  expect(result.rescued).toBe(true);
  expect(result.mergedToCacheClone).toBe(true);
  expect(result.pushedToBareRepo).toBe(false);
  expect(result.bordbuchEvidence).toBe(true);
  expect(logs.some((l) => l.includes("Failed to push"))).toBe(true);
  expect(logs.some((l) => l.includes("bordbuch as evidence"))).toBe(true);

  expect(mockAppendBordbuch).toHaveBeenCalledTimes(1);
  const callArgs = mockAppendBordbuch.mock.calls[0];
  expect(callArgs[2]).toBe("operator-note");
  expect(callArgs[4]).toBe("mission:rescue");
});
