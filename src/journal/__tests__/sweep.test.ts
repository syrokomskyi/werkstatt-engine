/*
<MODULE_CONTRACT>
  <purpose>Test ADR-0084: journal sweep — findIncompleteOperationsForMission and abandonIncompleteOperationsForMission over operations/*.jsonl directories.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0084: initial sweep tests — mission matching (missionId field, opId, filename inference), terminal-record exclusion, multi-file sweep, unreadable-file reporting, reason string.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  findIncompleteOperationsForMission,
  abandonIncompleteOperationsForMission,
} from "../sweep.ts";
import { appendRecord, readJournal, findIncompleteOperation } from "../jsonl.ts";

let tmpDir: string;
let operationsDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "journal-sweep-"));
  operationsDir = path.join(tmpDir, "operations");
  mkdirSync(operationsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

async function writeOpStarted(
  journalPath: string,
  opId: string,
  op: string,
  missionId: string,
): Promise<void> {
  await appendRecord(journalPath, {
    kind: "op-started",
    opId,
    op,
    missionId,
    at: new Date().toISOString(),
    platformVersion: "1.0.0",
  });
}

test("abandons incomplete op whose op-started carries the closing missionId", async () => {
  const journalPath = path.join(operationsDir, "ship-m-001.jsonl");
  await writeOpStarted(journalPath, "leitstand-ship-1", "leitstand.ship", "m-001");

  const result = await abandonIncompleteOperationsForMission(operationsDir, "m-001");

  expect(result.abandoned).toHaveLength(1);
  expect(result.abandoned[0].opId).toBe("leitstand-ship-1");
  expect(result.unreadableFiles).toEqual([]);

  const records = await readJournal(journalPath);
  const abandoned = records.find((r) => r.kind === "op-abandoned");
  expect(abandoned).toBeDefined();
  if (abandoned && abandoned.kind === "op-abandoned") {
    expect(abandoned.reason).toBe("mission closed: m-001");
  }
  // The op must no longer be resumable
  expect(findIncompleteOperation(records)).toBeNull();
});

test("abandons incomplete op matched by filename inference when records lack missionId", async () => {
  const journalPath = path.join(operationsDir, "ship-m-002.jsonl");
  await writeOpStarted(journalPath, "leitstand-ship-2", "leitstand.ship", "");

  const result = await abandonIncompleteOperationsForMission(operationsDir, "m-002");

  expect(result.abandoned).toHaveLength(1);
  expect(result.abandoned[0].opId).toBe("leitstand-ship-2");
});

test("abandons incomplete op matched by opId containing the missionId", async () => {
  const journalPath = path.join(operationsDir, "ops.jsonl");
  await writeOpStarted(journalPath, "deploy-m-003-abc", "custom.op", "other-mission");

  const result = await abandonIncompleteOperationsForMission(operationsDir, "m-003");

  expect(result.abandoned).toHaveLength(1);
  expect(result.abandoned[0].opId).toBe("deploy-m-003-abc");
});

test("does not abandon ops belonging to other missions", async () => {
  const journalPath = path.join(operationsDir, "ship-m-004.jsonl");
  await writeOpStarted(journalPath, "leitstand-ship-4", "leitstand.ship", "m-004");

  const result = await abandonIncompleteOperationsForMission(operationsDir, "m-999");

  expect(result.abandoned).toEqual([]);
  const records = await readJournal(journalPath);
  expect(records.find((r) => r.kind === "op-abandoned")).toBeUndefined();
  // Op remains resumable — untouched by the sweep
  expect(findIncompleteOperation(records)).not.toBeNull();
});

test("does not abandon ops that already have a terminal record", async () => {
  const journalPath = path.join(operationsDir, "ship-m-005.jsonl");
  await writeOpStarted(journalPath, "leitstand-ship-5a", "leitstand.ship", "m-005");
  await appendRecord(journalPath, {
    kind: "op-done",
    opId: "leitstand-ship-5a",
    at: new Date().toISOString(),
  });
  await writeOpStarted(journalPath, "leitstand-ship-5b", "leitstand.ship", "m-005");
  await appendRecord(journalPath, {
    kind: "op-abandoned",
    opId: "leitstand-ship-5b",
    at: new Date().toISOString(),
    reason: "manual abort",
  });

  const result = await abandonIncompleteOperationsForMission(operationsDir, "m-005");

  expect(result.abandoned).toEqual([]);
  const records = await readJournal(journalPath);
  // Only the pre-existing op-abandoned record — sweep must not append another
  expect(records.filter((r) => r.kind === "op-abandoned")).toHaveLength(1);
});

test("sweeps incomplete ops across multiple journal files", async () => {
  const j1 = path.join(operationsDir, "ship-m-006.jsonl");
  const j2 = path.join(operationsDir, "ship-m-006-retry.jsonl");
  const j3 = path.join(operationsDir, "ship-m-007.jsonl");
  await writeOpStarted(j1, "op-a", "leitstand.ship", "m-006");
  await writeOpStarted(j2, "op-b", "leitstand.ship", "m-006");
  await writeOpStarted(j3, "op-c", "leitstand.ship", "m-007");

  const result = await abandonIncompleteOperationsForMission(operationsDir, "m-006");

  expect(result.abandoned.map((o) => o.opId).sort()).toEqual(["op-a", "op-b"]);
  const records3 = await readJournal(j3);
  expect(findIncompleteOperation(records3)).not.toBeNull();
});

test("returns empty result when operations directory does not exist", async () => {
  const missing = path.join(tmpDir, "no-such-dir");
  const scan = await findIncompleteOperationsForMission(missing, "m-008");
  expect(scan.incomplete).toEqual([]);
  expect(scan.unreadableFiles).toEqual([]);

  const sweep = await abandonIncompleteOperationsForMission(missing, "m-008");
  expect(sweep.abandoned).toEqual([]);
});

test("reports unreadable journal files without abandoning anything", async () => {
  const corrupt = path.join(operationsDir, "ship-m-009.jsonl");
  writeFileSync(corrupt, '{"kind":"op-started","opId":"op-x","op":"leitst');
  const good = path.join(operationsDir, "ship-m-010.jsonl");
  await writeOpStarted(good, "op-y", "leitstand.ship", "m-010");

  const result = await abandonIncompleteOperationsForMission(operationsDir, "m-009");

  expect(result.unreadableFiles).toEqual(["ship-m-009.jsonl"]);
  expect(result.abandoned).toEqual([]);
});

test("findIncompleteOperationsForMission lists incomplete ops without writing", async () => {
  const journalPath = path.join(operationsDir, "ship-m-011.jsonl");
  await writeOpStarted(journalPath, "op-z", "leitstand.ship", "m-011");

  const scan = await findIncompleteOperationsForMission(operationsDir, "m-011");

  expect(scan.incomplete).toHaveLength(1);
  expect(scan.incomplete[0]).toMatchObject({ opId: "op-z", op: "leitstand.ship" });
  // Read-only: no op-abandoned appended
  const records = await readJournal(journalPath);
  expect(records.find((r) => r.kind === "op-abandoned")).toBeUndefined();
});
