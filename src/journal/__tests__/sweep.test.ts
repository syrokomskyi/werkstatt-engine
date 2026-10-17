/*
<MODULE_CONTRACT>
  <purpose>Test ADR-0084: journal sweep — findIncompleteOperationsForMission and abandonIncompleteOperationsForMission over operations/*.jsonl directories.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0084: initial sweep tests — mission matching (missionId field, opId, filename inference), terminal-record exclusion, multi-file sweep, unreadable-file reporting, reason string.</item>
  <item>RFC-1311: carried legacy entry — 2026-10-04 recovery fix: excludeOpIds regression test — a still-running op listed in the exclusion set is not abandoned (mission.close must not self-abandon the ship journal it executes inside).</item>
  <item>RFC-1190: restore mission context + evidence archival in release-mode deploys

RFC-1190: precedence-ordered resolveMissionContext (--mission → release build-identity → currentMission), MISSION_CONTEXT_UNRESOLVED/MISMATCH blocking, fail-closed EVIDENCE_SYNC_FAILED with --skip-evidence-sync as sole escape hatch, journaled evidence-sync-* ship steps after each certify-*, evidence.sync --site/--system flag.

2026-10-04 handoff fixes: shared 25min mission.check timeout (inner 5min race + 300s orchestrator raced cold ~7-11min captures), sweep excludeOpIds so mission.close no longer self-abandons the live ship journal (broke --resume), name-keyed journal resume state so closed-mission plan shifts can't skip unexecuted steps, wrangler dev documented as the required --base-url preview server.</item>
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

test("does not match missionId as a prefix of a longer id (boundary-aware)", async () => {
  const journalPath = path.join(operationsDir, "ship-m-0060.jsonl");
  await writeOpStarted(journalPath, "op-m0060", "leitstand.ship", "m-0060");

  const result = await abandonIncompleteOperationsForMission(operationsDir, "m-006");

  expect(result.abandoned).toEqual([]);
  const records = await readJournal(journalPath);
  expect(findIncompleteOperation(records)).not.toBeNull();
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

test("excludeOpIds skips still-running ops (mission.close must not self-abandon its caller)", async () => {
  // Regression (2026-10-04): mission.close runs INSIDE leitstand.ship's
  // journal op — the sweep saw the live ship op as incomplete and appended
  // op-abandoned to it mid-run, marking the op terminal so --resume later
  // reported "nothing to resume" for a genuinely failed run.
  const journalPath = path.join(operationsDir, "ship-m-012.jsonl");
  await writeOpStarted(journalPath, "leitstand-ship-12", "leitstand.ship", "m-012");

  const excluded = new Set(["leitstand-ship-12"]);
  const scan = await findIncompleteOperationsForMission(
    operationsDir,
    "m-012",
    undefined,
    excluded,
  );
  expect(scan.incomplete).toEqual([]);

  const result = await abandonIncompleteOperationsForMission(operationsDir, "m-012", excluded);
  expect(result.abandoned).toEqual([]);

  const records = await readJournal(journalPath);
  expect(records.find((r) => r.kind === "op-abandoned")).toBeUndefined();
  expect(findIncompleteOperation(records)).not.toBeNull();

  // Control: without the exclusion the same op IS abandoned
  const control = await abandonIncompleteOperationsForMission(operationsDir, "m-012");
  expect(control.abandoned).toHaveLength(1);
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
