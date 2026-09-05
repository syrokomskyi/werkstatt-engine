/*
<MODULE_CONTRACT>
  <purpose>RFC-1033: Test workpiece preservation on mission.open rollback.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1033: initial tests for workpiece-failed preservation.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("../bordbuch/bordbuch-commit-helper.ts", () => ({
  appendAndCommitBordbuch: vi.fn().mockResolvedValue({
    entry: { id: "event-000001", kind: "mission-open" },
    commitResult: { commitSha: "abc123", pushed: true, error: null },
  }),
}));

vi.mock("../bordbuch/bordbuch-io.ts", () => ({
  readBordbuch: vi.fn().mockResolvedValue([]),
  deriveNextMissionNumberSafe: vi.fn().mockReturnValue(1),
  validateBordbuch: vi.fn().mockResolvedValue({ entries: 0, violations: [] }),
  appendBordbuchEntry: vi.fn(),
  commitAndPushBordbuch: vi.fn(),
  computeEntryHash: vi.fn().mockReturnValue("sha256:fake"),
}));

vi.mock("../sternsystem/registry-io.ts", () => ({
  readSystemConfig: vi.fn(),
  readSystemState: vi.fn(),
  writeSystemState: vi.fn(),
  resolveCacheClonePath: vi.fn(),
  discoverSystems: vi.fn(),
}));

vi.mock("../werkstatt/git-exec.ts", () => ({
  gitExec: vi.fn(),
}));

vi.mock("../werkstatt/index.ts", () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  generateOperationId: vi.fn().mockReturnValue("op-test"),
  commitWerkstattSideEffects: vi.fn(),
}));

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

vi.mock("./actor-identity.ts", () => ({
  resolveActor: vi.fn().mockReturnValue("test-agent"),
}));

vi.mock("./mission-materialize.ts", () => ({
  runMissionMaterializeInternal: vi.fn(),
  runMissionMaterialize: vi.fn(),
}));

import { runMissionOpen } from "./mission-open.ts";
import { runMissionMaterializeInternal } from "./mission-materialize.ts";
import {
  readSystemConfig,
  readSystemState,
  resolveCacheClonePath,
  discoverSystems,
} from "../sternsystem/registry-io.ts";

const mockMaterializeInternal = vi.mocked(runMissionMaterializeInternal);
const mockReadSystemConfig = vi.mocked(readSystemConfig);
const mockReadSystemState = vi.mocked(readSystemState);
const mockResolveCacheClonePath = vi.mocked(resolveCacheClonePath);
const mockDiscoverSystems = vi.mocked(discoverSystems);

let workspaceRoot: string;
let testRoot: string;
let cacheCloneDir: string;

function makeContext() {
  return {
    workspaceRoot,
    logger: {
      section() {},
      info() {},
      warn() {},
      error() {},
      success() {},
    },
  } as never;
}

beforeEach(() => {
  testRoot = mkdtempSync(path.join(os.tmpdir(), "mission-rollback-XXXX-"));
  workspaceRoot = path.join(testRoot, "workspace");
  cacheCloneDir = path.join(testRoot, "systems-cache", "test-system");
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(cacheCloneDir, { recursive: true });
  writeFileSync(path.join(cacheCloneDir, "system.pin.json"), '{"version":"1.0.0"}');
  vi.clearAllMocks();
  mockResolveCacheClonePath.mockReturnValue(cacheCloneDir);
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
  mockReadSystemState.mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-system",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: null,
  } as never);
  mockDiscoverSystems.mockResolvedValue({ systems: [], errors: [] } as never);
  mockMaterializeInternal.mockRejectedValue(new Error("materialization crashed") as never);
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

test("RFC-1033: failed workpiece preserved at workpiece-failed/ with failure-report.json", async () => {
  const input = {
    commandName: "mission.open",
    flags: { system: "test-system", brief: "Test mission" },
  } as never;

  await expect(runMissionOpen(input, makeContext())).rejects.toThrow(
    /materialization failed — mission rolled back/,
  );

  const missionDir = path.join(workspaceRoot, "missions", "test-system-m000001");

  expect(existsSync(path.join(missionDir, "workpiece-failed"))).toBe(true);
  expect(existsSync(path.join(missionDir, "failure-report.json"))).toBe(true);
  expect(existsSync(path.join(missionDir, "workpiece"))).toBe(false);

  const report = JSON.parse(readFileSync(path.join(missionDir, "failure-report.json"), "utf-8"));
  expect(report.missionId).toBe("test-system-m000001");
  expect(report.systemId).toBe("test-system");
  expect(report.failedStep).toBe("auto-materialize");
  expect(report.error).toContain("materialization crashed");
  expect(report.rolledBackAt).toBeTruthy();
  expect(report.preservedAt).toContain("workpiece-failed");
});

test("RFC-1033: prior workpiece-failed/ is replaced on new failure", async () => {
  const missionDir = path.join(workspaceRoot, "missions", "test-system-m000001");
  mkdirSync(path.join(missionDir, "workpiece-failed", "old-content"), { recursive: true });
  writeFileSync(path.join(missionDir, "workpiece-failed", "old-content", "stale.txt"), "old");

  const input = {
    commandName: "mission.open",
    flags: { system: "test-system", brief: "Test mission" },
  } as never;

  await expect(runMissionOpen(input, makeContext())).rejects.toThrow(
    /materialization failed — mission rolled back/,
  );

  expect(existsSync(path.join(missionDir, "workpiece-failed"))).toBe(true);
  expect(existsSync(path.join(missionDir, "workpiece-failed", "old-content", "stale.txt"))).toBe(
    false,
  );
  expect(existsSync(path.join(missionDir, "failure-report.json"))).toBe(true);
});
