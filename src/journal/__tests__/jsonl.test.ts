/*
<MODULE_CONTRACT>
  <purpose>Test RFC-0958: JSONL reader/writer — append, read, torn-line detection.</purpose>
</MODULE_CONTRACT>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { appendRecord, readJournal, findIncompleteOperation, TornLineError } from "../jsonl.ts";
import type { JournalRecord } from "../types.ts";

let tmpDir: string;
let journalPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "journal-jsonl-"));
  journalPath = path.join(tmpDir, "journal.jsonl");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("readJournal returns empty array for non-existent file", async () => {
  const records = await readJournal(journalPath);
  expect(records).toEqual([]);
});

test("readJournal returns empty array for empty file", async () => {
  writeFileSync(journalPath, "");
  const records = await readJournal(journalPath);
  expect(records).toEqual([]);
});

test("appendRecord + readJournal round-trip", async () => {
  const r1: JournalRecord = {
    kind: "op-started",
    opId: "op-1",
    op: "mission.close",
    missionId: "m-001",
    at: "2026-08-27T00:00:00.000Z",
    platformVersion: "1.0.0",
  };
  const r2: JournalRecord = {
    kind: "step-started",
    opId: "op-1",
    step: "push-cache-to-bare",
    seq: 0,
    at: "2026-08-27T00:00:01.000Z",
  };

  await appendRecord(journalPath, r1);
  await appendRecord(journalPath, r2);

  const records = await readJournal(journalPath);
  expect(records).toHaveLength(2);
  expect(records[0]).toEqual(r1);
  expect(records[1]).toEqual(r2);
});

test("readJournal discards torn final line (truncated JSON)", async () => {
  const validLine =
    JSON.stringify({
      kind: "op-started",
      opId: "op-1",
      op: "mission.close",
      missionId: "m-001",
      at: "2026-08-27T00:00:00.000Z",
      platformVersion: "1.0.0",
    }) + "\n";
  const tornLine = '{"kind":"step-started","opId":"op-1","step":"incomp';
  writeFileSync(journalPath, validLine + tornLine);

  await expect(readJournal(journalPath)).rejects.toThrow(TornLineError);
});

test("readJournal throws TornLineError for corrupt line in middle", async () => {
  const valid = JSON.stringify({
    kind: "op-started",
    opId: "op-1",
    op: "mission.close",
    missionId: "m-001",
    at: "2026-08-27T00:00:00.000Z",
    platformVersion: "1.0.0",
  });
  const corrupt = "not valid json";
  writeFileSync(journalPath, `${valid}\n${corrupt}\n${valid}\n`);

  await expect(readJournal(journalPath)).rejects.toThrow(TornLineError);
});

test("appendRecord creates parent directories", async () => {
  const nestedPath = path.join(tmpDir, "deep", "nested", "dir", "journal.jsonl");
  await appendRecord(nestedPath, {
    kind: "op-started",
    opId: "op-1",
    op: "mission.close",
    missionId: "m-001",
    at: "2026-08-27T00:00:00.000Z",
    platformVersion: "1.0.0",
  });
  const content = readFileSync(nestedPath, "utf8");
  expect(content).toContain("op-started");
});

test("findIncompleteOperation returns null for empty records", () => {
  expect(findIncompleteOperation([])).toBeNull();
});

test("findIncompleteOperation returns null when op-done exists", () => {
  const records: JournalRecord[] = [
    { kind: "op-started", opId: "op-1", op: "mission.close", missionId: "m-001", at: "t0", platformVersion: "1.0.0" },
    { kind: "step-started", opId: "op-1", step: "s0", seq: 0, at: "t1" },
    { kind: "step-done", opId: "op-1", step: "s0", seq: 0, at: "t2" },
    { kind: "op-done", opId: "op-1", at: "t3" },
  ];
  expect(findIncompleteOperation(records)).toBeNull();
});

test("findIncompleteOperation returns null when op-abandoned exists", () => {
  const records: JournalRecord[] = [
    { kind: "op-started", opId: "op-1", op: "mission.close", missionId: "m-001", at: "t0", platformVersion: "1.0.0" },
    { kind: "op-abandoned", opId: "op-1", at: "t1", reason: "manual" },
  ];
  expect(findIncompleteOperation(records)).toBeNull();
});

test("findIncompleteOperation detects incomplete op with crash step", () => {
  const records: JournalRecord[] = [
    { kind: "op-started", opId: "op-1", op: "mission.close", missionId: "m-001", at: "t0", platformVersion: "1.0.0" },
    { kind: "step-started", opId: "op-1", step: "s0", seq: 0, at: "t1" },
    { kind: "step-done", opId: "op-1", step: "s0", seq: 0, at: "t2" },
    { kind: "step-started", opId: "op-1", step: "s1", seq: 1, at: "t3" },
  ];
  const result = findIncompleteOperation(records);
  expect(result).toEqual({ opId: "op-1", op: "mission.close", lastSeq: 1 });
});

test("findIncompleteOperation uses last op-started when multiple exist", () => {
  const records: JournalRecord[] = [
    { kind: "op-started", opId: "op-1", op: "mission.close", missionId: "m-001", at: "t0", platformVersion: "1.0.0" },
    { kind: "op-done", opId: "op-1", at: "t1" },
    { kind: "op-started", opId: "op-2", op: "mission.reconcile", missionId: "m-001", at: "t2", platformVersion: "1.0.0" },
    { kind: "step-started", opId: "op-2", step: "s0", seq: 0, at: "t3" },
  ];
  const result = findIncompleteOperation(records);
  expect(result).toEqual({ opId: "op-2", op: "mission.reconcile", lastSeq: 0 });
});
