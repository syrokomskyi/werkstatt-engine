/*
<MODULE_CONTRACT>
  <purpose>RFC-0958 Step 8: Kill-test matrix for mission.close — verifies runOperation resume completes after simulated crash at each step.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial kill-test matrix for mission.close.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("../mission-io.ts", () => ({
  readMissionManifest: vi.fn(),
  writeMissionManifest: vi.fn(),
  resolveMissionDir: vi.fn((workspaceRoot: string, missionId: string) =>
    path.join(workspaceRoot, "missions", missionId),
  ),
}));

vi.mock("../../werkstatt/index.ts", () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  isLockStale: vi.fn().mockReturnValue(false),
  removeStaleLock: vi.fn(),
  readAllLocks: vi.fn().mockResolvedValue([]),
  commitWerkstattSideEffects: vi.fn(),
}));

import { runOperation } from "../../journal/runner.ts";
import { appendRecord, readJournal, findIncompleteOperation } from "../../journal/jsonl.ts";
import type { OperationStep, OperationDefinition } from "../../journal/types.ts";

let tmpDir: string;
let missionDir: string;
let journalPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "kill-test-close-"));
  missionDir = path.join(tmpDir, "missions", "m-kill");
  journalPath = path.join(missionDir, "journal.jsonl");
  mkdirSync(missionDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

/**
 * Simulates a crash at a given step index by:
 * 1. Running the operation up to (but not completing) the target step
 * 2. Writing a step-started record without step-done (simulating SIGKILL)
 * 3. Verifying findIncompleteOperation detects it
 * 4. Calling runOperation again to resume
 * 5. Verifying the operation completes successfully
 */
async function simulateCrashAndResume(
  steps: OperationStep<Record<string, unknown>>[],
  crashAtStep: number,
): Promise<void> {
  const ctx: Record<string, unknown> = { calls: [] };

  // Phase 1: Manually write journal records as if the operation ran and crashed
  const opId = `op-kill-${crashAtStep}`;
  await appendRecord(journalPath, {
    kind: "op-started",
    opId,
    op: "mission.close",
    missionId: "m-kill",
    at: new Date().toISOString(),
    platformVersion: "1.0.0",
  });

  // Complete all steps before the crash point
  for (let i = 0; i < crashAtStep; i++) {
    await appendRecord(journalPath, {
      kind: "step-started",
      opId,
      step: steps[i].name,
      seq: i,
      at: new Date().toISOString(),
    });
    await appendRecord(journalPath, {
      kind: "step-done",
      opId,
      step: steps[i].name,
      seq: i,
      at: new Date().toISOString(),
    });
  }

  // Write step-started for the crash step (no step-done — simulates SIGKILL)
  await appendRecord(journalPath, {
    kind: "step-started",
    opId,
    step: steps[crashAtStep].name,
    seq: crashAtStep,
    at: new Date().toISOString(),
  });

  // Phase 2: Verify the journal shows the incomplete operation
  const records = await readJournal(journalPath);
  const incomplete = findIncompleteOperation(records);
  expect(incomplete).not.toBeNull();
  expect(incomplete!.op).toBe("mission.close");
  expect(incomplete!.opId).toBe(opId);

  // Phase 3: Resume the operation — runOperation should skip done steps and re-run crash step
  const def: OperationDefinition<Record<string, unknown>> = { op: "mission.close", steps };
  const result = await runOperation(journalPath, def, ctx, { resumeOpId: opId });

  // Phase 4: Verify completion
  expect(result.completed).toBe(true);
  expect(result.failedStep).toBeUndefined();
  expect(result.failedStepError).toBeUndefined();

  // Crash step has verify=true, so it's skipped on resume (verify postcondition met)
  // Steps after the crash point are executed
  for (let i = crashAtStep + 1; i < steps.length; i++) {
    expect(result.executed).toContain(steps[i].name);
  }
  // Crash step itself is skipped (verify returned true on resume)
  expect(result.skipped).toContain(steps[crashAtStep].name);
}

// Build a set of mock steps that track execution in ctx.calls
function buildMockSteps(count: number): OperationStep<Record<string, unknown>>[] {
  const steps: OperationStep<Record<string, unknown>>[] = [];
  for (let i = 0; i < count; i++) {
    steps.push({
      name: `step-${i}`,
      run: async (ctx: Record<string, unknown>) => {
        const calls = ctx.calls as string[];
        calls.push(`step-${i}`);
      },
      verify: async () => true,
    });
  }
  return steps;
}

test("kill-test: crash at step 0 (first step) — resume completes", async () => {
  const steps = buildMockSteps(5);
  await simulateCrashAndResume(steps, 0);
});

test("kill-test: crash at step 1 — resume skips step 0, completes remaining", async () => {
  const steps = buildMockSteps(5);
  await simulateCrashAndResume(steps, 1);
});

test("kill-test: crash at step 2 — resume skips done steps, completes remaining", async () => {
  const steps = buildMockSteps(5);
  await simulateCrashAndResume(steps, 2);
});

test("kill-test: crash at step 3 — resume skips done steps, completes remaining", async () => {
  const steps = buildMockSteps(5);
  await simulateCrashAndResume(steps, 3);
});

test("kill-test: crash at last step — resume skips all done, completes last", async () => {
  const steps = buildMockSteps(5);
  await simulateCrashAndResume(steps, 4);
});

