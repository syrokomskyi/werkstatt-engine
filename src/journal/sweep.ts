/*
<MODULE_CONTRACT>
  <purpose>journal sweep — scan an operations directory for incomplete operations belonging to a mission and abandon them (ADR-0084).</purpose>
  <non-goals>
    <item>Do not implement step execution logic — that lives in runner.ts.</item>
    <item>Do not import mission-specific types — the sweep matches ops by a missionId string.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0084: initial sweep — findIncompleteOperationsForMission, abandonIncompleteOperationsForMission. An op belongs to a mission when its op-started record carries the missionId, its opId contains the missionId, or the journal filename contains the missionId (filename inference covers records without mission attribution).</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import { readJournal } from "./jsonl.ts";
import { abandonOperation } from "./runner.ts";
import type { JournalRecord } from "./types.ts";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export interface IncompleteOperationRef {
  opId: string;
  op: string;
  journalPath: string;
}

export interface OperationSweepResult {
  incomplete: IncompleteOperationRef[];
  /** Basenames of journal files that could not be parsed (e.g. torn lines). */
  unreadableFiles: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Boundary-aware containment check: `text` references `missionId` when the id
 * appears and is not immediately followed by an alphanumeric character — so
 * `m-006` matches `ship-m-006.jsonl` and `ship-m-006-retry.jsonl` but not
 * `ship-m-0060.jsonl`.
 */
export function referencesMissionId(text: string, missionId: string): boolean {
  return new RegExp(`${escapeRegExp(missionId)}(?![0-9A-Za-z])`).test(text);
}

/**
 * ADR-0084: find every incomplete operation in `operationsDir` that belongs to
 * `missionId`. An operation belongs to the mission when its op-started record
 * carries `missionId === missionId`, its opId contains the missionId, or the
 * journal filename contains the missionId (filename inference covers records
 * that lack mission attribution).
 */
export async function findIncompleteOperationsForMission(
  operationsDir: string,
  missionId: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<OperationSweepResult> {
  const result: OperationSweepResult = { incomplete: [], unreadableFiles: [] };
  if (!(await io.exists(operationsDir))) {
    return result;
  }

  const files = (await io.readdir(operationsDir)).filter((f) => f.name.endsWith(".jsonl"));
  for (const file of files) {
    const journalPath = path.join(operationsDir, file.name);
    let records: JournalRecord[];
    try {
      records = await readJournal(journalPath);
    } catch {
      result.unreadableFiles.push(file.name);
      continue;
    }

    const fileReferencesMission = referencesMissionId(file.name, missionId);
    const terminalOpIds = new Set(
      records.filter((r) => r.kind === "op-done" || r.kind === "op-abandoned").map((r) => r.opId),
    );

    for (const rec of records) {
      if (rec.kind !== "op-started") continue;
      const belongsToMission =
        rec.missionId === missionId ||
        referencesMissionId(rec.opId, missionId) ||
        fileReferencesMission;
      if (!belongsToMission || terminalOpIds.has(rec.opId)) continue;
      result.incomplete.push({ opId: rec.opId, op: rec.op, journalPath });
    }
  }

  return result;
}

/**
 * ADR-0084: append `op-abandoned` for every incomplete operation belonging to
 * `missionId` in `operationsDir`. Uses the same abandonOperation mechanism as a
 * manual abandon; the recorded reason is `mission closed: <missionId>`.
 */
export async function abandonIncompleteOperationsForMission(
  operationsDir: string,
  missionId: string,
): Promise<{ abandoned: IncompleteOperationRef[]; unreadableFiles: string[] }> {
  const scan = await findIncompleteOperationsForMission(operationsDir, missionId);
  for (const op of scan.incomplete) {
    await abandonOperation(op.journalPath, op.opId, `mission closed: ${missionId}`);
  }
  return { abandoned: scan.incomplete, unreadableFiles: scan.unreadableFiles };
}
