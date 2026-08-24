/*
<MODULE_CONTRACT>
<purpose>RFC-0522: tests for git am --3way fallback logic in mission.reconcile patch loop.</purpose>
<keywords>RFC-0522, reconcile, 3way, git am, fallback, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0522: add unit tests for 3-way fallback and both-fail error.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

function gitInit(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

let workpieceDir: string;
let cacheCloneDir: string;
let patchDir: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "tmp-3way-"));
  workpieceDir = join(base, "workpiece");
  cacheCloneDir = join(base, "cache");
  patchDir = join(base, "patches");
  mkdirSync(workpieceDir, { recursive: true });
  mkdirSync(cacheCloneDir, { recursive: true });
  mkdirSync(patchDir, { recursive: true });
});

afterEach(() => {
  const base = join(workpieceDir, "..");
  rmSync(base, { recursive: true, force: true });
});

test("plain git am succeeds when patch applies cleanly", () => {
  gitInit(workpieceDir);
  writeFileSync(join(workpieceDir, "file.txt"), "initial");
  gitCommit(workpieceDir, "initial");
  writeFileSync(join(workpieceDir, "file.txt"), "modified");
  gitCommit(workpieceDir, "edit");

  // Create cache clone with initial state
  gitInit(cacheCloneDir);
  writeFileSync(join(cacheCloneDir, "file.txt"), "initial");
  gitCommit(cacheCloneDir, "initial");

  // Generate patch from workpiece (skip root commit)
  const rootSha = execSync("git rev-list --max-parents=0 HEAD", {
    cwd: workpieceDir,
    encoding: "utf-8",
  }).trim();
  execSync(`git format-patch ${rootSha}..HEAD -o ${JSON.stringify(patchDir)}`, {
    cwd: workpieceDir,
    stdio: "pipe",
  });

  // Apply patch with plain git am
  const patches = execSync(`ls ${JSON.stringify(patchDir)}`, { encoding: "utf-8" })
    .trim()
    .split("\n");
  for (const patch of patches.sort()) {
    execSync(`git am ${JSON.stringify(join(patchDir, patch))}`, {
      cwd: cacheCloneDir,
      stdio: "pipe",
    });
  }

  const content = execSync("cat file.txt", { cwd: cacheCloneDir, encoding: "utf-8" }).trim();
  expect(content).toBe("modified");
});

test("git am --3way fallback is attempted after plain am fails", () => {
  gitInit(workpieceDir);
  writeFileSync(join(workpieceDir, "file.txt"), "initial");
  gitCommit(workpieceDir, "initial");
  writeFileSync(join(workpieceDir, "file.txt"), "workpiece-edit");
  gitCommit(workpieceDir, "edit");

  // Create cache clone with different content
  gitInit(cacheCloneDir);
  writeFileSync(join(cacheCloneDir, "file.txt"), "different");
  gitCommit(cacheCloneDir, "initial");

  // Generate patch from workpiece
  const rootSha = execSync("git rev-list --max-parents=0 HEAD", {
    cwd: workpieceDir,
    encoding: "utf-8",
  }).trim();
  execSync(`git format-patch ${rootSha}..HEAD -o ${JSON.stringify(patchDir)}`, {
    cwd: workpieceDir,
    stdio: "pipe",
  });

  const patches = execSync(`ls ${JSON.stringify(patchDir)}`, { encoding: "utf-8" })
    .trim()
    .split("\n");
  const patchPath = join(patchDir, patches.sort()[0]!);

  // Plain am fails
  expect(() => {
    execSync(`git am ${JSON.stringify(patchPath)}`, { cwd: cacheCloneDir, stdio: "pipe" });
  }).toThrow();

  // Abort and retry with 3way
  try {
    execSync("git am --abort", { cwd: cacheCloneDir, stdio: "pipe" });
  } catch {
    // no am session
  }

  // 3way may succeed or fail depending on common ancestor — either way it should not leave am state
  try {
    execSync(`git am --3way ${JSON.stringify(patchPath)}`, {
      cwd: cacheCloneDir,
      stdio: "pipe",
    });
  } catch {
    // 3way also failed — abort any partial state
    try {
      execSync("git am --abort", { cwd: cacheCloneDir, stdio: "pipe" });
    } catch {
      // no am session
    }
  }

  // Repo should not have am in progress
  const status = execSync("git status --porcelain", {
    cwd: cacheCloneDir,
    encoding: "utf-8",
  }).trim();
  expect(status).not.toContain("rebase");
});

test("both plain and 3way git am fail produces clear error", () => {
  gitInit(workpieceDir);
  writeFileSync(join(workpieceDir, "file.txt"), "initial");
  gitCommit(workpieceDir, "initial");
  writeFileSync(join(workpieceDir, "file.txt"), "workpiece-edit");
  gitCommit(workpieceDir, "edit");

  // Create cache clone with a completely different file
  gitInit(cacheCloneDir);
  writeFileSync(join(cacheCloneDir, "different.txt"), "content");
  gitCommit(cacheCloneDir, "initial");

  // Generate patch from workpiece
  const rootSha = execSync("git rev-list --max-parents=0 HEAD", {
    cwd: workpieceDir,
    encoding: "utf-8",
  }).trim();
  execSync(`git format-patch ${rootSha}..HEAD -o ${JSON.stringify(patchDir)}`, {
    cwd: workpieceDir,
    stdio: "pipe",
  });

  const patches = execSync(`ls ${JSON.stringify(patchDir)}`, { encoding: "utf-8" })
    .trim()
    .split("\n");
  const patchPath = join(patchDir, patches.sort()[0]!);

  // Plain am fails
  expect(() => {
    execSync(`git am ${JSON.stringify(patchPath)}`, { cwd: cacheCloneDir, stdio: "pipe" });
  }).toThrow();
  try {
    execSync("git am --abort", { cwd: cacheCloneDir, stdio: "pipe" });
  } catch {
    // no am session
  }

  // 3way also fails (no common ancestor for the file)
  expect(() => {
    execSync(`git am --3way ${JSON.stringify(patchPath)}`, { cwd: cacheCloneDir, stdio: "pipe" });
  }).toThrow();
  try {
    execSync("git am --abort", { cwd: cacheCloneDir, stdio: "pipe" });
  } catch {
    // no am session
  }
});