test("kill-test: resume with no crash (all steps done) — skips all, completes", async () => {
  const ctx: Record<string, unknown> = { calls: [] };
  const steps = buildMockSteps(3);
  const opId = "op-nocrash";

  await appendRecord(journalPath, {
    kind: "op-started",
    opId,
    op: "mission.close",
    missionId: "m-kill",
    at: new Date().toISOString(),
    platformVersion: "1.0.0",
  });

  for (let i = 0; i < steps.length; i++) {
    await appendRecord(journalPath, {
      kind: "step-started",
      opId,
      step: steps[i].name,
      seq: i,
      at: new Date().toISOString(),
    });
    await appendRecord(journalPath, {
      kind: "step-done",
      opId,
      step: steps[i].name,
      seq: i,
      at: new Date().toISOString(),
    });
  }

  // No op-done record — operation is still "incomplete"
  const def: OperationDefinition<Record<string, unknown>> = { op: "mission.close", steps };
  const result = await runOperation(journalPath, def, ctx, { resumeOpId: opId });

  expect(result.completed).toBe(true);
  expect(result.skipped).toHaveLength(3);
  expect(result.executed).toHaveLength(0);
});

test("kill-test: crash step with verify=true on resume — skipped, not re-run", async () => {
  const ctx: Record<string, unknown> = { calls: [] };
  const steps: OperationStep<Record<string, unknown>>[] = [
    {
      name: "step-0",
      run: async (c) => {
        (c.calls as string[]).push("step-0");
      },
      verify: async () => true,
    },
    {
      name: "step-1",
      run: async (c) => {
        (c.calls as string[]).push("step-1");
      },
      verify: async () => true,
    },
    {
      name: "step-2",
      run: async (c) => {
        (c.calls as string[]).push("step-2");
      },
      verify: async () => true,
    },
  ];

  const opId = "op-verify-skip";
  await appendRecord(journalPath, {
    kind: "op-started",
    opId,
    op: "mission.close",
    missionId: "m-kill",
    at: new Date().toISOString(),
    platformVersion: "1.0.0",
  });

  // Step 0 done
  await appendRecord(journalPath, { kind: "step-started", opId, step: "step-0", seq: 0, at: "t" });
  await appendRecord(journalPath, { kind: "step-done", opId, step: "step-0", seq: 0, at: "t" });

  // Step 1 started but not done (crash)
  await appendRecord(journalPath, { kind: "step-started", opId, step: "step-1", seq: 1, at: "t" });

  const def: OperationDefinition<Record<string, unknown>> = { op: "mission.close", steps };
  const result = await runOperation(journalPath, def, ctx, { resumeOpId: opId });

  expect(result.completed).toBe(true);
  // step-0 skipped (done), step-1 skipped (verify=true on resume), step-2 executed
  expect(result.skipped).toContain("step-0");
  expect(result.skipped).toContain("step-1");
  expect(result.executed).toContain("step-2");
});

test("kill-test: crash step with verify=false on resume — re-run", async () => {
  const ctx: Record<string, unknown> = { calls: [] };
  const steps: OperationStep<Record<string, unknown>>[] = [
    {
      name: "step-0",
      run: async (c) => {
        (c.calls as string[]).push("step-0");
      },
      verify: async () => true,
    },
    {
      name: "step-1",
      run: async (c) => {
        (c.calls as string[]).push("step-1");
      },
      // No verify — crash step must be re-run
    },
    {
      name: "step-2",
      run: async (c) => {
        (c.calls as string[]).push("step-2");
      },
      verify: async () => true,
    },
  ];

  const opId = "op-verify-rerun";
  await appendRecord(journalPath, {
    kind: "op-started",
    opId,
    op: "mission.close",
    missionId: "m-kill",
    at: new Date().toISOString(),
    platformVersion: "1.0.0",
  });

  await appendRecord(journalPath, { kind: "step-started", opId, step: "step-0", seq: 0, at: "t" });
  await appendRecord(journalPath, { kind: "step-done", opId, step: "step-0", seq: 0, at: "t" });
  await appendRecord(journalPath, { kind: "step-started", opId, step: "step-1", seq: 1, at: "t" });

  const def: OperationDefinition<Record<string, unknown>> = { op: "mission.close", steps };
  const result = await runOperation(journalPath, def, ctx, { resumeOpId: opId });

  expect(result.completed).toBe(true);
  expect(result.skipped).toContain("step-0");
  expect(result.executed).toContain("step-1");
  expect(result.executed).toContain("step-2");
});

test("kill-test: op-done after resume — no incomplete operation remains", async () => {
  const ctx: Record<string, unknown> = { calls: [] };
  const steps = buildMockSteps(3);
  const opId = "op-cleanup-check";

  await appendRecord(journalPath, {
    kind: "op-started",
    opId,
    op: "mission.close",
    missionId: "m-kill",
    at: new Date().toISOString(),
    platformVersion: "1.0.0",
  });

  // Crash at step 1
  await appendRecord(journalPath, { kind: "step-started", opId, step: "step-0", seq: 0, at: "t" });
  await appendRecord(journalPath, { kind: "step-done", opId, step: "step-0", seq: 0, at: "t" });
  await appendRecord(journalPath, { kind: "step-started", opId, step: "step-1", seq: 1, at: "t" });

  const def: OperationDefinition<Record<string, unknown>> = { op: "mission.close", steps };
  await runOperation(journalPath, def, ctx, { resumeOpId: opId });

  // After resume, no incomplete operation should remain
  const records = await readJournal(journalPath);
  const incomplete = findIncompleteOperation(records);
  expect(incomplete).toBeNull();
});
