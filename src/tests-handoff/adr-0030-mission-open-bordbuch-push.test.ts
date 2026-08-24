/*
<MODULE_CONTRACT>
<purpose>ADR-0030: unit test verifying mission.open throws when commitAndPushBordbuch fails to commit or push.</purpose>
<keywords>ADR-0030, bordbuch, push, commit, mission.open, guard</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0030: initial tests for commit failure and push failure guards in mission.open.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";
import { runMissionOpen } from "../mission/mission-open.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
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

let testRoot: string;
let tmpWorkspace: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-adr-0030-"));
  tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setupWorkspace(): string {
  gitInit(testRoot);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommit(testRoot, "initial");

  const cacheDir = join(testRoot, "systems-cache", "test-system");
  mkdirSync(cacheDir, { recursive: true });
  const configContent = `schemaVersion: system-config/v1
id: test-system
cosmicStar: Vega
mirrors:
  - path: "../systems-cache/test-system"
    storageType: non-bare
pinnedPlatform: "4.5.0"
status: active
registeredAt: "2026-01-01T00:00:00Z"
notes: ""
`;
  writeFileSync(join(cacheDir, "system-config.yaml"), configContent);
  gitCommit(testRoot, "add system config");

  writeFileSync(
    join(cacheDir, "system.pin.json"),
    JSON.stringify({ platform: { version: "1.0.0" } }, null, 2) + "\n",
  );

  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });
  gitCommit(testRoot, "add system");

  return testRoot;
}

test("mission.open throws when bordbuch push fails (no git origin configured)", async () => {
  setupWorkspace();

  // No bare origin is set up — commitAndPushBordbuch will commit successfully
  // but the push will fail because there is no 'origin' remote.
  // This tests the push-failure path (pushed === false), which is the more
  // common real-world scenario described in ADR-0030.

  const input = {
    flags: { system: "test-system", brief: "Test mission", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = { workspaceRoot: tmpWorkspace } as unknown as KernelRuntimeContext;

  await expect(runMissionOpen(input, context)).rejects.toThrow(
    /bordbuch push failed for system 'test-system'/,
  );
});

test("mission.open throws with distinct commit-failure message when git add fails", async () => {
  setupWorkspace();

  // Remove the .git directory so all git operations fail.
  // This makes commitAndPushBordbuch's gitExec("add ...") fail, returning
  // { commitSha: null, pushed: false } — triggering the commit-failure guard.
  rmSync(join(testRoot, ".git"), { recursive: true, force: true });

  const input = {
    flags: { system: "test-system", brief: "Test mission", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = { workspaceRoot: tmpWorkspace } as unknown as KernelRuntimeContext;

  await expect(runMissionOpen(input, context)).rejects.toThrow(
    /bordbuch commit failed for system 'test-system'/,
  );
});

test("mission.open succeeds when commitAndPushBordbuch pushes successfully", async () => {
  setupWorkspace();

  // Set up a bare origin so push succeeds
  const bareDirName = `${basename(testRoot)}.git`;
  const bareDir = join(testRoot, bareDirName);
  writeFileSync(join(testRoot, ".gitignore"), `${bareDirName}/\n`);
  execSync("git add .gitignore", { cwd: testRoot, stdio: "pipe" });
  execSync('git commit -m "add .gitignore"', { cwd: testRoot, stdio: "pipe" });
  execSync(`git init --bare ${JSON.stringify(bareDir)}`, { stdio: "pipe" });
  execSync(`git remote add origin ${JSON.stringify(bareDir)}`, {
    cwd: testRoot,
    stdio: "pipe",
  });
  execSync("git push -u origin HEAD", { cwd: testRoot, stdio: "pipe" });

  const input = {
    flags: { system: "test-system", brief: "Test mission", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = { workspaceRoot: tmpWorkspace } as unknown as KernelRuntimeContext;

  const result = await runMissionOpen(input, context);
  expect(result.data?.state).toBe("open");
  expect(result.data?.missionId).toBe("test-system-m000001");
  // Verify the bordbuch event was pushed — check that the bare repo has the commit
  const bareLog = execSync("git log --oneline -1 main", {
    cwd: bareDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  expect(bareLog).toContain("mission-open");
});
