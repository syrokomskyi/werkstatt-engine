/*
<MODULE_CONTRACT>
  <purpose>RFC-0568: Integration tests for clone-based materialization and merge-based reconcile.</purpose>
  <keywords>RFC-0568, clone, merge, reconcile, materialize, test, git</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0568: initial integration tests for investigateUntrackedFiles and merge-based reconcile flow.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { investigateUntrackedFiles, isWorkpieceDirty } from "./mission-git-commit.ts";

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

async function setupRegistry(workspaceRoot: string, systemId: string): Promise<void> {
  const cacheDir = path.join(workspaceRoot, "..", "systems-cache", systemId);
  await fs.mkdir(cacheDir, { recursive: true });
  const configContent = `schemaVersion: system-config/v1\nid: ${systemId}\ncosmicStar: Vega\nmirrors:\n  - path: "../systems-cache/${systemId}"\n    storageType: non-bare\npinnedPlatform: "4.5.0"\nstatus: active\nregisteredAt: "2026-01-01T00:00:00Z"\nnotes: ""\n`;
  await fs.writeFile(path.join(cacheDir, "system-config.yaml"), configContent, "utf8");
}

let tmpDir: string;
let cacheCloneDir: string;
let workpieceDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rfc-0568-test-"));
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
  await fs.mkdir(path.join(cacheCloneDir, "provenance"), { recursive: true });
  await fs.writeFile(path.join(cacheCloneDir, "provenance/pin.json"), "{}");
  await fs.writeFile(path.join(cacheCloneDir, "system.pin.json"), '{"version":"1.0"}');

  // Create bordbuch directory (non-data-path, should be removed from workpiece)
  await fs.mkdir(path.join(cacheCloneDir, "bordbuch"), { recursive: true });
  await fs.writeFile(path.join(cacheCloneDir, "bordbuch/events.ndjson"), "");

  git(cacheCloneDir, "add -A");
  git(cacheCloneDir, 'commit -m "initial cache clone"');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("investigateUntrackedFiles classifies boilerplate files as previous-mission when within mission time range", async () => {
  const workspaceRoot = path.join(tmpDir, "workspace");
  await setupRegistry(workspaceRoot, "test-system");
  // Create a bordbuch file with a mission-open entry
  const bordbuchDir = path.join(workspaceRoot, "..", "systems-cache", "test-system", "bordbuch");
  await fs.mkdir(bordbuchDir, { recursive: true });
  const missionOpenTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
  const bordbuchEntry = {
    schemaVersion: "1.0.0",
    id: "event-000001",
    systemId: "test-system",
    occurredAt: missionOpenTime,
    kind: "mission-open",
    status: "done",
    missionId: "test-mission",
    releaseId: null,
    actor: "test-agent",
    summary: "Mission opened",
    previousHash: null,
    hash: "sha256:fake",
  };
  await fs.writeFile(path.join(bordbuchDir, "events.ndjson"), JSON.stringify(bordbuchEntry) + "\n");

  // Create an untracked boilerplate file in the cache clone
  const boilerplateFile = "package.json";
  await fs.writeFile(path.join(cacheCloneDir, boilerplateFile), '{"name":"test"}');

  const reports = await investigateUntrackedFiles(workspaceRoot, "test-system", cacheCloneDir, [
    boilerplateFile,
  ]);

  expect(reports).toHaveLength(1);
  expect(reports[0].path).toBe(boilerplateFile);
  expect(reports[0].likelyOrigin).toBe("previous-mission");
});

test("investigateUntrackedFiles classifies non-boilerplate files as direct-commit when outside mission time range", async () => {
  // No bordbuch entries — no mission time ranges
  const workspaceRoot = path.join(tmpDir, "workspace");
  await setupRegistry(workspaceRoot, "test-system");
  await fs.mkdir(path.join(workspaceRoot, "..", "systems-cache", "test-system", "bordbuch"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(workspaceRoot, "..", "systems-cache", "test-system", "bordbuch", "events.ndjson"),
    "",
  );

  // Create a non-boilerplate untracked file
  const nonBoilerplateFile = "custom-config.yaml";
  await fs.writeFile(path.join(cacheCloneDir, nonBoilerplateFile), "key: value");

  const reports = await investigateUntrackedFiles(workspaceRoot, "test-system", cacheCloneDir, [
    nonBoilerplateFile,
  ]);

  expect(reports).toHaveLength(1);
  expect(reports[0].path).toBe(nonBoilerplateFile);
  expect(reports[0].likelyOrigin).toBe("direct-commit");
});

test("investigateUntrackedFiles returns unknown for boilerplate files outside mission time range", async () => {
  const workspaceRoot = path.join(tmpDir, "workspace");
  await setupRegistry(workspaceRoot, "test-system");
  await fs.mkdir(path.join(workspaceRoot, "..", "systems-cache", "test-system", "bordbuch"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(workspaceRoot, "..", "systems-cache", "test-system", "bordbuch", "events.ndjson"),
    "",
  );

  // Create a boilerplate file but with no mission-open bordbuch entries
  const boilerplateFile = "package.json";
  await fs.writeFile(path.join(cacheCloneDir, boilerplateFile), '{"name":"test"}');

  const reports = await investigateUntrackedFiles(workspaceRoot, "test-system", cacheCloneDir, [
    boilerplateFile,
  ]);

  expect(reports).toHaveLength(1);
  expect(reports[0].path).toBe(boilerplateFile);
  // isBoilerplate=true but inMissionRange=false → unknown
  expect(reports[0].likelyOrigin).toBe("unknown");
});

test("isWorkpieceDirty detects untracked files in cache clone", async () => {
  // Add an untracked file to the cache clone
  await fs.writeFile(path.join(cacheCloneDir, "untracked.txt"), "untracked");
  const result = isWorkpieceDirty(cacheCloneDir);
  expect(result.dirty).toBe(true);
  expect(result.fileCount).toBe(1);
  expect(result.files).toContain("untracked.txt");
});

test("git clone creates shared object database between cache clone and workpiece", async () => {
  // Simulate the clone-based materialization flow — git clone creates the dir
  git(tmpDir, `clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`);

  // Verify the workpiece has the same commits
  const cacheLog = git(cacheCloneDir, "log --oneline");
  const workpieceLog = git(workpieceDir, "log --oneline");
  expect(cacheLog).toBe(workpieceLog);

  // Verify data paths are present
  expect(existsSync(path.join(workpieceDir, "src/content/system.md"))).toBe(true);
  expect(existsSync(path.join(workpieceDir, "public/logo.svg"))).toBe(true);
  expect(existsSync(path.join(workpieceDir, "provenance/pin.json"))).toBe(true);
  expect(existsSync(path.join(workpieceDir, "system.pin.json"))).toBe(true);

  // Verify non-data-path files are also present (they'll be removed in materialize)
  expect(existsSync(path.join(workpieceDir, "bordbuch/events.ndjson"))).toBe(true);
});

test("git merge --no-ff transfers workpiece commits to cache clone", async () => {
  // Clone cache clone into workpiece — git clone creates the dir
  git(tmpDir, `clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`);
  git(workpieceDir, 'config user.email "test@example.com"');
  git(workpieceDir, 'config user.name "Test"');

  // Make an edit in the workpiece (data path only)
  await fs.writeFile(path.join(workpieceDir, "src/content/system.md"), "# Updated System\n");
  git(workpieceDir, "add src/content/system.md");
  git(workpieceDir, 'commit -m "edit system.md"');

  const preReconcileSha = git(cacheCloneDir, "rev-parse HEAD");

  // Fetch and merge --no-ff (simulating reconcile)
  const workpieceBranch = git(workpieceDir, "rev-parse --abbrev-ref HEAD");
  git(cacheCloneDir, `fetch ${JSON.stringify(workpieceDir)} ${JSON.stringify(workpieceBranch)}`);
  git(cacheCloneDir, `merge --no-ff FETCH_HEAD -m "reconcile mission test"`);

  // Verify the merge commit exists
  const postReconcileSha = git(cacheCloneDir, "rev-parse HEAD");
  expect(postReconcileSha).not.toBe(preReconcileSha);

  // Verify the data change was transferred
  const content = execSync(
    `cat ${JSON.stringify(path.join(cacheCloneDir, "src/content/system.md"))}`,
    {
      encoding: "utf-8",
    },
  );
  expect(content).toContain("# Updated System");

  // Verify transferred commit count
  const count = git(cacheCloneDir, `rev-list --count ${preReconcileSha}..FETCH_HEAD`);
  expect(parseInt(count, 10)).toBe(1);
});

test("git merge --no-ff is idempotent via preReconcileSha reset", async () => {
  // Clone cache clone into workpiece — git clone creates the dir
  git(tmpDir, `clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`);
  git(workpieceDir, 'config user.email "test@example.com"');
  git(workpieceDir, 'config user.name "Test"');

  // Make an edit in the workpiece
  await fs.writeFile(path.join(workpieceDir, "src/content/system.md"), "# Updated System\n");
  git(workpieceDir, "add src/content/system.md");
  git(workpieceDir, 'commit -m "edit system.md"');

  const preReconcileSha = git(cacheCloneDir, "rev-parse HEAD");

  // First reconcile
  const workpieceBranch = git(workpieceDir, "rev-parse --abbrev-ref HEAD");
  git(cacheCloneDir, `fetch ${JSON.stringify(workpieceDir)} ${JSON.stringify(workpieceBranch)}`);
  git(cacheCloneDir, `merge --no-ff FETCH_HEAD -m "reconcile mission test"`);
  const _firstPostSha = git(cacheCloneDir, "rev-parse HEAD");

  // Simulate idempotent re-run: reset to preReconcileSha and re-merge
  git(cacheCloneDir, `reset --hard ${preReconcileSha}`);
  git(cacheCloneDir, `fetch ${JSON.stringify(workpieceDir)} ${JSON.stringify(workpieceBranch)}`);
  git(cacheCloneDir, `merge --no-ff FETCH_HEAD -m "reconcile mission test"`);
  const secondPostSha = git(cacheCloneDir, "rev-parse HEAD");

  // The content should be the same after re-run
  expect(secondPostSha).not.toBe(preReconcileSha);
  // The SHAs may differ (merge commit timestamps differ) but content is the same
  const content = execSync(
    `cat ${JSON.stringify(path.join(cacheCloneDir, "src/content/system.md"))}`,
    {
      encoding: "utf-8",
    },
  );
  expect(content).toContain("# Updated System");
});

test("non-data-path files from clone are removed before boilerplate generation", async () => {
  // Clone cache clone into workpiece — git clone creates the dir
  git(tmpDir, `clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`);

  // Simulate removal of non-data-path files (as materialize does)
  const STERNSYSTEM_DATA_PATHS = ["src/content", "public", "provenance"];
  const keepPaths = new Set([...STERNSYSTEM_DATA_PATHS, "system.pin.json", ".git"]);
  const entries = await fs.readdir(workpieceDir, { withFileTypes: true });
  for (const entry of entries) {
    const isKeepPath =
      keepPaths.has(entry.name) || [...keepPaths].some((kp) => kp.startsWith(`${entry.name}/`));
    if (!isKeepPath) {
      await fs.rm(path.join(workpieceDir, entry.name), { recursive: true, force: true });
    }
  }

  // Verify data paths are preserved
  expect(existsSync(path.join(workpieceDir, "src/content/system.md"))).toBe(true);
  expect(existsSync(path.join(workpieceDir, "public/logo.svg"))).toBe(true);
  expect(existsSync(path.join(workpieceDir, "provenance/pin.json"))).toBe(true);
  expect(existsSync(path.join(workpieceDir, "system.pin.json"))).toBe(true);

  // Verify non-data-path files are removed
  expect(existsSync(path.join(workpieceDir, "bordbuch"))).toBe(false);

  // Verify .git is preserved
  expect(existsSync(path.join(workpieceDir, ".git"))).toBe(true);
});

test("data-only materialize commit does not include boilerplate files", async () => {
  // Clone cache clone into workpiece — git clone creates the dir
  git(tmpDir, `clone ${JSON.stringify(cacheCloneDir)} ${JSON.stringify(workpieceDir)}`);
  git(workpieceDir, 'config user.email "test@example.com"');
  git(workpieceDir, 'config user.name "Test"');

  // Remove non-data-path files (as materialize does)
  const STERNSYSTEM_DATA_PATHS = ["src/content", "public", "provenance"];
  const keepPaths = new Set([...STERNSYSTEM_DATA_PATHS, "system.pin.json", ".git"]);
  const entries = await fs.readdir(workpieceDir, { withFileTypes: true });
  for (const entry of entries) {
    const isKeepPath =
      keepPaths.has(entry.name) || [...keepPaths].some((kp) => kp.startsWith(`${entry.name}/`));
    if (!isKeepPath) {
      await fs.rm(path.join(workpieceDir, entry.name), { recursive: true, force: true });
    }
  }

  // Add a boilerplate file (simulating generateFullBoilerplate)
  await fs.writeFile(path.join(workpieceDir, "package.json"), '{"name":"test"}');
  await fs.writeFile(path.join(workpieceDir, "astro.config.mjs"), "export default {}");

  // Stage only data paths (as materialize does)
  // After clone, data files are already tracked. We need to check if there are
  // any changes to stage. Since we removed non-data-path files, those removals
  // need to be staged too. But the materialize commit should only contain data paths.
  // The key assertion is that boilerplate files remain untracked.
  const dataPathsToAdd = [...STERNSYSTEM_DATA_PATHS, "system.pin.json"];
  for (const dataPath of dataPathsToAdd) {
    const fullPath = path.join(workpieceDir, dataPath);
    if (existsSync(fullPath)) {
      git(workpieceDir, `add -- ${JSON.stringify(dataPath)}`);
    }
  }

  // Check what's staged — boilerplate files should NOT be staged
  const stagedFiles = git(workpieceDir, "diff --cached --name-only");
  expect(stagedFiles).not.toContain("package.json");
  expect(stagedFiles).not.toContain("astro.config.mjs");
  // Data files are already tracked from clone — no changes to stage unless modified
  // The staged files list may be empty if no data files were modified

  // Commit (may be empty if no changes — that's fine, the point is boilerplate is untracked)
  try {
    git(workpieceDir, 'commit -m "materialize from pin 1.0"');
  } catch {
    // No changes to commit — expected if data files weren't modified
  }

  // Verify boilerplate files are untracked
  const status = git(workpieceDir, "status --porcelain");
  expect(status).toContain("?? package.json");
  expect(status).toContain("?? astro.config.mjs");
});
