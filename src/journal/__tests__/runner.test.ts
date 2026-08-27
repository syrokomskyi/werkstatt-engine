/*
<MODULE_CONTRACT>
  <purpose>Test RFC-0958: runOperation step runner — fresh run, resume, skip, fail semantics.</purpose>
</MODULE_CONTRACT>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { runOperation, readJournal, abandonOperation, appendRecord } from "../runner.ts";
import type { OperationDefinition, JournalRecord } from "../types.ts";

interface TestCtx {
  log: string[];
  crashAtStep?: number;
  crashTriggered: boolean;
}

function makeStep(name: string, ctx: TestCtx, opts?: { verify?: () => Promise<boolean> }) {
  return {
    name,
    async run(c: TestCtx) {
      if (c.crashAtStep !== undefined && c.log.length === c.crashAtStep && !c.crashTriggered) {
        c.crashTriggered = true;
        throw new Error(`Simulated crash at step ${name}`);
      }
      c.log.push(name);
    },
    verify: opts?.verify,
  };
}

let tmpDir: string;
let journalPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "journal-runner-"));
  journalPath = path.join(tmpDir, "journal.jsonl");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("fresh run completes all steps in order", async () => {
  const ctx: TestCtx = { log: [], crashTriggered: false };
  const def: OperationDefinition<TestCtx> = {
    op: "test.op",
    steps: [makeStep("s0", ctx), makeStep("s1", ctx), makeStep("s2", ctx)],
  };

  const result = await runOperation(journalPath, def, ctx, { missionId: "m-001" });

  expect(result.completed).toBe(true);
  expect(result.executed).toEqual(["s0", "s1", "s2"]);
  expect(result.skipped).toEqual([]);
  expect(ctx.log).toEqual(["s0", "s1", "s2"]);

  const records = await readJournal(journalPath);
  const kinds = records.map((r) => r.kind);
  expect(kinds).toContain("op-started");
  expect(kinds).toContain("op-done");
});

test("fresh run skips steps where verify returns true (already-satisfied)", async () => {
  const ctx: TestCtx = { log: [], crashTriggered: false };
  const def: OperationDefinition<TestCtx> = {
    op: "test.op",
    steps: [makeStep("s0", ctx, { verify: async () => true }), makeStep("s1", ctx)],
  };

  const result = await runOperation(journalPath, def, ctx);

  expect(result.completed).toBe(true);
  expect(result.skipped).toEqual(["s0"]);
  expect(result.executed).toEqual(["s1"]);
  expect(ctx.log).toEqual(["s1"]);

  const records = await readJournal(journalPath);
  const skipRecord = records.find((r) => r.kind === "step-skipped");
  expect(skipRecord).toBeDefined();
  if (skipRecord && skipRecord.kind === "step-skipped") {
    expect(skipRecord.reason).toBe("already-satisfied");
  }
});

test("step failure stops operation and records failedStep", async () => {
  const ctx: TestCtx = { log: [], crashAtStep: 1, crashTriggered: false };
  const def: OperationDefinition<TestCtx> = {
    op: "test.op",
    steps: [makeStep("s0", ctx), makeStep("s1", ctx), makeStep("s2", ctx)],
  };

  const result = await runOperation(journalPath, def, ctx);

  expect(result.completed).toBe(false);
  expect(result.failedStep).toBe("s1");
  expect(result.executed).toEqual(["s0"]);
  expect(ctx.log).toEqual(["s0"]);

  const records = await readJournal(journalPath);
  const failRecord = records.find((r) => r.kind === "step-failed");
  expect(failRecord).toBeDefined();
  const doneRecords = records.filter((r) => r.kind === "op-done");
  expect(doneRecords).toHaveLength(0);
});

test("resume skips done steps and re-runs crash-point step when verify returns false", async () => {
  const ctx: TestCtx = { log: [], crashAtStep: 1, crashTriggered: false };
  const def: OperationDefinition<TestCtx> = {
    op: "test.op",
    steps: [makeStep("s0", ctx), makeStep("s1", ctx), makeStep("s2", ctx)],
  };

  const firstResult = await runOperation(journalPath, def, ctx);
  expect(firstResult.completed).toBe(false);
  expect(firstResult.failedStep).toBe("s1");

  ctx.crashAtStep = undefined;
  ctx.crashTriggered = false;
  ctx.log = [];

  const resumeResult = await runOperation(journalPath, def, ctx, {
    resumeOpId: firstResult.opId,
  });

  expect(resumeResult.completed).toBe(true);
  expect(resumeResult.skipped).toContain("s0");
  expect(resumeResult.executed).toContain("s1");
  expect(resumeResult.executed).toContain("s2");
});

test("resume skips crash-point step when verify returns true", async () => {
  const ctx: TestCtx = { log: [], crashTriggered: false };
  const def: OperationDefinition<TestCtx> = {
    op: "test.op",
    steps: [
      makeStep("s0", ctx),
      makeStep("s1", ctx, { verify: async () => true }),
      makeStep("s2", ctx),
    ],
  };

  const opId = "test-op-crash-verify";
  await appendRecord(journalPath, {
    kind: "op-started",
    opId,
    op: "test.op",
    missionId: "m-001",
    at: "2026-08-27T00:00:00.000Z",
    platformVersion: "1.0.0",
  });
  await appendRecord(journalPath, { kind: "step-started", opId, step: "s0", seq: 0, at: "t1" });
  await appendRecord(journalPath, { kind: "step-done", opId, step: "s0", seq: 0, at: "t2" });
  await appendRecord(journalPath, { kind: "step-started", opId, step: "s1", seq: 1, at: "t3" });

  const resumeResult = await runOperation(journalPath, def, ctx, { resumeOpId: opId });

  expect(resumeResult.completed).toBe(true);
  expect(resumeResult.skipped).toContain("s0");
  expect(resumeResult.skipped).toContain("s1");
  expect(resumeResult.executed).toContain("s2");
  expect(ctx.log).toEqual(["s2"]);
});

test("resume with no incomplete operation starts fresh", async () => {
  const ctx: TestCtx = { log: [], crashTriggered: false };
  const def: OperationDefinition<TestCtx> = {
    op: "test.op",
    steps: [makeStep("s0", ctx)],
  };

  const result = await runOperation(journalPath, def, ctx, { resumeOpId: "nonexistent-op" });

  expect(result.completed).toBe(true);
  expect(result.executed).toEqual(["s0"]);
});

test("verify after run failure records step-failed", async () => {
  const ctx: TestCtx = { log: [], crashTriggered: false };
  const def: OperationDefinition<TestCtx> = {
    op: "test.op",
    steps: [
      {
        name: "s0",
        async run(c: TestCtx) {
          c.log.push("s0");
        },
        verify: async () => false,
      },
    ],
  };

  const result = await runOperation(journalPath, def, ctx);

  expect(result.completed).toBe(false);
  expect(result.failedStep).toBe("s0");

  const records = await readJournal(journalPath);
  const failRecord = records.find((r) => r.kind === "step-failed");
  expect(failRecord).toBeDefined();
  if (failRecord && failRecord.kind === "step-failed") {
    expect(failRecord.error).toContain("verify returned false");
  }
});

test("abandonOperation appends op-abandoned record", async () => {
  const ctx: TestCtx = { log: [], crashTriggered: false };
  const def: OperationDefinition<TestCtx> = {
    op: "test.op",
    steps: [makeStep("s0", ctx)],
  };

  const result = await runOperation(journalPath, def, ctx);
  await abandonOperation(journalPath, result.opId, "manual abort");

  const records = await readJournal(journalPath);
  const abandoned = records.find((r) => r.kind === "op-abandoned");
  expect(abandoned).toBeDefined();
  if (abandoned && abandoned.kind === "op-abandoned") {
    expect(abandoned.reason).toBe("manual abort");
  }
});

test("same-kind incomplete operation auto-resumes without explicit resumeOpId", async () => {
  const ctx: TestCtx = { log: [], crashAtStep: 0, crashTriggered: false };
  const def: OperationDefinition<TestCtx> = {
    op: "test.op",
    steps: [makeStep("s0", ctx), makeStep("s1", ctx)],
  };

  const firstResult = await runOperation(journalPath, def, ctx);
  expect(firstResult.completed).toBe(false);

  ctx.crashAtStep = undefined;
  ctx.crashTriggered = false;
  ctx.log = [];

  const secondResult = await runOperation(journalPath, def, ctx);

  expect(secondResult.completed).toBe(true);
  expect(secondResult.opId).toBe(firstResult.opId);
  expect(secondResult.executed).toEqual(["s0", "s1"]);
});
