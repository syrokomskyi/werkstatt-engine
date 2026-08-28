// @vitest-environment node
/*
<MODULE_CONTRACT>
  <purpose>RFC-0973: Unit tests for --force cache clearance in mission.validate.</purpose>
  <keywords>RFC-0973, mission.validate, force, cache-clear, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0973: initial unit tests for --force auto-clears all caches and stale artifacts.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const hoisted = vi.hoisted(() => ({
  mockCacheClear: vi.fn(),
  mockCacheClose: vi.fn(),
  mockClearPipelineCacheHits: vi.fn(),
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
    clear: hoisted.mockCacheClear,
    close: hoisted.mockCacheClose,
    status: vi.fn().mockResolvedValue({ entries: 0 }),
  }),
}));

vi.mock("../../kernel/runtime/execute-pipeline.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../kernel/runtime/execute-pipeline.ts")>();
  return {
    ...original,
    clearPipelineCacheHits: hoisted.mockClearPipelineCacheHits,
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-rfc0973-"));
  const missionDir = path.join(tmpDir, "missions", "test-mission");
  const evidenceDir = path.join(missionDir, "evidence");
  const workpieceDir = path.join(missionDir, "workpiece");
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.mkdir(workpieceDir, { recursive: true });

  hoisted.mockCacheClear.mockReset();
  hoisted.mockCacheClose.mockReset();
  hoisted.mockClearPipelineCacheHits.mockReset();
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
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("RFC-0973: --force clears kernel cache, pipeline cache hits, journal, and validation report", async () => {
  const missionDir = path.join(tmpDir, "missions", "test-mission");
  const evidenceDir = path.join(missionDir, "evidence");
  // Pre-create stale artifacts
  await fs.writeFile(path.join(missionDir, "journal.jsonl"), "stale journal\n");
  await fs.writeFile(path.join(evidenceDir, "validation-report.json"), '{"stale":true}');

  await runMissionValidate(
    { argv: [], flags: { mission: "test-mission", force: true } } as any,
    makeContext(tmpDir),
  );

  expect(
    hoisted.mockCacheClear,
    "kernel cache.clear() must be called on --force",
  ).toHaveBeenCalledTimes(1);
  expect(hoisted.mockCacheClose, "cache.close() must be called after clear").toHaveBeenCalledTimes(
    1,
  );
  expect(
    hoisted.mockClearPipelineCacheHits,
    "clearPipelineCacheHits must be called on --force",
  ).toHaveBeenCalledTimes(1);
  expect(
    existsSync(path.join(missionDir, "journal.jsonl")),
    "journal.jsonl must be deleted on --force",
  ).toBe(false);
  expect(
    existsSync(path.join(evidenceDir, "validation-report.json")),
    "validation-report.json must be deleted on --force",
  ).toBe(false);
});

test("RFC-0973: without --force, no caches or artifacts are cleared", async () => {
  const missionDir = path.join(tmpDir, "missions", "test-mission");
  const evidenceDir = path.join(missionDir, "evidence");
  await fs.writeFile(path.join(missionDir, "journal.jsonl"), "stale journal\n");
  await fs.writeFile(path.join(evidenceDir, "validation-report.json"), '{"stale":true}');

  // Without force, distribution reuse path may trigger — mock computeBuildInputHash to not match
  hoisted.mockComputeBuildInputHash.mockResolvedValue({ buildInputHash: "sha256:mismatch" });

  await runMissionValidate(
    { argv: [], flags: { mission: "test-mission" } } as any,
    makeContext(tmpDir),
  );

  expect(
    hoisted.mockCacheClear,
    "cache.clear() must NOT be called without --force",
  ).not.toHaveBeenCalled();
  expect(
    hoisted.mockClearPipelineCacheHits,
    "clearPipelineCacheHits must NOT be called without --force",
  ).not.toHaveBeenCalled();
  // journal.jsonl may be modified by runOperation, but it should not be deleted before runOperation
  // The key assertion is that cache clear functions were not called
});

test("RFC-0973: missing journal and validation report do not cause errors on --force", async () => {
  // No journal.jsonl or validation-report.json pre-created
  await runMissionValidate(
    { argv: [], flags: { mission: "test-mission", force: true } } as any,
    makeContext(tmpDir),
  );

  expect(
    hoisted.mockCacheClear,
    "cache.clear() must be called even without stale files",
  ).toHaveBeenCalledTimes(1);
  expect(
    hoisted.mockClearPipelineCacheHits,
    "clearPipelineCacheHits must be called even without stale files",
  ).toHaveBeenCalledTimes(1);
  // No throw — idempotent deletion via .catch(() => {})
});

test("RFC-0973: force:true is passed to executeKernelPipeline calls when --force is set", async () => {
  await runMissionValidate(
    { argv: [], flags: { mission: "test-mission", force: true } } as any,
    makeContext(tmpDir),
  );

  // runOperation calls buildValidateSteps which calls executeKernelPipeline
  // The mock for runOperation returns { completed: true } without calling steps,
  // so we verify via the runOperation call that steps were built with force in ctx.
  expect(hoisted.mockRunOperation, "runOperation must be called").toHaveBeenCalledTimes(1);
  const opArg = hoisted.mockRunOperation.mock.calls[0][1];
  expect(opArg.op, "operation name must be mission.validate").toBe("mission.validate");
  // The steps array and validateCtx are passed — verify ctx has force=true
  const validateCtx = hoisted.mockRunOperation.mock.calls[0][2];
  expect(validateCtx.force, "validateCtx.force must be true when --force is set").toBe(true);
});
