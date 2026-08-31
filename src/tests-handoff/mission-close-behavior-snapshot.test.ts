// @vitest-environment node
/*
<MODULE_CONTRACT>
  <purpose>RFC-0991: unit tests for behavior-snapshot-refresh step in mission.close.</purpose>
  <keywords>RFC-0991, mission.close, behavior-snapshot-refresh, behavior.snapshot.generate, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0991: initial tests for behavior-snapshot-refresh step — calls generate with siteName, skip flag, non-fatal failure.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockState = vi.hoisted(() => ({
  executeKernelCommandCalls: [] as Array<Record<string, unknown>>,
  executeKernelCommandShouldThrow: false,
  commitWorkpieceIfDirtyCalls: [] as Array<{ workpieceDir: string; missionId: string; message?: string }>,
  commitWorkpieceIfDirtyResult: { committed: false, commitSha: null as string | null },
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", () => ({
  executeKernelCommand: vi.fn(async (opts: Record<string, unknown>) => {
    mockState.executeKernelCommandCalls.push(opts);
    if (mockState.executeKernelCommandShouldThrow) {
      throw new Error("mock executeKernelCommand failure");
    }
    return { data: { command: "behavior.snapshot.generate", routeCount: 5, written: true }, exitCode: 0, ok: true };
  }),
}));

vi.mock("../mission/mission-git-commit.ts", () => ({
  commitWorkpieceIfDirty: vi.fn(
    (workpieceDir: string, missionId: string, message?: string) => {
      mockState.commitWorkpieceIfDirtyCalls.push({ workpieceDir, missionId, message });
      return mockState.commitWorkpieceIfDirtyResult;
    },
  ),
  countOperatorCommits: vi.fn(() => ({ hasOperatorCommits: true })),
  cacheCloneCommit: vi.fn(),
}));

function makeCtx(overrides: Record<string, unknown> = {}) {
  const workpieceDir = mkdtempSync(join(tmpdir(), "mission-close-snapshot-test-"));
  return {
    workspaceRoot: "/tmp/workspace",
    missionId: "test-mission",
    missionDir: "/tmp/workspace/missions/test-mission",
    workpieceDir,
    evidenceDir: "/tmp/workspace/missions/test-mission/evidence",
    manifest: { systemId: "test-system", migratedAt: "2026-08-31", brief: "test" },
    actor: { kind: "human", id: "test-actor" },
    releaseId: null,
    now: "2026-08-31T00:00:00Z",
    skipEvidenceSync: false,
    skipAutoSync: false,
    skipReconcileCheck: false,
    allowNoOp: false,
    skipContentRegression: false,
    skipBehaviorSnapshot: false,
    context: { logger: { info: () => {}, warn: () => {} } },
    templateSyncResult: { synced: false, syncError: null },
    closeReport: null,
    evidenceSynced: false,
    evidenceSyncResult: null,
    freshnessChecked: false,
    unreconciledCommits: 0,
    workpieceHead: null,
    reconciledSha: null,
    originSha: null,
    mirrorSha: null,
    mirrorInSync: false,
    recommendation: null,
    ...overrides,
  } as any;
}

async function getBehaviorSnapshotRefreshStep() {
  const { buildCloseSteps } = await import("../mission/mission-close.ts");
  const steps = await buildCloseSteps("/tmp/workspace", "test-mission", makeCtx());
  return steps.find((s) => s.name === "behavior-snapshot-refresh");
}

test("behavior-snapshot-refresh calls behavior.snapshot.generate with siteName", async () => {
  mockState.executeKernelCommandCalls = [];
  mockState.commitWorkpieceIfDirtyCalls = [];
  mockState.executeKernelCommandShouldThrow = false;

  const step = await getBehaviorSnapshotRefreshStep();
  expect(step, "behavior-snapshot-refresh step must exist in buildCloseSteps").toBeDefined();

  await step!.run!(makeCtx());

  expect(mockState.executeKernelCommandCalls).toHaveLength(1);
  expect(mockState.executeKernelCommandCalls[0]).toMatchObject({
    commandName: "behavior.snapshot.generate",
    siteName: "test-system",
  });
  expect(mockState.commitWorkpieceIfDirtyCalls).toHaveLength(1);
  expect(mockState.commitWorkpieceIfDirtyCalls[0]).toMatchObject({
    missionId: "test-mission",
    message: "behavior-snapshot-refresh",
  });
});

test("behavior-snapshot-refresh skips when skipBehaviorSnapshot is true", async () => {
  mockState.executeKernelCommandCalls = [];
  mockState.commitWorkpieceIfDirtyCalls = [];

  const step = await getBehaviorSnapshotRefreshStep();
  await step!.run!(makeCtx({ skipBehaviorSnapshot: true }));

  expect(mockState.executeKernelCommandCalls, "executeKernelCommand must not be called when skipped").toHaveLength(0);
  expect(mockState.commitWorkpieceIfDirtyCalls, "commitWorkpieceIfDirty must not be called when skipped").toHaveLength(0);
});

test("behavior-snapshot-refresh is non-fatal on executeKernelCommand failure", async () => {
  mockState.executeKernelCommandCalls = [];
  mockState.commitWorkpieceIfDirtyCalls = [];
  mockState.executeKernelCommandShouldThrow = true;

  const step = await getBehaviorSnapshotRefreshStep();

  await expect(
    step!.run!(makeCtx()),
    "step must not throw when executeKernelCommand fails — it should log a non-fatal warning",
  ).resolves.toBeUndefined();

  expect(mockState.executeKernelCommandCalls).toHaveLength(1);
  expect(mockState.commitWorkpieceIfDirtyCalls, "commitWorkpieceIfDirty must not be called when generate fails").toHaveLength(0);

  mockState.executeKernelCommandShouldThrow = false;
});
