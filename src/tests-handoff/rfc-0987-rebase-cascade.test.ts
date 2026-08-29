/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0987: unit tests for rebase-conflict cascade fixes in cache clone git operations.
    Tests Fix 1 (rebase abort in commitAndPushBordbuch), Fix 2 (pushed flag in bordbuch.repair),
    Fix 3 (mission.open pre-preflight auto-recover), Fix 4 (symbolic-ref branch resolution).
  </purpose>
  <keywords>RFC-0987, rebase, cascade, bordbuch, mission.open, syncCacheClone, force-with-lease</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0987: initial tests for all 5 fixes.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { commitAndPushBordbuch } from "../bordbuch/bordbuch-io.ts";

const mockCachePath = vi.hoisted(() => ({ value: "" as string }));

vi.mock("../sternsystem/registry-io.ts", () => ({
  resolveCacheClonePath: vi.fn(() => mockCachePath.value),
  resolveActiveWorkpieceDir: vi.fn(async () => null),
  readSystemConfig: vi.fn(async () => ({ status: "active" })),
  readSystemState: vi.fn(async () => ({ currentMission: null })),
  writeSystemState: vi.fn(async () => {}),
  discoverSystems: vi.fn(async () => ({ systems: [] })),
}));

vi.mock("../mission/mission-materialize.ts", () => ({
  runMissionMaterializeInternal: vi.fn(async () => ({
    data: { materializedAt: "2026-01-01T00:00:00.000Z" },
    summary: "materialized",
    nextSteps: [],
  })),
  runMissionMaterialize: vi.fn(),
}));

function gitInit(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

let testRoot: string;
let cacheDir: string;
let bareDir: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-rfc-0987-"));
  cacheDir = join(testRoot, "cache");
  bareDir = join(testRoot, "bare.git");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });
  mockCachePath.value = cacheDir;
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setupGitRepo(): void {
  gitInit(cacheDir);
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), "");
  gitCommit(cacheDir, "initial");
  execSync(`git init --bare ${JSON.stringify(bareDir)}`, { stdio: "pipe" });
  execSync(`git remote add origin ${JSON.stringify(bareDir)}`, {
    cwd: cacheDir,
    stdio: "pipe",
  });
  execSync("git push -u origin HEAD", { cwd: cacheDir, stdio: "pipe" });
}

// ---------------------------------------------------------------------------
// Fix 1: commitAndPushBordbuch aborts rebase on conflict
// ---------------------------------------------------------------------------

test("Fix 1: commitAndPushBordbuch aborts rebase on error and cleans up rebase-merge", async () => {
  setupGitRepo();

  // Simulate a stale rebase-merge state (as if a previous pull --rebase conflicted)
  mkdirSync(join(cacheDir, ".git", "rebase-merge"), { recursive: true });
  writeFileSync(join(cacheDir, ".git", "rebase-merge", "head-name"), "refs/heads/main\n");

  // Remove the remote so push fails, triggering the catch block which should abort rebase
  execSync("git remote remove origin", { cwd: cacheDir, stdio: "pipe" });

  // Write a new change for commitAndPushBordbuch to commit
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), '{"local":"change2"}\n');

  const result = await commitAndPushBordbuch(cacheDir, "test commit");

  // Push should fail (no origin), and the catch block should abort the rebase
  expect(result.pushed).toBe(false);
  expect(result.commitSha).not.toBeNull();

  // After the failed push, rebase-merge should NOT exist (Fix 1 aborts it)
  expect(existsSync(join(cacheDir, ".git", "rebase-merge"))).toBe(false);
  expect(existsSync(join(cacheDir, ".git", "rebase-apply"))).toBe(false);
});

// ---------------------------------------------------------------------------
// Fix 2: commitAndPushBordbuch returns pushed=false when push fails
// ---------------------------------------------------------------------------

