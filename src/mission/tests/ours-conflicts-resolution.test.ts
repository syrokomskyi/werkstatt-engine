/*
<MODULE_CONTRACT>
  <purpose>
    warpgogol-m000196: regression tests for resolveOursConflicts — the
    reconcile merge auto-resolution for cache-clone-only paths. Covers both
    "ours" meanings: restore the clone HEAD version (path tracked in HEAD,
    UU conflict) and keep the path ABSENT (gitignored RFC-0913 file arriving
    tracked from the workpiece side, DU conflict — the case that failed real
    reconciles with "pathspec did not match" before the fix).
  </purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>warpgogol-m000196: initial tests — real temp git repos, DU absent-in-HEAD and UU present-in-HEAD scenarios.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createDefaultIO } from "@warpgogol/werkstatt-engine/kernel";
import { resolveOursConflicts } from "../mission-materialization-commands.ts";

function git(dir: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
}

function gitInit(dir: string): void {
  execSync("git init -q", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
  execSync("git config commit.gpgsign false", { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -q -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

let tmpDir: string;
let cloneDir: string;
let workpieceDir: string;
const io = createDefaultIO().io;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-ours-conflicts-"));
  cloneDir = join(tmpDir, "clone");
  workpieceDir = join(tmpDir, "workpiece");
  mkdirSync(cloneDir);
  gitInit(cloneDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Shared scenario mirroring the real reconcile state: the merge BASE tracks a
 * cache-clone-only file; the clone later untracks it (RFC-0913 — deleted in
 * HEAD, gitignored); the workpiece modifies both the shared file and the
 * clone-only file. Merge → shared.txt UU (both modified), clone-only file DU
 * (deleted in HEAD, modified in FETCH_HEAD).
 */
function seedAndMerge(): void {
  // Base commit in the clone — the merge-base both sides share (mirrors the
  // real topology: the workpiece is materialized from the clone's history).
  // Both cache-clone-only files are tracked in the base (historical drift).
  writeFileSync(join(cloneDir, "shared.txt"), "base version\n");
  writeFileSync(join(cloneDir, "behavior.snapshot.generated.yaml"), "routes: 1\n");
  mkdirSync(join(cloneDir, "bordbuch"));
  writeFileSync(join(cloneDir, "bordbuch", "status.generated.yaml"), "status: old\n");
  gitCommit(cloneDir, "base");

  // Workpiece: a clone of the base repo, then diverge — modify shared.txt +
  // the clone-only files (the drift mission.validate auto-commits on the
  // workpiece side).
  execSync(`git clone -q ${JSON.stringify(cloneDir)} ${JSON.stringify(workpieceDir)}`, {
    stdio: "pipe",
  });
  writeFileSync(join(workpieceDir, "shared.txt"), "workpiece version\n");
  writeFileSync(join(workpieceDir, "behavior.snapshot.generated.yaml"), "routes: 123\n");
  writeFileSync(join(workpieceDir, "bordbuch", "status.generated.yaml"), "status: ok\n");
  gitCommit(workpieceDir, "workpiece: content + generated artifacts");

  // Clone HEAD: operational edit on shared.txt (→ UU on merge) + untrack the
  // clone-only files (RFC-0913, → DU on merge) + gitignore them.
  writeFileSync(join(cloneDir, "shared.txt"), "clone operational edit\n");
  execSync("git rm -q --cached behavior.snapshot.generated.yaml", { cwd: cloneDir, stdio: "pipe" });
  execSync("git rm -q --cached bordbuch/status.generated.yaml", { cwd: cloneDir, stdio: "pipe" });
  rmSync(join(cloneDir, "behavior.snapshot.generated.yaml"));
  rmSync(join(cloneDir, "bordbuch", "status.generated.yaml"));
  writeFileSync(
    join(cloneDir, ".gitignore"),
    "behavior.snapshot.generated.yaml\nbordbuch/status.generated.yaml\n",
  );
  gitCommit(cloneDir, "clone: operational edit + untrack forbidden generated files");

  // Explicit-refspec fetch — mirrors the reconcile fetch
  // (`git fetch <workpieceDir> <branch>`); a bare `git fetch origin` marks the
  // head not-for-merge and "merging" it is a no-op.
  const workpieceBranch = git(workpieceDir, "rev-parse --abbrev-ref HEAD");
  git(cloneDir, `fetch ${JSON.stringify(workpieceDir)} ${workpieceBranch}`);
  // Merge conflicts: shared.txt = UU (both modified), clone-only files = DU
  // (deleted in HEAD, modified in FETCH_HEAD).
  let mergeFailed = false;
  try {
    execSync("git merge --no-ff FETCH_HEAD -m merge", { cwd: cloneDir, stdio: "pipe" });
  } catch {
    mergeFailed = true;
  }
  expect(mergeFailed).toBe(true);
  const status = git(cloneDir, "status --porcelain");
  expect(status).toContain("UU shared.txt");
  expect(status).toContain("DU behavior.snapshot.generated.yaml");
  expect(status).toContain("DU bordbuch/status.generated.yaml");
}

test("ours-resolution keeps clone-only paths ABSENT when clone HEAD never tracked them", async () => {
  seedAndMerge();

  // The exact pre-fix failure: git checkout HEAD -- on a path absent from HEAD
  // throws "pathspec did not match". resolveOursConflicts must instead git rm.
  await resolveOursConflicts(
    cloneDir,
    ["behavior.snapshot.generated.yaml", "bordbuch/status.generated.yaml"],
    io,
  );

  const status = git(cloneDir, "status --porcelain");
  // The clone-only conflicts are resolved (no DU left for them).
  expect(status).not.toContain("DU behavior.snapshot.generated.yaml");
  expect(status).not.toContain("DU bordbuch/status.generated.yaml");
  // The worktree no longer carries the workpiece-side copies.
  expect(existsSync(join(cloneDir, "behavior.snapshot.generated.yaml"))).toBe(false);
  expect(existsSync(join(cloneDir, "bordbuch", "status.generated.yaml"))).toBe(false);
  // shared.txt remains conflicted (untouched by the ours-resolution).
  expect(status).toContain("UU shared.txt");
});

test("ours-resolution restores the clone HEAD version for paths tracked in HEAD", async () => {
  seedAndMerge();

  await resolveOursConflicts(cloneDir, ["shared.txt"], io);

  const status = git(cloneDir, "status --porcelain");
  expect(status).not.toContain("UU shared.txt");
  expect(readFileSync(join(cloneDir, "shared.txt"), "utf8")).toBe("clone operational edit\n");
});

test("ours-resolution handles a mixed batch (absent + present) in one call", async () => {
  seedAndMerge();

  await resolveOursConflicts(cloneDir, ["behavior.snapshot.generated.yaml", "shared.txt"], io);

  const status = git(cloneDir, "status --porcelain");
  expect(status).not.toContain("DU behavior.snapshot.generated.yaml");
  expect(status).not.toContain("UU shared.txt");
  expect(existsSync(join(cloneDir, "behavior.snapshot.generated.yaml"))).toBe(false);
  expect(readFileSync(join(cloneDir, "shared.txt"), "utf8")).toBe("clone operational edit\n");
});
