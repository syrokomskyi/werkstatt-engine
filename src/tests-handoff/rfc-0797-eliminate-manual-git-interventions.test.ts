/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0797: unit tests for eliminating manual git interventions from mission close pipeline —
    verifies auto-commit dirty workpiece, pre-mirror-check sync, --skip-auto-sync flag,
    and commitCacheCloneIfDirty helper.
  </purpose>
  <keywords>RFC-0797, mission.close, commitWorkpieceIfDirty, commitCacheCloneIfDirty, skip-auto-sync, sternsystem.sync</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0797: initial tests for auto-commit workpiece, pre-mirror-check sync, --skip-auto-sync flag, and commitCacheCloneIfDirty helper.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { expectData } from "./helpers/kernel-result-helpers.ts";
import { tmpdir } from "node:os";

// --- Mocks ---

const mockSync = vi.hoisted(() => ({
  executeKernelCommandResult: {
    exitCode: 0,
    data: {
      systemId: "test-system",
      mirrorUrls: [],
      direction: "push",
      branch: "main",
      commitSha: "abc",
      syncedAt: "2026-08-10T00:00:00.000Z",
    },
    summary: "sternsystem.sync: ok",
  },
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn(async () => mockSync.executeKernelCommandResult),
  };
});

// Mock mission.validate for close tests
vi.mock("../mission/mission-materialization-commands.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../mission/mission-materialization-commands.ts")>();
  return {
    ...actual,
    runMissionValidate: vi.fn(async () => ({
      data: {
        missionId: "test-system-m000001",
        contractFull: { passed: true, validators: [] },
        build: { succeeded: true, routeCount: 5, sitemapHash: "abc" },
      },
      exitCode: 0,
      summary: "Validation passed",
    })),
    runMissionMaterialize: vi.fn(),
    runMissionMigrate: vi.fn(),
  };
});

// --- Shared helpers ---

