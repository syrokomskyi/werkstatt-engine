/*
<MODULE_CONTRACT>
  <purpose>Test RFC-0952: defensive guards in mission.materialize for missing manifest and currentMission state.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0952: test Guard 1 (missing manifest error) and Guard 2 (currentMission auto-set).</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock registry-io
vi.mock("../sternsystem/registry-io.ts", () => ({
  readSystemConfig: vi.fn().mockResolvedValue({ status: "active" }),
  readSystemState: vi.fn(),
  writeSystemState: vi.fn(),
  resolveCacheClonePath: vi.fn(),
  resolveMirrors: vi.fn().mockReturnValue([]),
  resolveMirrorPath: vi.fn().mockReturnValue(null),
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
  readMissionManifest: vi.fn(),
  writeMissionManifest: vi.fn(),
  resolveMissionDir: vi.fn((workspaceRoot: string, missionId: string) =>
    path.join(workspaceRoot, "missions", missionId),
  ),
}));

// Mock bordbuch
vi.mock("../bordbuch/bordbuch-hook.ts", () => ({
  installBordbuchPreCommitHook: vi.fn().mockResolvedValue({ installed: false }),
}));

vi.mock("../bordbuch/bordbuch-commit-helper.ts", () => ({
  appendAndCommitBordbuch: vi.fn().mockResolvedValue({
    entry: { id: "event-000001", kind: "materialize" },
    commitResult: { commitSha: "abc123", pushed: true, error: null },
  }),
}));

vi.mock("../werkstatt/git-exec.ts", () => ({
  gitExec: vi.fn(),
}));

vi.mock("../handoff/bundle-io.ts", () => ({
  resolveCurrentEcosystem: vi.fn().mockResolvedValue({ version: "1.0.0" }),
  resolvePlatformSemanticHash: vi.fn().mockResolvedValue("sha256:fake"),
}));

import { runMissionMaterialize } from "./mission-materialize.ts";
import { readMissionManifest } from "./mission-io.ts";
import { readSystemState, writeSystemState } from "../sternsystem/registry-io.ts";
import { acquireLock, commitWerkstattSideEffects } from "../werkstatt/index.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

const mockReadMissionManifest = vi.mocked(readMissionManifest);
const mockReadSystemState = vi.mocked(readSystemState);
const mockWriteSystemState = vi.mocked(writeSystemState);
const mockAcquireLock = vi.mocked(acquireLock);
const mockCommitWerkstatt = vi.mocked(commitWerkstattSideEffects);

let testRoot: string;
let workspaceRoot: string;

const validManifest = {
  missionId: "test-system-m000001",
  systemId: "test-system",
  brief: "test brief",
  state: "open",
  operationId: "op-test-001",
  createdAt: "2026-08-26T00:00:00Z",
  updatedAt: "2026-08-26T00:00:00Z",
  closedAt: null,
};

function makeContext(root: string): KernelRuntimeContext {
  return {
    workspaceRoot: root,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    env: {},
    flags: {},
  } as any;
}

function makeInput(missionId: string): KernelCommandInput {
  return {
    args: [],
    flags: { mission: missionId },
  } as any;
}

beforeEach(() => {
  testRoot = mkdtempSync(path.join(os.tmpdir(), "mission-materialize-guards-test-"));
  workspaceRoot = path.join(testRoot, "workspace");
  mkdirSync(workspaceRoot, { recursive: true });
  vi.clearAllMocks();
  // Default: acquireLock throws to stop execution after guards but before runMissionMaterializeInternal
  mockAcquireLock.mockRejectedValue(new Error("STOP-TEST"));
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

test("Guard 1: throws actionable error with mission.open hint when mission.yaml does not exist", async () => {
  // No mission.yaml created — fs.access will fail
  const error = await runMissionMaterialize(
    makeInput("test-system-m000001"),
    makeContext(workspaceRoot),
  ).catch((e: Error) => e.message);

  expect(error).toContain("mission manifest not found");
  expect(error).toContain("mission.open");
  expect(error).toContain("--system test-system");
  expect(error).toContain("missions/test-system-m000001/mission.yaml");
  // readMissionManifest should NOT have been called (Guard 1 fires before it)
  expect(mockReadMissionManifest).not.toHaveBeenCalled();
  // writeSystemState should NOT have been called
  expect(mockWriteSystemState).not.toHaveBeenCalled();
});

test("Guard 2: auto-sets currentMission when null and commits state", async () => {
  // Create mission.yaml so Guard 1 passes
  const missionDir = path.join(workspaceRoot, "missions", "test-system-m000001");
  mkdirSync(missionDir, { recursive: true });
  writeFileSync(path.join(missionDir, "mission.yaml"), "test: true\n");

  mockReadMissionManifest.mockResolvedValue(validManifest as any);
  mockReadSystemState.mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-system",
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: null,
  } as any);

  await expect(
    runMissionMaterialize(makeInput("test-system-m000001"), makeContext(workspaceRoot)),
  ).rejects.toThrow("STOP-TEST"); // acquireLock throws after guards

  expect(mockReadSystemState).toHaveBeenCalledWith(workspaceRoot, "test-system");
  expect(mockWriteSystemState).toHaveBeenCalledWith(
    workspaceRoot,
    "test-system",
    expect.objectContaining({ currentMission: "test-system-m000001" }),
  );
  expect(mockCommitWerkstatt).toHaveBeenCalledWith(
    workspaceRoot,
    [path.join("..", "systems-cache", "test-system", "system-state.yaml")],
    expect.stringContaining("state-repair"),
  );
});

test("Guard 2: auto-sets currentMission when mismatched and commits state", async () => {
  const missionDir = path.join(workspaceRoot, "missions", "test-system-m000001");
  mkdirSync(missionDir, { recursive: true });
  writeFileSync(path.join(missionDir, "mission.yaml"), "test: true\n");

  mockReadMissionManifest.mockResolvedValue(validManifest as any);
  mockReadSystemState.mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-system",
    currentMission: "other-system-m000099",
    lastRelease: null,
    lastPropagated: {},
    accessPin: null,
  } as any);

  await expect(
    runMissionMaterialize(makeInput("test-system-m000001"), makeContext(workspaceRoot)),
  ).rejects.toThrow("STOP-TEST");

  expect(mockWriteSystemState).toHaveBeenCalledWith(
    workspaceRoot,
    "test-system",
    expect.objectContaining({ currentMission: "test-system-m000001" }),
  );
  expect(mockCommitWerkstatt).toHaveBeenCalled();
});

test("Guard 2: does not write state when currentMission already matches", async () => {
  const missionDir = path.join(workspaceRoot, "missions", "test-system-m000001");
  mkdirSync(missionDir, { recursive: true });
  writeFileSync(path.join(missionDir, "mission.yaml"), "test: true\n");

  mockReadMissionManifest.mockResolvedValue(validManifest as any);
  mockReadSystemState.mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId: "test-system",
    currentMission: "test-system-m000001",
    lastRelease: null,
    lastPropagated: {},
    accessPin: null,
  } as any);

  await expect(
    runMissionMaterialize(makeInput("test-system-m000001"), makeContext(workspaceRoot)),
  ).rejects.toThrow("STOP-TEST");

  expect(mockReadSystemState).toHaveBeenCalled();
  expect(mockWriteSystemState).not.toHaveBeenCalled();
  expect(mockCommitWerkstatt).not.toHaveBeenCalled();
});
