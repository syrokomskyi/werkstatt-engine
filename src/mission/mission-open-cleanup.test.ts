/*
<MODULE_CONTRACT>
  <purpose>Test that mission.open cleans up mission directories on bordbuch push failure.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Bug fix: mission.open cleans up stale mission dir on bordbuch push failure.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock bordbuch-commit-helper to simulate push failure
vi.mock("../bordbuch/bordbuch-commit-helper.ts", () => ({
  appendAndCommitBordbuch: vi.fn().mockResolvedValue({
    entry: { id: "event-000001", kind: "mission-open" },
    commitResult: { commitSha: "abc123", pushed: false, error: "git pull --rebase failed" },
  }),
}));

// Mock bordbuch-io
vi.mock("../bordbuch/bordbuch-io.ts", () => ({
  readBordbuch: vi.fn().mockResolvedValue([]),
  deriveNextMissionNumberSafe: vi.fn().mockReturnValue(1),
  validateBordbuch: vi.fn().mockResolvedValue({ entries: 0, violations: [] }),
  appendBordbuchEntry: vi.fn(),
  commitAndPushBordbuch: vi.fn(),
  computeEntryHash: vi.fn().mockReturnValue("sha256:fake"),
}));

// Mock registry-io
vi.mock("../sternsystem/registry-io.ts", () => ({
  readSystemConfig: vi.fn(),
  readSystemState: vi.fn().mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-system",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: null,
  }),
  writeSystemState: vi.fn(),
  resolveCacheClonePath: vi.fn(),
  discoverSystems: vi.fn(),
}));

// Mock git-exec
vi.mock("../werkstatt/git-exec.ts", () => ({
  gitExec: vi.fn(),
}));

// Mock werkstatt index
vi.mock("../werkstatt/index.ts", () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  generateOperationId: vi.fn().mockReturnValue("op-test"),
  commitWerkstattSideEffects: vi.fn(),
}));

// Mock mission-io
vi.mock("./mission-io.ts", () => ({
  createMissionDirectories: vi.fn(async (workspaceRoot: string, missionId: string) => {
    const dir = path.join(workspaceRoot, "missions", missionId);
    mkdirSync(path.join(dir, "workpiece"), { recursive: true });
    mkdirSync(path.join(dir, "evidence"), { recursive: true });
  }),
  writeMissionManifest: vi.fn(async (workspaceRoot: string, manifest: { missionId: string }) => {
    const filePath = path.join(workspaceRoot, "missions", manifest.missionId, "mission.yaml");
    writeFileSync(filePath, "test: true\n");
  }),
  missionExists: vi.fn().mockReturnValue(false),
}));

// Mock actor-identity
vi.mock("./actor-identity.ts", () => ({
  resolveActor: vi.fn().mockReturnValue("test-agent"),
}));

import { runMissionOpen } from "./mission-open.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import { readSystemConfig, discoverSystems } from "../sternsystem/registry-io.ts";

const mockAppendAndCommit = vi.mocked(appendAndCommitBordbuch);
const mockReadSystemConfig = vi.mocked(readSystemConfig);
const mockDiscoverSystems = vi.mocked(discoverSystems);

let testRoot: string;
let workspaceRoot: string;
let cacheCloneDir: string;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mission-open-cleanup-test-"));
  workspaceRoot = path.join(testRoot, "workspace");
  cacheCloneDir = path.join(testRoot, "systems-cache", "test-system");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(cacheCloneDir, { recursive: true });
  // Create pin file so the pin check passes
  writeFileSync(path.join(cacheCloneDir, "system.pin.json"), '{"version":"1.0.0"}');
  vi.clearAllMocks();
  // Re-setup resolveCacheClonePath to return real dir
  const { resolveCacheClonePath } = await import("../sternsystem/registry-io.ts");
  vi.mocked(resolveCacheClonePath).mockReturnValue(cacheCloneDir);
  mockReadSystemConfig.mockResolvedValue({
    schemaVersion: "1.0.0",
    id: "test-system",
    cosmicStar: "Vega",
    mirrors: [{ path: "../systems-cache/test-system", storageType: "non-bare" }],
    pinnedPlatform: "1.0.0",
    status: "active",
    registeredAt: "2026-01-01T00:00:00.000Z",
    deployment: { adapter: "cloudflare-workers", channels: {} },
  } as never);
  mockAppendAndCommit.mockResolvedValue({
    entry: { id: "event-000001", kind: "mission-open" } as never,
    commitResult: { commitSha: "abc123", pushed: false, error: "git pull --rebase failed" },
  });
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

test("cleans up mission directory when bordbuch push fails", async () => {
  const input = {
    commandName: "mission.open",
    flags: { system: "test-system", brief: "Test mission" },
  } as never;

  const context = {
    workspaceRoot,
    logger: {
      info: () => {},
      success: () => {},
      error: () => {},
      warn: () => {},
      event: () => {},
      getEvents: () => [],
    },
  } as never;

  await expect(runMissionOpen(input, context)).rejects.toThrow(/bordbuch push failed/);

  // Mission directory should not exist after cleanup
  const missionDir = path.join(workspaceRoot, "missions", "test-system-m000001");
  expect(existsSync(missionDir)).toBe(false);
});

test("cleans up mission directory when bordbuch commit fails", async () => {
  mockAppendAndCommit.mockResolvedValue({
    entry: { id: "event-000001", kind: "mission-open" } as never,
    commitResult: { commitSha: null, pushed: false, error: null },
  });

  const input = {
    commandName: "mission.open",
    flags: { system: "test-system", brief: "Test mission" },
  } as never;

  const context = {
    workspaceRoot,
    logger: {
      info: () => {},
      success: () => {},
      error: () => {},
      warn: () => {},
      event: () => {},
      getEvents: () => [],
    },
  } as never;

  await expect(runMissionOpen(input, context)).rejects.toThrow(/bordbuch commit failed/);

  // Mission directory should not exist after cleanup
  const missionDir = path.join(workspaceRoot, "missions", "test-system-m000001");
  expect(existsSync(missionDir)).toBe(false);
});

test("lists available systems when --system is not found", async () => {
  mockReadSystemConfig.mockRejectedValue(new Error("ENOENT") as never);
  mockDiscoverSystems.mockResolvedValue({
    systems: [{ id: "warpgogol" } as never, { id: "other-system" } as never],
    errors: [],
  });

  const input = {
    commandName: "mission.open",
    flags: { system: "nonexistent", brief: "Test mission" },
  } as never;

  const context = {
    workspaceRoot,
    logger: {
      info: () => {},
      success: () => {},
      error: () => {},
      warn: () => {},
      event: () => {},
      getEvents: () => [],
    },
  } as never;

  await expect(runMissionOpen(input, context)).rejects.toThrow(
    /system 'nonexistent' not found. Available systems: warpgogol, other-system/,
  );
});

test("succeeds end-to-end when all preconditions are met", async () => {
  mockAppendAndCommit.mockResolvedValue({
    entry: { id: "event-000001", kind: "mission-open" } as never,
    commitResult: { commitSha: "abc123", pushed: true, error: null },
  });

  const input = {
    commandName: "mission.open",
    flags: { system: "test-system", brief: "Test mission" },
  } as never;

  const context = {
    workspaceRoot,
    logger: {
      info: () => {},
      success: () => {},
      error: () => {},
      warn: () => {},
      event: () => {},
      getEvents: () => [],
    },
  } as never;

  const result = await runMissionOpen(input, context);

  expect(result.data!.state).toBe("open");
  expect(result.data!.systemId).toBe("test-system");
  expect(result.data!.brief).toBe("Test mission");
  expect(result.summary).toContain("opened mission");

  // Mission directory should exist
  const missionDir = path.join(workspaceRoot, "missions", "test-system-m000001");
  expect(existsSync(missionDir)).toBe(true);
});
