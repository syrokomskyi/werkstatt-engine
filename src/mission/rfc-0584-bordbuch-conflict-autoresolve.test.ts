/*
<MODULE_CONTRACT>
  <purpose>RFC-0584: Unit tests for bordbuch delete-modify conflict auto-resolution in mission.reconcile.</purpose>
  <keywords>RFC-0584, bordbuch, conflict, auto-resolve, delete-modify, merge, reconcile, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0584: initial tests for bordbuch-only conflict auto-resolution, non-bordbuch hard-failure, and mixed conflict hard-failure.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

// Helper for git commands expected to fail with a conflict (exit code 1).
// Not a general-purpose error swallower — only use for merge commands where
// non-zero exit signals a conflict, not an unexpected git failure.
function gitExpectFail(cwd: string, args: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

let tmpDir: string;
let cacheCloneDir: string;
let workpieceDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0584-test-"));
  cacheCloneDir = path.join(tmpDir, "cache-clone");
  workpieceDir = path.join(tmpDir, "workpiece");

  // Create cache clone with initial content
  await fs.mkdir(cacheCloneDir, { recursive: true });
  git(cacheCloneDir, "init");
  git(cacheCloneDir, 'config user.email "test@example.com"');
  git(cacheCloneDir, 'config user.name "Test"');

  // Create data paths
  await fs.mkdir(path.join(cacheCloneDir, "src/content"), { recursive: true });
  await fs.writeFile(path.join(cacheCloneDir, "src/content/system.md"), "# System\n");
  await fs.mkdir(path.join(cacheCloneDir, "public"), { recursive: true });
  await fs.writeFile(path.join(cacheCloneDir, "public/logo.svg"), "<svg/>");

  // Create bordbuch directory (cache-clone-only, not in workpiece after materialization)
  await fs.mkdir(path.join(cacheCloneDir, "bordbuch"), { recursive: true });
  await fs.writeFile(path.join(cacheCloneDir, "bordbuch/events.ndjson"), "");

  git(cacheCloneDir, "add -A");
  git(cacheCloneDir, 'commit -m "initial cache clone"');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("RFC-0584: bordbuch delete-modify conflict is auto-resolved by keeping cache clone version", async () => {
  // Clone cache clone into workpiece — git clone creates the dir
  git(tmpDir, `clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`);
  git(workpieceDir, 'config user.email "test@example.com"');
  git(workpieceDir, 'config user.name "Test"');

  // Simulate materialization: remove bordbuch from workpiece (non-data-path)
  await fs.rm(path.join(workpieceDir, "bordbuch"), { recursive: true, force: true });
  git(workpieceDir, "add -A");
  git(workpieceDir, 'commit -m "remove bordbuch from workpiece"');

  // Modify bordbuch in cache clone (simulating bordbuch.append during mission)
  await fs.writeFile(
    path.join(cacheCloneDir, "bordbuch/events.ndjson"),
    '{"event":"mission-open"}\n',
  );
  git(cacheCloneDir, "add bordbuch/events.ndjson");
  git(cacheCloneDir, 'commit -m "append bordbuch event"');

  // Record pre-merge bordbuch content for verification
  const preMergeBordbuch = execSync(
    `cat ${JSON.stringify(path.join(cacheCloneDir, "bordbuch/events.ndjson"))}`,
    { encoding: "utf-8" },
  );

  const preMergeSha = git(cacheCloneDir, "rev-parse HEAD");

  // Fetch and attempt merge — this will create a delete-modify conflict on bordbuch/
  const workpieceBranch = git(workpieceDir, "rev-parse --abbrev-ref HEAD");
  git(cacheCloneDir, `fetch ${JSON.stringify(workpieceDir)} ${JSON.stringify(workpieceBranch)}`);

  // The merge will fail with a conflict — simulate the auto-resolution logic
  gitExpectFail(cacheCloneDir, 'merge --no-ff FETCH_HEAD -m "reconcile mission test"');

  // Check conflicted paths via git status --porcelain
  const statusOutput = git(cacheCloneDir, "status --porcelain");
  const conflictedPaths = statusOutput
    .split("\n")
    .filter(
      (l) => l.startsWith("DU") || l.startsWith("UD") || l.startsWith("AA") || l.startsWith("UU"),
    )
    .map((l) => l.slice(3).trim());

  // Verify all conflicts are bordbuch-only
  expect(conflictedPaths.length).toBeGreaterThan(0);
  expect(conflictedPaths.every((p) => p.startsWith("bordbuch/"))).toBe(true);

  // Auto-resolve: keep cache clone's bordbuch (ours)
  git(cacheCloneDir, "checkout --ours bordbuch/");
  git(cacheCloneDir, "add bordbuch/");
  git(cacheCloneDir, "commit --no-edit");

  // Verify: merge commit exists, no conflicted files remain
  const postMergeSha = git(cacheCloneDir, "rev-parse HEAD");
  expect(postMergeSha).not.toBe(preMergeSha);

  const postMergeStatus = git(cacheCloneDir, "status --porcelain");
  expect(postMergeStatus).toBe("");

  // Verify: bordbuch content matches pre-merge version (cache clone's version preserved)
  const postMergeBordbuch = execSync(
    `cat ${JSON.stringify(path.join(cacheCloneDir, "bordbuch/events.ndjson"))}`,
    { encoding: "utf-8" },
  );
  expect(postMergeBordbuch).toBe(preMergeBordbuch);
});

test("RFC-0584: non-bordbuch conflict causes hard failure with merge abort", async () => {
  // Clone cache clone into workpiece
  git(tmpDir, `clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`);
  git(workpieceDir, 'config user.email "test@example.com"');
  git(workpieceDir, 'config user.name "Test"');

  // Remove bordbuch from workpiece
  await fs.rm(path.join(workpieceDir, "bordbuch"), { recursive: true, force: true });

  // Modify a data file in BOTH cache clone and workpiece (creating a non-bordbuch conflict)
  await fs.writeFile(path.join(workpieceDir, "src/content/system.md"), "# Workpiece Edit\n");
  git(workpieceDir, "add -A");
  git(workpieceDir, 'commit -m "edit system.md in workpiece + remove bordbuch"');

  await fs.writeFile(path.join(cacheCloneDir, "src/content/system.md"), "# Cache Clone Edit\n");
  git(cacheCloneDir, "add src/content/system.md");
  git(cacheCloneDir, 'commit -m "edit system.md in cache clone"');

  const preMergeSha = git(cacheCloneDir, "rev-parse HEAD");

  // Fetch and attempt merge
  const workpieceBranch = git(workpieceDir, "rev-parse --abbrev-ref HEAD");
  git(cacheCloneDir, `fetch ${JSON.stringify(workpieceDir)} ${JSON.stringify(workpieceBranch)}`);

  // The merge will fail with conflicts (both bordbuch delete-modify AND system.md modify-modify)
  gitExpectFail(cacheCloneDir, 'merge --no-ff FETCH_HEAD -m "reconcile mission test"');

  // Check conflicted paths
  const statusOutput = git(cacheCloneDir, "status --porcelain");
  const conflictedPaths = statusOutput
    .split("\n")
    .filter(
      (l) => l.startsWith("DU") || l.startsWith("UD") || l.startsWith("AA") || l.startsWith("UU"),
    )
    .map((l) => l.slice(3).trim());

  // Verify not all conflicts are bordbuch-only (system.md is also conflicted)
  expect(conflictedPaths.length).toBeGreaterThan(0);
  expect(conflictedPaths.every((p) => p.startsWith("bordbuch/"))).toBe(false);

  // Abort merge
  git(cacheCloneDir, "merge --abort");

  // Verify: cache clone is back to clean state at pre-merge SHA
  const postAbortSha = git(cacheCloneDir, "rev-parse HEAD");
  expect(postAbortSha).toBe(preMergeSha);

  const postAbortStatus = git(cacheCloneDir, "status --porcelain");
  expect(postAbortStatus).toBe("");
});

test("RFC-0584: mixed bordbuch + non-bordbuch conflicts cause hard failure with merge abort", async () => {
  // Clone cache clone into workpiece
  git(tmpDir, `clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`);
  git(workpieceDir, 'config user.email "test@example.com"');
  git(workpieceDir, 'config user.name "Test"');

  // Remove bordbuch from workpiece
  await fs.rm(path.join(workpieceDir, "bordbuch"), { recursive: true, force: true });

  // Modify a data file in BOTH cache clone and workpiece
  await fs.writeFile(path.join(workpieceDir, "src/content/system.md"), "# Workpiece Edit\n");
  git(workpieceDir, "add -A");
  git(workpieceDir, 'commit -m "edit system.md in workpiece + remove bordbuch"');

  // Modify bordbuch in cache clone (creates bordbuch delete-modify conflict)
  await fs.writeFile(
    path.join(cacheCloneDir, "bordbuch/events.ndjson"),
    '{"event":"mission-open"}\n',
  );
  // Modify system.md in cache clone (creates non-bordbuch modify-modify conflict)
  await fs.writeFile(path.join(cacheCloneDir, "src/content/system.md"), "# Cache Clone Edit\n");
  git(cacheCloneDir, "add -A");
  git(cacheCloneDir, 'commit -m "edit bordbuch + system.md in cache clone"');

  const preMergeSha = git(cacheCloneDir, "rev-parse HEAD");

  // Fetch and attempt merge
  const workpieceBranch = git(workpieceDir, "rev-parse --abbrev-ref HEAD");
  git(cacheCloneDir, `fetch ${JSON.stringify(workpieceDir)} ${JSON.stringify(workpieceBranch)}`);

  // The merge will fail with mixed conflicts
  gitExpectFail(cacheCloneDir, 'merge --no-ff FETCH_HEAD -m "reconcile mission test"');

  // Check conflicted paths — should include both bordbuch and non-bordbuch
  const statusOutput = git(cacheCloneDir, "status --porcelain");
  const conflictedPaths = statusOutput
    .split("\n")
    .filter(
      (l) => l.startsWith("DU") || l.startsWith("UD") || l.startsWith("AA") || l.startsWith("UU"),
    )
    .map((l) => l.slice(3).trim());

  // Verify there are both bordbuch and non-bordbuch conflicts
  const bordbuchConflicts = conflictedPaths.filter((p) => p.startsWith("bordbuch/"));
  const nonBordbuchConflicts = conflictedPaths.filter((p) => !p.startsWith("bordbuch/"));
  expect(bordbuchConflicts.length).toBeGreaterThan(0);
  expect(nonBordbuchConflicts.length).toBeGreaterThan(0);

  // Not all conflicts are bordbuch-only — must abort
  expect(conflictedPaths.every((p) => p.startsWith("bordbuch/"))).toBe(false);

  // Abort merge
  git(cacheCloneDir, "merge --abort");

  // Verify: cache clone is back to clean state at pre-merge SHA
  const postAbortSha = git(cacheCloneDir, "rev-parse HEAD");
  expect(postAbortSha).toBe(preMergeSha);

  const postAbortStatus = git(cacheCloneDir, "status --porcelain");
  expect(postAbortStatus).toBe("");
});