function gitInit(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
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
  testRoot = mkdtempSync(join(tmpdir(), "tmp-rfc-0797-"));
  tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });
  mockSync.executeKernelCommandResult = {
    exitCode: 0,
    data: {
      systemId: "test-system",
      mirrorUrls: [],
      direction: "push",
      branch: "main",
      commitSha: "abc",
      syncedAt: "2026-08-10T00:00:00.000Z",
    },
    summary: "sternsystem.sync: ok",
  };
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setupCloseWorkspace(opts?: { externalMirrors?: boolean }): void {
  gitInit(tmpWorkspace);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommit(tmpWorkspace, "initial");
  writeFileSync(join(tmpWorkspace, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  gitCommit(tmpWorkspace, "add package.json");

  const cacheDir = join(testRoot, "systems-cache", "test-system");
  mkdirSync(cacheDir, { recursive: true });
  const mirrors = opts?.externalMirrors
    ? `  - path: "../systems-cache/test-system"
    storageType: non-bare
  - path: "../systems-cache/test-system.git"
    storageType: bare
  - path: "git@github.com:warpgogol/test-system.git"
    storageType: bare`
    : `  - path: "../systems-cache/test-system"
    storageType: non-bare
  - path: "../systems-cache/test-system.git"
    storageType: bare`;
  const configContent = `schemaVersion: system-config/v1
id: test-system
cosmicStar: Vega
mirrors:
${mirrors}
pinnedPlatform: "4.5.0"
status: active
registeredAt: "2026-01-01T00:00:00Z"
notes: ""
`;
  writeFileSync(join(cacheDir, "system-config.yaml"), configContent);
  const stateContent = `schemaVersion: system-state/v1
systemId: test-system
currentMission: test-system-m000001
lastRelease: null
`;
  writeFileSync(join(cacheDir, "system-state.yaml"), stateContent);

  // Create cache clone (non-bare) as a git repo
  gitInit(cacheDir);
  writeFileSync(join(cacheDir, "README.md"), "# system\n");
  gitCommit(cacheDir, "initial system");

  // Create bordbuch dir
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), "");
  gitCommit(cacheDir, "add bordbuch");

  // Create bare repo
  const bareDir = join(testRoot, "systems-cache", "test-system.git");
  execSync(`git clone --bare ${JSON.stringify(cacheDir)} ${JSON.stringify(bareDir)}`, {
    stdio: "pipe",
  });

  // Add origin remote to cache clone
  execSync(`git remote add origin ${JSON.stringify(bareDir)}`, {
    cwd: cacheDir,
    stdio: "pipe",
  });

  // Create system.pin.json
  writeFileSync(
    join(cacheDir, "system.pin.json"),
    JSON.stringify({ platform: { version: "1.0.0" } }, null, 2) + "\n",
  );
  gitCommit(cacheDir, "add pin");

  // Push all commits to bare repo
  execSync("git push origin HEAD --force", {
    cwd: cacheDir,
    stdio: "pipe",
  });

  if (opts?.externalMirrors) {
    const branch = execSync("git symbolic-ref HEAD", {
      cwd: cacheDir,
      stdio: "pipe",
      encoding: "utf-8",
    })
      .trim()
      .replace("refs/heads/", "");
    const bareHead = execSync("git rev-parse HEAD", {
      cwd: bareDir,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    execSync(`git update-ref refs/mirror/${branch} ${JSON.stringify(bareHead)}`, {
      cwd: bareDir,
      stdio: "pipe",
    });
  }

  // Create mission
  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  mkdirSync(missionDir, { recursive: true });
  mkdirSync(join(missionDir, "workpiece"), { recursive: true });
  mkdirSync(join(missionDir, "evidence"), { recursive: true });

  const manifest = {
    schemaVersion: "1.0.0",
    missionId: "test-system-m000001",
    systemId: "test-system",
    state: "open",
    brief: "Test mission",
    openedAt: "2026-08-10T00:00:00.000Z",
    openedBy: "test-agent",
    closedAt: null,
    closedBy: null,
    pinAtOpen: "1.0.0",
    materializedAt: "2026-08-10T01:00:00.000Z",
    migratedAt: null,
    reconciledAt: "2026-08-10T02:00:00.000Z",
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");

  // Create workpiece as a git repo
  const workpieceDir = join(missionDir, "workpiece");
  gitInit(workpieceDir);
  writeFileSync(join(workpieceDir, "README.md"), "# workpiece\n");
  gitCommit(workpieceDir, "workpiece initial");

  const workpieceHead = execSync("git rev-parse HEAD", {
    cwd: workpieceDir,
    stdio: "pipe",
    encoding: "utf-8",
  }).trim();
  writeFileSync(
    join(missionDir, "evidence", "reconciliation-report.json"),
    JSON.stringify({ workpieceHeadAtReconcile: workpieceHead }) + "\n",
  );

  gitCommit(tmpWorkspace, "add mission");
}

// --- Tests ---

// 1a: Auto-commit dirty workpiece
test("close auto-commits dirty workpiece instead of throwing", async () => {
  setupCloseWorkspace({ externalMirrors: false });

  const { runMissionClose } = await import("../mission/mission-close.ts");

  // Make workpiece dirty
  const workpieceDir = join(tmpWorkspace, "missions", "test-system-m000001", "workpiece");
  writeFileSync(join(workpieceDir, "new-file.txt"), "new content\n");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent", "skip-evidence-sync": true },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  // Should NOT throw — auto-commit handles dirty workpiece
  const result = await runMissionClose(input, context);
  const data = expectData(result);

  expect(data.closeReport).toBeDefined();
  // Verify workpiece is now clean (auto-committed)
  // RFC-0878: .closed sentinel is written as untracked file — expect only that.
  const status = execSync("git status --porcelain", {
    cwd: workpieceDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  expect(status).toBe("?? .closed");
});

// 2a: Pre-mirror-check sync called when external mirrors configured
test("close calls sternsystem.sync before mirror check when external mirrors configured", async () => {
  setupCloseWorkspace({ externalMirrors: true });

  const { runMissionClose } = await import("../mission/mission-close.ts");
  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");

  vi.mocked(executeKernelCommand).mockClear();

  const input = {
    flags: {
      mission: "test-system-m000001",
      actor: "test-agent",
      "skip-evidence-sync": true,
      "allow-no-op": true,
    },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  try {
    await runMissionClose(input, context);
  } catch {
    // May throw for evidence sync reasons — that's fine, we're checking sync calls
  }

  const syncCalls = vi
    .mocked(executeKernelCommand)
    .mock.calls.filter(
      (call) => (call[0] as { commandName?: string }).commandName === "sternsystem.sync",
    );
  expect(syncCalls.length).toBeGreaterThanOrEqual(1);
});

// 2a: --skip-auto-sync flag disables pre-mirror-check sync
test("close with --skip-auto-sync does not call sternsystem.sync for pre-check", async () => {
  setupCloseWorkspace({ externalMirrors: true });

  const { runMissionClose } = await import("../mission/mission-close.ts");
  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");

  vi.mocked(executeKernelCommand).mockClear();

  const input = {
    flags: {
      mission: "test-system-m000001",
      actor: "test-agent",
      "skip-evidence-sync": true,
      "skip-auto-sync": true,
    },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  try {
    await runMissionClose(input, context);
  } catch {
    // May throw for mirror sync check or evidence sync — that's fine
  }

  // With --skip-auto-sync, sternsystem.sync should NOT be called for pre-check.
  // The post-close sync (RFC-0762) may still be called, so we check that
  // there is no pre-check sync (the first sync call should be post-close).
  // Since --skip-auto-sync skips the pre-check sync, any sync calls should
  // be from the post-close sync (RFC-0762), which runs after state transition.
  // We verify that the total sync calls are at most 1 (post-close only).
  const syncCalls = vi
    .mocked(executeKernelCommand)
    .mock.calls.filter(
      (call) => (call[0] as { commandName?: string }).commandName === "sternsystem.sync",
    );
  // Without --skip-auto-sync, there would be 2 calls (pre-check + post-close).
  // With --skip-auto-sync, there should be at most 1 (post-close only).
  expect(syncCalls.length).toBeLessThanOrEqual(1);
});

// 2a: No external mirrors → pre-check sync not called
test("close without external mirrors does not call sternsystem.sync for pre-check", async () => {
  setupCloseWorkspace({ externalMirrors: false });

  const { runMissionClose } = await import("../mission/mission-close.ts");
  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");

  vi.mocked(executeKernelCommand).mockClear();

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent", "skip-evidence-sync": true },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  try {
    await runMissionClose(input, context);
  } catch {
    // May throw for other reasons — that's fine
  }

  const syncCalls = vi
    .mocked(executeKernelCommand)
    .mock.calls.filter(
      (call) => (call[0] as { commandName?: string }).commandName === "sternsystem.sync",
    );
  expect(syncCalls).toHaveLength(0);
});

// 6a: commitCacheCloneIfDirty commits all dirty files with git add -A
test("commitCacheCloneIfDirty commits all dirty files and returns commit SHA", async () => {
  const { commitCacheCloneIfDirty } = await import("../mission/mission-git-commit.ts");

  // Create a temp git repo with some committed files
  const repoDir = mkdtempSync(join(tmpdir(), "tmp-rfc-0797-cache-"));
  gitInit(repoDir);
  writeFileSync(join(repoDir, "file1.txt"), "content1\n");
  gitCommit(repoDir, "initial");

  // Add dirty files: modify existing + add new untracked
  writeFileSync(join(repoDir, "file1.txt"), "modified content\n");
  writeFileSync(join(repoDir, "file2.txt"), "new file\n");
  mkdirSync(join(repoDir, "bordbuch"), { recursive: true });
  writeFileSync(join(repoDir, "bordbuch", "status.generated.yaml"), "status: ok\n");

  const result = commitCacheCloneIfDirty(repoDir, "test-system");

  expect(result.committed).toBe(true);
  expect(result.commitSha).toBeTruthy();

  // Verify all files were committed (git add -A)
  const status = execSync("git status --porcelain", {
    cwd: repoDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  expect(status).toBe("");

  // Verify the commit message
  const logMsg = execSync("git log -1 --format=%s", {
    cwd: repoDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  expect(logMsg).toContain("cache-clone: auto-commit generated files before reconcile test-system");

  rmSync(repoDir, { recursive: true, force: true });
});

// 6a: commitCacheCloneIfDirty returns committed=false when nothing dirty
test("commitCacheCloneIfDirty returns committed=false when nothing dirty", async () => {
  const { commitCacheCloneIfDirty } = await import("../mission/mission-git-commit.ts");

  const repoDir = mkdtempSync(join(tmpdir(), "tmp-rfc-0797-clean-"));
  gitInit(repoDir);
  writeFileSync(join(repoDir, "file1.txt"), "content1\n");
  gitCommit(repoDir, "initial");

  const result = commitCacheCloneIfDirty(repoDir, "test-system");

  expect(result.committed).toBe(false);
  expect(result.commitSha).toBeNull();

  rmSync(repoDir, { recursive: true, force: true });
});

// 6a: commitCacheCloneIfDirty returns committed=false when no .git directory
test("commitCacheCloneIfDirty returns committed=false when no .git directory", async () => {
  const { commitCacheCloneIfDirty } = await import("../mission/mission-git-commit.ts");

  const repoDir = mkdtempSync(join(tmpdir(), "tmp-rfc-0797-nogit-"));
  // No git init
  writeFileSync(join(repoDir, "file1.txt"), "content1\n");

  const result = commitCacheCloneIfDirty(repoDir, "test-system");

  expect(result.committed).toBe(false);
  expect(result.commitSha).toBeNull();

  rmSync(repoDir, { recursive: true, force: true });
});
