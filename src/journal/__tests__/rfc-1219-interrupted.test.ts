/*
<MODULE_CONTRACT>
  <purpose>Test RFC-1219: op-interrupted marker, scan-all findIncompleteOperation, failed-step re-execution on resume.</purpose>
</MODULE_CONTRACT>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { runOperation, readJournal, appendRecord } from "../runner.ts";
import { findIncompleteOperation } from "../jsonl.ts";
import type { JournalRecord, OperationDefinition } from "../types.ts";

let tmpDir: string;
let journalPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "rfc-1219-"));
  journalPath = path.join(tmpDir, "journal.jsonl");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const rec = (r: JournalRecord) => appendRecord(journalPath, r);

// AC-2: a step failure leaves the journal open with an op-interrupted marker
// naming the failed step — non-terminal, so the op stays resumable.
test("failed step appends op-interrupted and the op stays resumable", async () => {
  const def: OperationDefinition<{ log: string[] }> = {
    op: "test.op",
    steps: [
      { name: "s0", run: async (c) => void c.log.push("s0") },
      {
        name: "s1",
        run: async () => {
          throw new Error("boom");
        },
      },
      { name: "s2", run: async (c) => void c.log.push("s2") },
    ],
  };

  const result = await runOperation(journalPath, def, { log: [] }, { missionId: "m-1" });
  expect(result.completed).toBe(false);
  expect(result.failedStep).toBe("s1");

  const records = await readJournal(journalPath);
  const interrupted = records.filter((r) => r.kind === "op-interrupted");
  expect(interrupted).toHaveLength(1);
  expect(interrupted[0]).toMatchObject({ opId: result.opId, failedStep: "s1" });
  expect(records.some((r) => r.kind === "op-done" && r.opId === result.opId)).toBe(false);

  const incomplete = findIncompleteOperation(records);
  expect(incomplete).not.toBeNull();
  expect(incomplete?.opId).toBe(result.opId);
  expect(incomplete?.status).toBe("interrupted");
  expect(incomplete?.failedStep).toBe("s1");
});

// AC-4 + AC-3: resume skips done steps and re-executes the failed step.
test("resume skips done steps and re-executes the failed step", async () => {
  const log: string[] = [];
  let failOnce = true;
  const def: OperationDefinition<{ log: string[] }> = {
    op: "test.op",
    steps: [
      { name: "s0", run: async (c) => void c.log.push("s0") },
      {
        name: "s1",
        run: async (c) => {
          if (failOnce) {
            failOnce = false;
            throw new Error("boom");
          }
          c.log.push("s1");
        },
      },
      { name: "s2", run: async (c) => void c.log.push("s2") },
    ],
  };
  const ctx = { log };

  const first = await runOperation(journalPath, def, ctx, { missionId: "m-1" });
  expect(first.completed).toBe(false);
  expect(log).toEqual(["s0"]);

  const second = await runOperation(journalPath, def, ctx, {
    missionId: "m-1",
    resumeOpId: first.opId,
  });
  expect(second.completed).toBe(true);
  expect(second.skipped).toEqual(["s0"]);
  expect(second.executed).toEqual(["s1", "s2"]);
  // s0 must NOT have re-run.
  expect(log).toEqual(["s0", "s1", "s2"]);
});

// AC-6: a completed later op must not mask an earlier incomplete one.
test("findIncompleteOperation scans newest-first and returns the earlier incomplete op", async () => {
  await rec({
    kind: "op-started",
    opId: "op-a",
    op: "mission.reconcile",
    missionId: "m-1",
    at: "t0",
    platformVersion: "",
  });
  await rec({ kind: "step-started", opId: "op-a", step: "s0", seq: 0, at: "t1" });
  await rec({
    kind: "step-failed",
    opId: "op-a",
    step: "s0",
    seq: 0,
    at: "t2",
    error: "boom",
  });
  // A later, fully completed op (e.g. a manual re-run) must not close it.
  await rec({
    kind: "op-started",
    opId: "op-b",
    op: "mission.validate",
    missionId: "m-1",
    at: "t3",
    platformVersion: "",
  });
  await rec({ kind: "step-started", opId: "op-b", step: "v0", seq: 0, at: "t4" });
  await rec({ kind: "step-done", opId: "op-b", step: "v0", seq: 0, at: "t5" });
  await rec({ kind: "op-done", opId: "op-b", at: "t6" });

  const incomplete = findIncompleteOperation(await readJournal(journalPath));
  expect(incomplete?.opId).toBe("op-a");
  expect(incomplete?.status).toBe("interrupted");
  expect(incomplete?.failedStep).toBe("s0");
});

// AC-6: running status — open op without failure markers is "running".
test("open op without failure records reports status running", async () => {
  await rec({
    kind: "op-started",
    opId: "op-1",
    op: "test.op",
    missionId: "m-1",
    at: "t0",
    platformVersion: "",
  });
  await rec({ kind: "step-started", opId: "op-1", step: "s0", seq: 0, at: "t1" });

  const incomplete = findIncompleteOperation(await readJournal(journalPath));
  expect(incomplete?.opId).toBe("op-1");
  expect(incomplete?.status).toBe("running");
  expect(incomplete?.failedStep).toBeUndefined();
});

// AC-7: legacy journal without op-interrupted — a step-failed-only op is
// still interrupted/resumable; a completed journal reports nothing.
test("legacy journals without op-interrupted stay resumable; completed ops return null", async () => {
  // Legacy shape: op-started + step records + step-failed, no marker.
  await rec({
    kind: "op-started",
    opId: "op-legacy",
    op: "leitstand.ship",
    missionId: "m-1",
    at: "t0",
    platformVersion: "",
  });
  await rec({ kind: "step-started", opId: "op-legacy", step: "preflight", seq: 0, at: "t1" });
  await rec({ kind: "step-done", opId: "op-legacy", step: "preflight", seq: 0, at: "t2" });
  await rec({ kind: "step-started", opId: "op-legacy", step: "reconcile", seq: 1, at: "t3" });
  await rec({
    kind: "step-failed",
    opId: "op-legacy",
    step: "reconcile",
    seq: 1,
    at: "t4",
    error: "boom",
  });

  const legacy = findIncompleteOperation(await readJournal(journalPath));
  expect(legacy?.opId).toBe("op-legacy");
  expect(legacy?.status).toBe("interrupted");

  // Complete it — nothing resumable afterwards.
  await rec({ kind: "op-done", opId: "op-legacy", at: "t9" });
  expect(findIncompleteOperation(await readJournal(journalPath))).toBeNull();
});

// AC-7: op-interrupted does not close the op for abandon semantics — the
// sweep-side terminal check (op-done|op-abandoned) is unchanged; assert the
// marker alone doesn't satisfy findIncompleteOperation's terminal check.
test("op-interrupted without op-started does not create a resumable op", async () => {
  await rec({ kind: "op-interrupted", opId: "op-orphan", at: "t0", failedStep: "s1" });
  expect(findIncompleteOperation(await readJournal(journalPath))).toBeNull();
});
