/*
<MODULE_CONTRACT>
<purpose>RFC-0913: unit tests for cache-clone .gitignore restoration and forbidden file untracking.</purpose>
<keywords>RFC-0913, cache-clone, gitignore, forbidden patterns, untrack</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0913: initial tests for restoreCacheCloneGitignore and untrackForbiddenGeneratedFiles.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  restoreCacheCloneGitignore,
  untrackForbiddenGeneratedFiles,
  CACHE_CLONE_GITIGNORE_SENTINEL,
} from "../mission/cache-clone-gitignore.ts";

function gitInit(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "tmp-gitignore-"));
  gitInit(testDir);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

test("restoreCacheCloneGitignore: appends sentinel + patterns when missing", async () => {
  writeFileSync(join(testDir, ".gitignore"), "node_modules/\ndist/\n");

  const result = await restoreCacheCloneGitignore(testDir);

  expect(result).toBe(true);
  const content = readFileSync(join(testDir, ".gitignore"), "utf8");
  expect(content).toContain(CACHE_CLONE_GITIGNORE_SENTINEL);
  expect(content).toContain("package.json");
  expect(content).toContain("wrangler.jsonc");
  expect(content).toContain("node_modules/");
  expect(content).toContain("dist/");
});

test("restoreCacheCloneGitignore: skips when sentinel already present (idempotent)", async () => {
  const initial =
    "node_modules/\n\n" + CACHE_CLONE_GITIGNORE_SENTINEL + "\npackage.json\nwrangler.jsonc\n";
  writeFileSync(join(testDir, ".gitignore"), initial);

  const result = await restoreCacheCloneGitignore(testDir);

  expect(result).toBe(false);
  const content = readFileSync(join(testDir, ".gitignore"), "utf8");
  expect(content).toBe(initial);
});

test("restoreCacheCloneGitignore: creates .gitignore when it does not exist", async () => {
  const result = await restoreCacheCloneGitignore(testDir);

  expect(result).toBe(true);
  expect(existsSync(join(testDir, ".gitignore"))).toBe(true);
  const content = readFileSync(join(testDir, ".gitignore"), "utf8");
  expect(content).toContain(CACHE_CLONE_GITIGNORE_SENTINEL);
  expect(content).toContain("package.json");
});

test("untrackForbiddenGeneratedFiles: untracks tracked forbidden files", () => {
  writeFileSync(join(testDir, "package.json"), "{}\n");
  writeFileSync(join(testDir, "tsconfig.json"), "{}\n");
  execSync("git add -A", { cwd: testDir, stdio: "pipe" });
  execSync("git commit -m initial", { cwd: testDir, stdio: "pipe" });

  const untracked = untrackForbiddenGeneratedFiles(testDir);

  expect(untracked.length).toBeGreaterThan(0);
  expect(untracked).toContain("package.json");
  expect(untracked).toContain("tsconfig.json");

  const status = execSync("git status --porcelain", {
    cwd: testDir,
    encoding: "utf-8",
  });
  expect(status).toContain("D  package.json");
  expect(status).toContain("D  tsconfig.json");
});

test("untrackForbiddenGeneratedFiles: skips untracked files silently", () => {
  writeFileSync(join(testDir, "README.md"), "# test\n");
  execSync("git add -A", { cwd: testDir, stdio: "pipe" });
  execSync("git commit -m initial", { cwd: testDir, stdio: "pipe" });

  const untracked = untrackForbiddenGeneratedFiles(testDir);

  expect(untracked.length).toBe(0);
});
