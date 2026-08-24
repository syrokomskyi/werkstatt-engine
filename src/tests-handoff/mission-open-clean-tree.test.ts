/*
<MODULE_CONTRACT>
<purpose>RFC-0580: integration test verifying git status is clean after mission.open.</purpose>
<keywords>RFC-0580, integration, mission.open, git status, clean</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0580: initial integration test for clean working tree after mission.open.</item>
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

function setupBareOrigin(workspaceDir: string): string {
  const bareDirName = `${basename(workspaceDir)}.git`;
  const bareDir = join(workspaceDir, bareDirName);
  writeFileSync(join(workspaceDir, ".gitignore"), `${bareDirName}/\n`);
  execSync("git add .gitignore", { cwd: workspaceDir, stdio: "pipe" });
  execSync('git commit -m "add .gitignore"', { cwd: workspaceDir, stdio: "pipe" });
  execSync(`git init --bare ${JSON.stringify(bareDir)}`, { stdio: "pipe" });
  execSync(`git remote add origin ${JSON.stringify(bareDir)}`, {
    cwd: workspaceDir,
    stdio: "pipe",
  });
  execSync("git push -u origin HEAD", { cwd: workspaceDir, stdio: "pipe" });
  return bareDir;
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

function gitStatusPorcelain(dir: string): string {
  return execSync("git status --porcelain", { cwd: dir, encoding: "utf-8", stdio: "pipe" }).trim();
}

let testRoot: string;
let tmpWorkspace: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-mission-open-integration-"));
  tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

test("after mission.open, git status in monorepo is clean", async () => {
  // Set up workspace structure — git repo in testRoot so systems-cache is tracked
  gitInit(testRoot);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommit(testRoot, "initial");

  // Create per-system config and state files in systems-cache
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
  const stateContent = `schemaVersion: system-state/v1
systemId: test-system
currentMission: null
lastRelease: null
`;
  writeFileSync(join(cacheDir, "system-state.yaml"), stateContent);

  // Create pin file in cache clone dir
  writeFileSync(
    join(cacheDir, "system.pin.json"),
    JSON.stringify({ platform: { version: "1.0.0" } }, null, 2) + "\n",
  );

  // Create bordbuch directory
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });

  // Commit the system directory
  gitCommit(testRoot, "add system");

  // ADR-0030: commitAndPushBordbuch now verifies push succeeded — set up bare origin
  setupBareOrigin(testRoot);

  // Run mission.open
  const input = {
    flags: {
      system: "test-system",
      brief: "Test mission",
      actor: "test-agent",
    },
  } as unknown as KernelCommandInput;
  const context = { workspaceRoot: tmpWorkspace } as unknown as KernelRuntimeContext;

  await runMissionOpen(input, context);

  // Verify git status is clean (no uncommitted changes)
  const status = gitStatusPorcelain(testRoot);
  expect(status).toBe("");
});
