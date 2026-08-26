/*
<MODULE_CONTRACT>
  <purpose>RFC-0796: unit tests for cleanupStaleMissionEntries pre-flight cleanup in mission.open.</purpose>
  <keywords>RFC-0796, mission.open, stale symlink, empty directory, cleanup</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0796: initial tests for stale entry cleanup in mission.open.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { tmpdir } from "node:os";

// Mock bordbuch validation to bypass pre-flight gate (we're testing stale entry cleanup, not bordbuch)
vi.mock("../bordbuch/bordbuch-io.ts", () => ({
  validateBordbuch: vi.fn(async () => ({ entries: 0, violations: [] })),
  readBordbuch: vi.fn(async () => []),
  deriveNextMissionNumberSafe: vi.fn(async () => 1),
  commitAndPushBordbuch: vi.fn(async () => ({
    commitSha: "abc123",
    pushed: true,
    error: null,
  })),
}));

vi.mock("../bordbuch/bordbuch-commit-helper.ts", () => ({
  appendAndCommitBordbuch: vi.fn(async () => ({
    entry: { id: "event-000001", kind: "mission-open" },
    commitResult: { commitSha: "abc123", pushed: true, error: null },
  })),
}));

// RFC-0951: mock runMissionMaterializeInternal so mission.open doesn't require a real system
vi.mock("../mission/mission-materialize.ts", () => ({
  runMissionMaterializeInternal: vi.fn(async () => ({
    data: { materializedAt: "2026-01-01T00:00:00.000Z" },
    summary: "materialized",
    nextSteps: [],
  })),
  runMissionMaterialize: vi.fn(),
}));

// Mock registry-io so mission.open reads config/state/pin from tmp dir
vi.mock("../sternsystem/registry-io.ts", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    resolveCacheClonePath: vi.fn((workspaceRoot: string, systemId: string) =>
      join(workspaceRoot, "systems", systemId),
    ),
    readSystemConfig: vi.fn(async () => ({
      schemaVersion: "1.0.0",
      id: "test-system",
      cosmicStar: "Vega",
      mirrors: [{ path: "./systems/test-system", storageType: "non-bare" }],
      pinnedPlatform: "1.0.0",
      status: "active",
      registeredAt: "2026-01-01T00:00:00Z",
      notes: "",
    })),
    readSystemState: vi.fn(async () => ({
      schemaVersion: "1.0.0",
      id: "test-system",
      currentMission: null,
      lastRelease: null,
    })),
  };
});

function gitInit(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
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

let tmpWorkspace: string;

beforeEach(() => {
  tmpWorkspace = mkdtempSync(join(tmpdir(), "tmp-stale-cleanup-open-"));
});

afterEach(() => {
  rmSync(tmpWorkspace, { recursive: true, force: true });
});

function setupWorkspace(): void {
  gitInit(tmpWorkspace);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommit(tmpWorkspace, "initial");

  mkdirSync(join(tmpWorkspace, "systems"), { recursive: true });
  const registryContent = `schemaVersion: "1.0.0"
systems:
  - id: test-system
    cosmicStar: Vega
    mirrors:
      - path: "./systems/test-system"
        storageType: non-bare
    pinnedPlatform: "4.5.0"
    currentMission: null
    lastRelease: null
    status: active
    registeredAt: "2026-01-01T00:00:00Z"
    notes: ""
`;
  writeFileSync(join(tmpWorkspace, "systems", "registry.yaml"), registryContent);
  gitCommit(tmpWorkspace, "add registry");

  mkdirSync(join(tmpWorkspace, "systems", "test-system"), { recursive: true });
  writeFileSync(
    join(tmpWorkspace, "systems", "test-system", "system.pin.json"),
    JSON.stringify({ platform: { version: "1.0.0" } }, null, 2) + "\n",
  );

  mkdirSync(join(tmpWorkspace, "systems", "test-system", "bordbuch"), { recursive: true });
  gitCommit(tmpWorkspace, "add system");

  setupBareOrigin(tmpWorkspace);
}

function makeInput(): KernelCommandInput {
  return {
    flags: { system: "test-system", brief: "Test mission", actor: "test-agent" },
  } as unknown as KernelCommandInput;
}

function makeContext(): KernelRuntimeContext {
  return {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;
}

test("RFC-0796: stale symlink in missions/ root is trashed before opening", async () => {
  setupWorkspace();

  // Create a stale symlink in missions/ root
  const missionsDir = join(tmpWorkspace, "missions");
  mkdirSync(missionsDir, { recursive: true });
  const targetDir = join(missionsDir, "some-archived-mission");
  mkdirSync(targetDir, { recursive: true });
  symlinkSync(targetDir, join(missionsDir, "stale-symlink"));

  const { runMissionOpen } = await import("../mission/mission-open.ts");

  const result = await runMissionOpen(makeInput(), makeContext());

  expect(result.data?.state).toBe("open");
  expect(result.data?.staleEntries.removedPaths).toContain("missions/stale-symlink");
  expect(existsSync(join(missionsDir, "stale-symlink"))).toBe(false);
});

test("RFC-0796: empty directory in missions/ root is trashed before opening", async () => {
  setupWorkspace();

  const missionsDir = join(tmpWorkspace, "missions");
  mkdirSync(missionsDir, { recursive: true });
  mkdirSync(join(missionsDir, "empty-dir"));

  const { runMissionOpen } = await import("../mission/mission-open.ts");

  const result = await runMissionOpen(makeInput(), makeContext());

  expect(result.data?.staleEntries.removedPaths).toContain("missions/empty-dir");
  expect(existsSync(join(missionsDir, "empty-dir"))).toBe(false);
});

test("RFC-0796: non-empty real directory in missions/ root is skipped, NOT deleted", async () => {
  setupWorkspace();

  const missionsDir = join(tmpWorkspace, "missions");
  mkdirSync(missionsDir, { recursive: true });
  const nonEmptyDir = join(missionsDir, "non-empty-dir");
  mkdirSync(nonEmptyDir, { recursive: true });
  writeFileSync(join(nonEmptyDir, "some-file.txt"), "important content\n");

  const { runMissionOpen } = await import("../mission/mission-open.ts");

  const result = await runMissionOpen(makeInput(), makeContext());

  expect(result.data?.staleEntries.skipped).toContain("missions/non-empty-dir");
  expect(result.data?.staleEntries.removedPaths).not.toContain("missions/non-empty-dir");
  // Directory should still exist with its content
  expect(existsSync(nonEmptyDir)).toBe(true);
  expect(existsSync(join(nonEmptyDir, "some-file.txt"))).toBe(true);
});

test("RFC-0796: no stale entries — removedPaths and skipped are empty", async () => {
  setupWorkspace();

  // missions/ directory doesn't exist yet — clean state
  const { runMissionOpen } = await import("../mission/mission-open.ts");

  const result = await runMissionOpen(makeInput(), makeContext());

  expect(result.data?.state).toBe("open");
  expect(result.data?.staleEntries.removedPaths).toHaveLength(0);
  expect(result.data?.staleEntries.skipped).toHaveLength(0);
});
