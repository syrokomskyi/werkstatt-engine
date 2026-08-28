// @vitest-environment node
/*
<MODULE_CONTRACT>
  <purpose>RFC-0976: Unit tests for auto-commit of generated artifacts after successful validation.</purpose>
  <keywords>RFC-0976, mission.validate, auto-commit, skip-auto-commit, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0976: initial unit tests for auto-commit on full-build and distribution-reuse paths.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
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
  mockIsWorkpieceDirty: vi.fn(),
  mockCommitWorkpieceIfDirty: vi.fn(),
  mockCommitCacheCloneIfDirty: vi.fn(),
  mockResolveCacheClonePath: vi.fn(),
  mockCleanupBordbuchOnFailure: vi.fn(),
  mockValidateNoStaleMissionEntries: vi.fn(),
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const original = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...original,
    executeKernelPipeline: hoisted.mockExecuteKernelPipeline,
    executeKernelCommand: hoisted.mockExecuteKernelCommand,
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
  resolveCacheClonePath: hoisted.mockResolveCacheClonePath,
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

vi.mock("../mission-git-commit.ts", () => ({
  isWorkpieceDirty: hoisted.mockIsWorkpieceDirty,
  investigateUntrackedFiles: vi.fn(),
  commitWorkpieceIfDirty: hoisted.mockCommitWorkpieceIfDirty,
  commitCacheCloneIfDirty: hoisted.mockCommitCacheCloneIfDirty,
  cacheCloneCommit: vi.fn(),
}));

vi.mock("../bordbuch-cleanup.ts", () => ({
  cleanupBordbuchOnFailure: hoisted.mockCleanupBordbuchOnFailure,
}));

vi.mock("../stale-entries.ts", () => ({
  validateNoStaleMissionEntries: hoisted.mockValidateNoStaleMissionEntries,
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-rfc0976-"));
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
  hoisted.mockIsWorkpieceDirty.mockReset();
  hoisted.mockCommitWorkpieceIfDirty.mockReset();
  hoisted.mockCommitCacheCloneIfDirty.mockReset();
  hoisted.mockResolveCacheClonePath.mockReset();
  hoisted.mockCleanupBordbuchOnFailure.mockReset();
  hoisted.mockValidateNoStaleMissionEntries.mockReset();

  hoisted.mockReadMissionManifest.mockResolvedValue(baseManifest);
  hoisted.mockResolveMissionDir.mockReturnValue(missionDir);
  hoisted.mockCheckDifferentKindOperation.mockResolvedValue({ blocked: false });
  hoisted.mockCommitBordbuchProjections.mockResolvedValue({ committed: false, filesCommitted: [] });
  hoisted.mockComputeBuildInputHash.mockResolvedValue({ buildInputHash: "sha256:mismatch" });
  hoisted.mockResolveCacheClonePath.mockResolvedValue("/nonexistent/cache-clone");
  hoisted.mockCleanupBordbuchOnFailure.mockResolvedValue(undefined);
  hoisted.mockValidateNoStaleMissionEntries.mockReturnValue([]);
  hoisted.mockCommitCacheCloneIfDirty.mockReturnValue({ committed: false, commitSha: null });
  hoisted.mockIsWorkpieceDirty.mockReturnValue({ dirty: false, fileCount: 0, files: [] });
  hoisted.mockCommitWorkpieceIfDirty.mockReturnValue({
    committed: true,
    commitSha: "abc1234567",
  });

  // Default: runOperation simulates a successful validation
  hoisted.mockRunOperation.mockImplementation((_journalPath, _op, ctx) => {
    ctx.staticPassed = true;
    ctx.buildSucceeded = true;
    ctx.stepCount = 5;
    ctx.routeCount = 10;
    ctx.pipelineReport = { steps: [] };
    ctx.failedSteps = [];
    return { completed: true };
  });

  hoisted.mockExecuteKernelPipeline.mockResolvedValue({
    ok: true,
    steps: [],
    timing: { failedStep: null },
  });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("RFC-0976: successful validation with uncommitted files → auto-commit called", async () => {
  hoisted.mockIsWorkpieceDirty
    .mockReturnValueOnce({
      dirty: true,
      fileCount: 2,
      files: ["dist/index.html", "evidence/validation-report.json"],
    })
    .mockReturnValueOnce({ dirty: false, fileCount: 0, files: [] });

  const result = await runMissionValidate(
    { argv: [], flags: { mission: "test-mission" } } as any,
    makeContext(tmpDir),
  );

  expect(
    hoisted.mockCommitWorkpieceIfDirty,
    "commitWorkpieceIfDirty must be called when workpiece is dirty and validation passed",
  ).toHaveBeenCalledTimes(1);
  expect(
    hoisted.mockCommitWorkpieceIfDirty.mock.calls[0][2],
    "commit message must be the RFC-specified message",
  ).toBe("chore: post-validation artifacts (mission.validate)");
  expect(result.summary, "validation must pass").toContain("passed");
});

test("RFC-0976: successful validation with clean workpiece → no auto-commit", async () => {
  hoisted.mockIsWorkpieceDirty.mockReturnValue({ dirty: false, fileCount: 0, files: [] });

  const result = await runMissionValidate(
    { argv: [], flags: { mission: "test-mission" } } as any,
    makeContext(tmpDir),
  );

  expect(
    hoisted.mockCommitWorkpieceIfDirty,
    "commitWorkpieceIfDirty must NOT be called when workpiece is clean",
  ).not.toHaveBeenCalled();
  expect(result.summary, "validation must pass").toContain("passed");
});

test("RFC-0976: failed validation → no auto-commit", async () => {
  hoisted.mockRunOperation.mockImplementation((_journalPath, _op, ctx) => {
    ctx.staticPassed = false;
    ctx.buildSucceeded = false;
    ctx.stepCount = 5;
    ctx.routeCount = 0;
    ctx.pipelineReport = { steps: [{ commandName: "test.check", ok: false, exitCode: 1 }] };
    ctx.failedSteps = [{ name: "test.check", error: "failed" }];
    return { completed: true };
  });
  hoisted.mockIsWorkpieceDirty.mockReturnValue({ dirty: true, fileCount: 2, files: ["dist/"] });

  const result = await runMissionValidate(
    { argv: [], flags: { mission: "test-mission" } } as any,
    makeContext(tmpDir),
  );

  expect(
    hoisted.mockCommitWorkpieceIfDirty,
    "commitWorkpieceIfDirty must NOT be called on validation failure",
  ).not.toHaveBeenCalled();
  expect(result.exitCode, "validation must fail with exitCode 1").toBe(1);
});

test("RFC-0976: --skip-auto-commit → no auto-commit even on success", async () => {
  hoisted.mockIsWorkpieceDirty.mockReturnValue({ dirty: true, fileCount: 2, files: ["dist/"] });

  const result = await runMissionValidate(
    { argv: [], flags: { mission: "test-mission", "skip-auto-commit": true } } as any,
    makeContext(tmpDir),
  );

  expect(
    hoisted.mockCommitWorkpieceIfDirty,
    "commitWorkpieceIfDirty must NOT be called when --skip-auto-commit is set",
  ).not.toHaveBeenCalled();
  expect(result.summary, "validation must still pass").toContain("passed");
});

test("RFC-0976: distribution-reuse path with uncommitted files → auto-commit called", async () => {
  // Force distribution-reuse path: hash matches, dist exists
  hoisted.mockComputeBuildInputHash.mockResolvedValue({ buildInputHash: "sha256:matching" });
  const missionDir = path.join(tmpDir, "missions", "test-mission");
  const distributionDir = path.join(missionDir, "distribution");
  const distributionDistDir = path.join(distributionDir, "dist");
  await fs.mkdir(distributionDistDir, { recursive: true });
  await fs.writeFile(
    path.join(distributionDir, "build-input-hash.json"),
    JSON.stringify({ buildInputHash: "sha256:matching" }),
  );
  await fs.writeFile(path.join(distributionDistDir, "index.html"), "<html></html>");

  hoisted.mockIsWorkpieceDirty
    .mockReturnValueOnce({ dirty: true, fileCount: 1, files: ["dist/index.html"] })
    .mockReturnValueOnce({ dirty: false, fileCount: 0, files: [] });

  const result = await runMissionValidate(
    { argv: [], flags: { mission: "test-mission" } } as any,
    makeContext(tmpDir),
  );

  expect(
    hoisted.mockCommitWorkpieceIfDirty,
    "commitWorkpieceIfDirty must be called on distribution-reuse path when workpiece is dirty",
  ).toHaveBeenCalledTimes(1);
  expect(
    hoisted.mockCommitWorkpieceIfDirty.mock.calls[0][2],
    "commit message must be the RFC-specified message",
  ).toBe("chore: post-validation artifacts (mission.validate)");
  expect(result.summary, "validation must pass on reuse path").toContain("passed");
  expect(result.data, "distributionReused must be true").toHaveProperty("distributionReused", true);
});

test("RFC-0976: auto-commit failure → warning logged, validation still passes", async () => {
  hoisted.mockIsWorkpieceDirty.mockReturnValue({ dirty: true, fileCount: 2, files: ["dist/"] });
  hoisted.mockCommitWorkpieceIfDirty.mockImplementation(() => {
    throw new Error("git commit failed");
  });

  const result = await runMissionValidate(
    { argv: [], flags: { mission: "test-mission" } } as any,
    makeContext(tmpDir),
  );

  expect(
    hoisted.mockCommitWorkpieceIfDirty,
    "commitWorkpieceIfDirty must be called (and fail)",
  ).toHaveBeenCalledTimes(1);
  expect(result.summary, "validation must still pass despite auto-commit failure").toContain(
    "passed",
  );
  expect(result.exitCode ?? 0, "exitCode must not be 1 on auto-commit failure").toBe(0);
});
