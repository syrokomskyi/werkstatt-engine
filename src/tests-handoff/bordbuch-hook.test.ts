/*
<MODULE_CONTRACT>
  <purpose>RFC-0658: unit tests for installBordbuchPreCommitHook — verifies hook installation, idempotency, and script content.</purpose>
  <keywords>RFC-0658, bordbuch, pre-commit, hook, cache clone</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0658: initial tests for installBordbuchPreCommitHook.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { installBordbuchPreCommitHook } from "../bordbuch/bordbuch-hook.ts";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-bordbuch-hook-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function gitInit(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
}

test("installBordbuchPreCommitHook writes hook to .git/hooks/pre-commit", async () => {
  gitInit(tmpDir);

  const result = await installBordbuchPreCommitHook(tmpDir, "test-system");

  expect(result.installed).toBe(true);
  expect(result.systemId).toBe("test-system");
  expect(existsSync(result.hookPath)).toBe(true);
  expect(result.hookPath).toBe(join(tmpDir, ".git", "hooks", "pre-commit"));
});

test("hook script is executable (mode 0o755)", async () => {
  gitInit(tmpDir);

  const result = await installBordbuchPreCommitHook(tmpDir, "test-system");
  const stat = statSync(result.hookPath);
  const mode = stat.mode & 0o777;
  expect(mode).toBe(0o755);
});

test("hook script content matches RFC-0658 spec", async () => {
  gitInit(tmpDir);

  const result = await installBordbuchPreCommitHook(tmpDir, "test-system");
  const content = readFileSync(result.hookPath, "utf8");

  expect(content).toContain("#!/bin/sh");
  expect(content).toContain("RFC-0658");
  expect(content).toContain("bordbuch/events.ndjson$");
  expect(content).toContain("diff-filter=D");
  expect(content).toContain("exit 1");
  expect(content).toContain("bordbuch.repair");
});

test("idempotent: second call is a no-op (content unchanged)", async () => {
  gitInit(tmpDir);

  const result1 = await installBordbuchPreCommitHook(tmpDir, "test-system");
  const content1 = readFileSync(result1.hookPath, "utf8");

  const result2 = await installBordbuchPreCommitHook(tmpDir, "test-system");
  const content2 = readFileSync(result2.hookPath, "utf8");

  expect(content1).toBe(content2);
});

test("creates .git/hooks/ directory if missing", async () => {
  gitInit(tmpDir);
  const hooksDir = join(tmpDir, ".git", "hooks");
  rmSync(hooksDir, { recursive: true, force: true });

  const result = await installBordbuchPreCommitHook(tmpDir, "test-system");

  expect(existsSync(result.hookPath)).toBe(true);
});

test("returns installed: false for non-git directory", async () => {
  const result = await installBordbuchPreCommitHook(tmpDir, "test-system");

  expect(result.installed).toBe(false);
});
