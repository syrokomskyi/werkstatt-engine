// @vitest-environment node
/*
<MODULE_CONTRACT>
  <purpose>RFC-1020: Unit tests for stale validation-report.json deletion at the start of runMissionValidate on non-force runs.</purpose>
  <keywords>RFC-1020, mission.validate, stale-report, validation-report, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1020: initial unit tests for stale validation-report.json deletion on non-force runs.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const hoisted = vi.hoisted(() => ({
  mockExecuteKernelPipeline: vi.fn(),
  mockExecuteKernelCommand: vi.fn(),
  mockReadMissionManifest: vi.fn(),
  mockResolveMissionDir: vi.fn(),
  mockRunOperation: vi.fn(),
  mockCheckDifferentKindOperation: vi.fn(),
  mockCommitBordbuchProjections: vi.fn(),
  mockComputeBuildInputHash: vi.fn(),
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const original = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...original,
    executeKernelPipeline: hoisted.mockExecuteKernelPipeline,
    executeKernelCommand: hoisted.mockExecuteKernelCommand,
  };
});

vi.mock("../../kernel/cache/cache-layer.ts", () => ({
  createCacheLayer: vi.fn().mockResolvedValue({
    clear: vi.fn(),
    close: vi.fn(),
    status: vi.fn().mockResolvedValue({ entries: 0 }),
  }),
}));

vi.mock("../../kernel/runtime/execute-pipeline.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../kernel/runtime/execute-pipeline.ts")>();
  return {
    ...original,
    clearPipelineCacheHits: vi.fn(),
  };
});

vi.mock("../mission-io.ts", () => ({
  readMissionManifest: hoisted.mockReadMissionManifest,
  writeMissionManifest: vi.fn(),
  resolveMissionDir: hoisted.mockResolveMissionDir,
}));

vi.mock("../../journal/runner.ts", () => ({
  runOperation: hoisted.mockRunOperation,
}));

vi.mock("../../journal/index.ts", () => ({
  checkDifferentKindOperation: hoisted.mockCheckDifferentKindOperation,
}));

vi.mock("../../bordbuch/bordbuch-commit.ts", () => ({
  commitBordbuchProjections: hoisted.mockCommitBordbuchProjections,
}));

vi.mock("../../handoff/build-pipeline-helpers.ts", () => ({
  runPipelinePhase: vi.fn(),
  computeBuildInputHash: hoisted.mockComputeBuildInputHash,
  writePreliminaryBuildIdentity: vi.fn(),
  cleanupPreliminaryBuildIdentity: vi.fn(),
}));

vi.mock("../snapshot-auto-regen.ts", () => ({
  orchestrateSnap01Recovery: vi.fn(),
}));

vi.mock("../actor-identity.ts", () => ({
  resolveActor: vi.fn().mockReturnValue({ kind: "human", id: "test-operator" }),
}));

vi.mock("../../sternsystem/registry-io.ts", () => ({
  resolveCacheClonePath: vi.fn(),
  readSystemConfig: vi.fn(),
}));

vi.mock("../cache-clone-gitignore.ts", () => ({
  restoreCacheCloneGitignore: vi.fn(),
  untrackForbiddenGeneratedFiles: vi.fn(),
  CACHE_CLONE_GENERATED_PATTERNS: [],
}));

vi.mock("../workpiece-config-presence-check.ts", () => ({
  checkWorkpieceConfigPresence: vi.fn().mockResolvedValue({ allPresent: true, missing: [] }),
}));

import { runMissionValidate } from "../mission-materialization-commands.ts";

const baseManifest = {
  id: "test-mission",
  systemId: "test-system",
  state: "open",
  materializedAt: "2026-01-01T00:00:00Z",
  brief: "test",
  createdAt: "2026-01-01T00:00:00Z",
};

function makeContext(tmpDir: string) {
  return {
    workspaceRoot: tmpDir,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  } as any;
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-rfc1020-"));
  const missionDir = path.join(tmpDir, "missions", "test-mission");
  const evidenceDir = path.join(missionDir, "evidence");
  const workpieceDir = path.join(missionDir, "workpiece");
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.mkdir(workpieceDir, { recursive: true });

  hoisted.mockExecuteKernelPipeline.mockReset();
  hoisted.mockExecuteKernelCommand.mockReset();
  hoisted.mockReadMissionManifest.mockReset();
  hoisted.mockResolveMissionDir.mockReset();
  hoisted.mockRunOperation.mockReset();
  hoisted.mockCheckDifferentKindOperation.mockReset();
  hoisted.mockCommitBordbuchProjections.mockReset();
  hoisted.mockComputeBuildInputHash.mockReset();

  hoisted.mockReadMissionManifest.mockResolvedValue(baseManifest);
  hoisted.mockResolveMissionDir.mockReturnValue(missionDir);
  hoisted.mockCheckDifferentKindOperation.mockResolvedValue({ blocked: false });
  hoisted.mockCommitBordbuchProjections.mockResolvedValue({ committed: false, filesCommitted: [] });
  hoisted.mockRunOperation.mockResolvedValue({ completed: true });
  hoisted.mockExecuteKernelPipeline.mockResolvedValue({
    ok: true,
    steps: [],
    timing: { failedStep: null },
  });
  hoisted.mockComputeBuildInputHash.mockResolvedValue({ buildInputHash: "sha256:mismatch" });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("RFC-1020: stale validation-report.json is deleted at the start of runMissionValidate on non-force runs", async () => {
  const missionDir = path.join(tmpDir, "missions", "test-mission");
  const evidenceDir = path.join(missionDir, "evidence");
  await fs.writeFile(
    path.join(evidenceDir, "validation-report.json"),
    '{"passed":false,"stale":true}',
  );

  await runMissionValidate(
    { argv: [], flags: { mission: "test-mission" } } as any,
    makeContext(tmpDir),
  );

  expect(
    existsSync(path.join(evidenceDir, "validation-report.json")),
    "stale validation-report.json must be deleted before pipeline steps run on non-force runs",
  ).toBe(false);
});

test("RFC-1020: missing validation-report.json does not cause errors on non-force runs", async () => {
  // No validation-report.json pre-created
  await runMissionValidate(
    { argv: [], flags: { mission: "test-mission" } } as any,
    makeContext(tmpDir),
  );

  // No throw — idempotent deletion via .catch(() => {})
  expect(true, "runMissionValidate must not throw when validation-report.json does not exist").toBe(
    true,
  );
});
