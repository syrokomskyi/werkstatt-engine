/*
<MODULE_CONTRACT>
<purpose>RFC-0580: unit tests for commitWerkstattSideEffects helper.</purpose>
<keywords>RFC-0580, commitWerkstattSideEffects, test, idempotent, staging</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0580: initial unit tests for commitWerkstattSideEffects.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { commitWerkstattSideEffects } from "../werkstatt/werkstatt-commit.ts";
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

function gitStatusPorcelain(dir: string): string {
  return execSync("git status --porcelain", { cwd: dir, encoding: "utf-8", stdio: "pipe" }).trim();
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-werkstatt-commit-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("idempotent skip — no changes returns committed: false", async () => {
  gitInit(tmpDir);
  mkdirSync(join(tmpDir, "systems-cache", "test-system"), { recursive: true });
  writeFileSync(join(tmpDir, "systems-cache", "test-system", "system-config.yaml"), "initial\n");
  gitCommit(tmpDir, "initial");

  const result = await commitWerkstattSideEffects(
    tmpDir,
    ["systems-cache/test-system/system-config.yaml"],
    "werkstatt: test",
  );

  expect(result.committed).toBe(false);
  expect(result.commitSha).toBeNull();
});

test("specific-file staging — only named files are staged", async () => {
  gitInit(tmpDir);
  mkdirSync(join(tmpDir, "systems-cache", "test-system"), { recursive: true });
  mkdirSync(join(tmpDir, "missions"));
  writeFileSync(join(tmpDir, "systems-cache", "test-system", "system-config.yaml"), "initial\n");
  writeFileSync(join(tmpDir, "missions", "mission.yaml"), "initial\n");
  writeFileSync(join(tmpDir, "foreign.txt"), "foreign change\n");
  gitCommit(tmpDir, "initial");

  writeFileSync(join(tmpDir, "systems-cache", "test-system", "system-config.yaml"), "modified\n");
  writeFileSync(join(tmpDir, "foreign.txt"), "foreign modified\n");

  const result = await commitWerkstattSideEffects(
    tmpDir,
    ["systems-cache/test-system/system-config.yaml"],
    "werkstatt: test",
  );

  expect(result.committed).toBe(true);
  expect(result.commitSha).toBeTruthy();

  // foreign.txt should still be dirty (not staged)
  const status = gitStatusPorcelain(tmpDir);
  expect(status).toContain("foreign.txt");
});

test("throw on commit failure — pre-commit hook blocks", async () => {
  gitInit(tmpDir);
  mkdirSync(join(tmpDir, "systems-cache", "test-system"), { recursive: true });
  writeFileSync(join(tmpDir, "systems-cache", "test-system", "system-config.yaml"), "initial\n");
  gitCommit(tmpDir, "initial");

  // Install a failing pre-commit hook
  const hookPath = join(tmpDir, ".git", "hooks", "pre-commit");
  writeFileSync(hookPath, "#!/bin/sh\necho 'blocked by hook'\nexit 1\n");
  execSync(`chmod +x ${hookPath}`, { stdio: "pipe" });

  writeFileSync(join(tmpDir, "systems-cache", "test-system", "system-config.yaml"), "modified\n");

  await expect(
    commitWerkstattSideEffects(
      tmpDir,
      ["systems-cache/test-system/system-config.yaml"],
      "werkstatt: test",
    ),
  ).rejects.toThrow();
});

test("non-existent file — skipped silently via allowNonZero", async () => {
  gitInit(tmpDir);
  mkdirSync(join(tmpDir, "systems-cache", "test-system"), { recursive: true });
  writeFileSync(join(tmpDir, "systems-cache", "test-system", "system-config.yaml"), "initial\n");
  gitCommit(tmpDir, "initial");

  writeFileSync(join(tmpDir, "systems-cache", "test-system", "system-config.yaml"), "modified\n");

  const result = await commitWerkstattSideEffects(
    tmpDir,
    ["systems-cache/test-system/system-config.yaml", "does/not/exist.yaml"],
    "werkstatt: test",
  );

  expect(result.committed).toBe(true);
  expect(result.commitSha).toBeTruthy();
});

test("commit message format — passed correctly", async () => {
  gitInit(tmpDir);
  mkdirSync(join(tmpDir, "missions"));
  writeFileSync(join(tmpDir, "missions", "mission.yaml"), "initial\n");
  gitCommit(tmpDir, "initial");

  writeFileSync(join(tmpDir, "missions", "mission.yaml"), "modified\n");

  const message = "werkstatt: mission.open test-m000001";
  const result = await commitWerkstattSideEffects(tmpDir, ["missions/mission.yaml"], message);

  expect(result.committed).toBe(true);

  const logMsg = execSync("git log -1 --format=%s", {
    cwd: tmpDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  expect(logMsg).toBe(message);
});
