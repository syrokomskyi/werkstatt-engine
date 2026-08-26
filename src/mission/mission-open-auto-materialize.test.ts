/*
<MODULE_CONTRACT>
  <purpose>Test RFC-0951: mission.open auto-materializes the workpiece and rolls back on failure.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0951: test auto-materialization success and rollback on failure.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock bordbuch-commit-helper
vi.mock("../bordbuch/bordbuch-commit-helper.ts", () => ({
  appendAndCommitBordbuch: vi.fn().mockResolvedValue({
    entry: { id: "event-000001", kind: "mission-open" },
    commitResult: { commitSha: "abc123", pushed: true, error: null },
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

// Mock mission-materialize — runMissionMaterializeInternal
vi.mock("./mission-materialize.ts", () => ({
  runMissionMaterializeInternal: vi.fn(),
  runMissionMaterialize: vi.fn(),
}));

import { runMissionOpen } from "./mission-open.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import {
  readSystemConfig,
  readSystemState,
  discoverSystems,
  writeSystemState,
} from "../sternsystem/registry-io.ts";
import { runMissionMaterializeInternal } from "./mission-materialize.ts";
import { commitWerkstattSideEffects } from "../werkstatt/index.ts";

const mockAppendAndCommit = vi.mocked(appendAndCommitBordbuch);
const mockReadSystemConfig = vi.mocked(readSystemConfig);
const mockReadSystemState = vi.mocked(readSystemState);
const mockDiscoverSystems = vi.mocked(discoverSystems);
const mockMaterializeInternal = vi.mocked(runMissionMaterializeInternal);
const mockWriteSystemState = vi.mocked(writeSystemState);
const mockCommitWerkstatt = vi.mocked(commitWerkstattSideEffects);

let testRoot: string;
let workspaceRoot: string;
let cacheCloneDir: string;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mission-open-auto-mat-test-"));
  workspaceRoot = path.join(testRoot, "workspace");
  cacheCloneDir = path.join(testRoot, "systems-cache", "test-system");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(cacheCloneDir, { recursive: true });
  writeFileSync(path.join(cacheCloneDir, "system.pin.json"), '{"version":"1.0.0"}');
  vi.clearAllMocks();
  const { resolveCacheClonePath } = await import("../sternsystem/registry-io.ts");
  vi.mocked(resolveCacheClonePath).mockReturnValue(cacheCloneDir);
  mockReadSystemState.mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-system",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: null,
  } as never);
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
    commitResult: { commitSha: "abc123", pushed: true, error: null },
  });
  mockDiscoverSystems.mockResolvedValue({ systems: [], errors: [] } as never);
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

function makeContext() {
  return {
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
}

test("mission.open auto-materializes and returns materializedAt on success", async () => {
  const materializedAt = "2026-01-15T10:00:00.000Z";
  mockMaterializeInternal.mockResolvedValue({
    data: {
      missionId: "test-system-m000001",
      systemId: "test-system",
      versionComparison: {
        verdict: "in-sync",
        pinVersion: "1.0.0",
        platformVersion: "1.0.0",
        packagesDrift: false,
        message: "in sync",
      },
      migratorChain: [],
      capabilityDiff: { tier: "green", items: [] },
      regeneration: { regeneratedFiles: [], success: true },
      materializedAt,
      preflightSkipped: false,
      preflightSkipReason: null,
      pipelineUsed: "build.prepare.dev",
      mediaCacheWarmed: false,
      mediaCacheSources: 0,
      bordbuchHookInstalled: false,
      artifactCacheHit: false,
      artifactCacheKey: null,
      artifactCacheSkipped: false,
      workspaceGlobCheck: { stalePackages: [], ok: true },
    },
    summary: "[mission.materialize] test-system-m000001 materialized",
    nextSteps: [],
  } as never);

  const input = {
    commandName: "mission.open",
    flags: { system: "test-system", brief: "Test mission" },
  } as never;

  const result = await runMissionOpen(input, makeContext());

  expect(result.data?.materializedAt).toBe(materializedAt);
  expect(result.summary).toContain("materialized");
  expect(result.nextSteps?.[0]?.action).toContain("mission.validate");
  expect(result.nextSteps?.[0]?.kind).toBe("optional");
  expect(mockMaterializeInternal).toHaveBeenCalledOnce();
});

test("mission.open rolls back on materialization failure with compensating bordbuch entry", async () => {
  mockMaterializeInternal.mockRejectedValue(new Error("codegen failed: missing template") as never);

  // The rollback path calls appendAndCommitBordbuch again for mission-open-rolled-back
  mockAppendAndCommit.mockResolvedValue({
    entry: { id: "event-000002", kind: "mission-open-rolled-back" } as never,
    commitResult: { commitSha: "def456", pushed: true, error: null },
  } as never);

  const input = {
    commandName: "mission.open",
    flags: { system: "test-system", brief: "Test mission" },
  } as never;

  await expect(runMissionOpen(input, makeContext())).rejects.toThrow(
    /materialization failed — mission rolled back/,
  );

  // Mission directory should not exist
  const missionDir = path.join(workspaceRoot, "missions", "test-system-m000001");
  expect(existsSync(missionDir)).toBe(false);

  // Compensating bordbuch entry was appended
  expect(mockAppendAndCommit).toHaveBeenCalledTimes(2);
  const rollbackCall = mockAppendAndCommit.mock.calls[1];
  expect(rollbackCall?.[2]).toBe("mission-open-rolled-back");

  // State was cleared
  expect(mockWriteSystemState).toHaveBeenCalledWith(
    workspaceRoot,
    "test-system",
    expect.objectContaining({ currentMission: null }),
  );

  // Werkstatt commit was called for cleared state
  expect(mockCommitWerkstatt).toHaveBeenCalled();
});

test("mission.open rollback still throws even if compensating bordbuch entry fails", async () => {
  mockMaterializeInternal.mockRejectedValue(new Error("materialization crashed") as never);

  // First call (mission-open) succeeds, second call (rolled-back) fails
  mockAppendAndCommit
    .mockResolvedValueOnce({
      entry: { id: "event-000001", kind: "mission-open" } as never,
      commitResult: { commitSha: "abc123", pushed: true, error: null },
    })
    .mockRejectedValueOnce(new Error("bordbuch write failed") as never);

  const input = {
    commandName: "mission.open",
    flags: { system: "test-system", brief: "Test mission" },
  } as never;

  await expect(runMissionOpen(input, makeContext())).rejects.toThrow(
    /materialization failed — mission rolled back/,
  );

  // Mission directory should not exist despite bordbuch failure
  const missionDir = path.join(workspaceRoot, "missions", "test-system-m000001");
  expect(existsSync(missionDir)).toBe(false);
});
