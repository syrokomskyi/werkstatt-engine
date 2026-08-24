/*
<MODULE_CONTRACT>
  <purpose>RFC-0644: Unit tests for commitWorkpieceIfDirty helper — auto-commit dirty workpiece before mission.reconcile.</purpose>
  <keywords>RFC-0644, workpiece, auto-commit, reconcile, test, git</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0644: initial unit tests for commitWorkpieceIfDirty — dirty, clean, and idempotent scenarios.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { commitWorkpieceIfDirty } from "./mission-git-commit.ts";

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

let tmpDir: string;
let workpieceDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0644-test-"));
  workpieceDir = path.join(tmpDir, "workpiece");

  await fs.mkdir(workpieceDir, { recursive: true });
  git(workpieceDir, "init");
  git(workpieceDir, 'config user.email "test@example.com"');
  git(workpieceDir, 'config user.name "Test"');

  await fs.writeFile(path.join(workpieceDir, "system.md"), "# System\n");
  git(workpieceDir, "add -A");
  git(workpieceDir, 'commit -m "initial"');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("dirty workpiece → auto-commit created", async () => {
  await fs.mkdir(path.join(workpieceDir, "public", "icons"), { recursive: true });
  await fs.writeFile(path.join(workpieceDir, "public/icons/generated.svg"), "<svg/>");
  await fs.mkdir(path.join(workpieceDir, "src", "content"), { recursive: true });
  await fs.writeFile(path.join(workpieceDir, "src/content/system.md"), "# Updated System\n");

  const result = commitWorkpieceIfDirty(workpieceDir, "test-mission");

  expect(result.committed).toBe(true);
  expect(result.commitSha).not.toBeNull();
  expect(result.commitSha).toHaveLength(40);

  const log = git(workpieceDir, "log --oneline -1");
  expect(log).toContain("workpiece: auto-commit before reconcile test-mission");

  const status = git(workpieceDir, "status --porcelain");
  expect(status).toBe("");
});

test("clean workpiece → no auto-commit", async () => {
  const initialSha = git(workpieceDir, "rev-parse HEAD");

  const result = commitWorkpieceIfDirty(workpieceDir, "test-mission");

  expect(result.committed).toBe(false);
  expect(result.commitSha).toBeNull();

  const currentSha = git(workpieceDir, "rev-parse HEAD");
  expect(currentSha).toBe(initialSha);
});

test("idempotent re-run on clean workpiece after first auto-commit", async () => {
  await fs.mkdir(path.join(workpieceDir, "public", "icons"), { recursive: true });
  await fs.writeFile(path.join(workpieceDir, "public/icons/generated.svg"), "<svg/>");

  const first = commitWorkpieceIfDirty(workpieceDir, "test-mission");
  expect(first.committed).toBe(true);
  expect(first.commitSha).not.toBeNull();

  const second = commitWorkpieceIfDirty(workpieceDir, "test-mission");
  expect(second.committed).toBe(false);
  expect(second.commitSha).toBeNull();

  const log = git(workpieceDir, "log --oneline -1");
  expect(log).toContain("workpiece: auto-commit before reconcile test-mission");
});