test("Fix 2: commitAndPushBordbuch returns pushed=false when push fails (no origin)", async () => {
  setupGitRepo();

  // Remove the remote so push fails
  execSync("git remote remove origin", { cwd: cacheDir, stdio: "pipe" });

  // Write a new change for commitAndPushBordbuch to commit
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), '{"new":"event"}\n');

  const result = await commitAndPushBordbuch(cacheDir, "test commit");

  expect(result.commitSha).not.toBeNull();
  expect(result.pushed).toBe(false);
  expect(result.error).not.toBeNull();
});

// ---------------------------------------------------------------------------
// Fix 3: mission.open auto-recovers stale rebase-merge
// ---------------------------------------------------------------------------

test("Fix 3: mission.open auto-recovers stale rebase-merge before bordbuch validation", async () => {
  setupGitRepo();

  // Simulate a stale rebase-merge by creating the directory
  mkdirSync(join(cacheDir, ".git", "rebase-merge"), { recursive: true });
  writeFileSync(join(cacheDir, ".git", "rebase-merge", "head-name"), "refs/heads/main\n");

  const { runMissionOpen } = await import("../mission/mission-open.ts");

  const input = {
    flags: { system: "test-system", brief: "Test mission", actor: "test-agent" },
  } as unknown as import("@warpgogol/werkstatt-engine/kernel").KernelCommandInput;

  const logs: string[] = [];
  const context = {
    workspaceRoot: testRoot,
    logger: {
      info: (msg: string) => logs.push(msg),
      warn: (msg: string) => logs.push(msg),
      success: (msg: string) => logs.push(msg),
      error: (msg: string) => logs.push(msg),
    },
  } as unknown as import("@warpgogol/werkstatt-engine/kernel").KernelRuntimeContext;

  // mission.open may fail later for unrelated reasons (no system config, etc.)
  // The key assertion is that rebase-merge was auto-removed
  try {
    await runMissionOpen(input, context);
  } catch {
    // Expected — mission.open needs a full system setup
  }

  expect(existsSync(join(cacheDir, ".git", "rebase-merge"))).toBe(false);
  expect(logs.some((l) => l.includes("stale rebase-merge") && l.includes("auto-aborting"))).toBe(
    true,
  );
});

// ---------------------------------------------------------------------------
// Fix 4: commitAndPushBordbuch resolves branch via symbolic-ref in detached HEAD
// ---------------------------------------------------------------------------

test("Fix 4: commitAndPushBordbuch resolves branch via symbolic-ref in detached HEAD", async () => {
  setupGitRepo();

  // Put cache clone in detached HEAD
  const headSha = execSync("git rev-parse HEAD", {
    cwd: cacheDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  execSync(`git checkout ${headSha}`, { cwd: cacheDir, stdio: "pipe" });

  // Verify we're in detached HEAD
  expect(() => execSync("git symbolic-ref HEAD", { cwd: cacheDir, stdio: "pipe" })).toThrow();

  // Write a new change for commitAndPushBordbuch to commit
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), '{"detached":"commit"}\n');

  // commitAndPushBordbuch should resolve branch to "main" via symbolic-ref
  // and successfully push (with --force-with-lease)
  const result = await commitAndPushBordbuch(cacheDir, "detached HEAD commit");

  expect(result.commitSha).not.toBeNull();
  expect(result.pushed).toBe(true);
  expect(result.error).toBeNull();
});

// ---------------------------------------------------------------------------
// Fix 5: commitAndPushBordbuch pushes successfully with --force-with-lease
// ---------------------------------------------------------------------------

test("Fix 5: commitAndPushBordbuch pushes successfully with --force-with-lease", async () => {
  setupGitRepo();

  // Write a new change for commitAndPushBordbuch to commit
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), '{"force":"lease"}\n');

  const result = await commitAndPushBordbuch(cacheDir, "force-with-lease test");

  expect(result.pushed).toBe(true);
  expect(result.error).toBeNull();

  // Verify the commit is in the bare repo
  const bareLog = execSync("git log --oneline -1 main", {
    cwd: bareDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  expect(bareLog).toContain("force-with-lease test");
});
