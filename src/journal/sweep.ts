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

import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { appendRecord, readJournal } from "./jsonl.ts";
import { abandonOperation } from "./runner.ts";

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
): Promise<OperationSweepResult> {
  const result: OperationSweepResult = { incomplete: [], unreadableFiles: [] };
  if (!existsSync(operationsDir)) {
    return result;
  }

  const files = (await readdir(operationsDir)).filter((f) => f.endsWith(".jsonl"));
  for (const file of files) {
    const journalPath = path.join(operationsDir, file);
    let records;
    try {
      records = await readJournal(journalPath);
    } catch {
      result.unreadableFiles.push(file);
      continue;
    }

    const fileReferencesMission = file.includes(missionId);
    const terminalOpIds = new Set(
      records
        .filter((r) => r.kind === "op-done" || r.kind === "op-abandoned")
        .map((r) => r.opId),
    );

    for (const rec of records) {
      if (rec.kind !== "op-started") continue;
      const belongsToMission =
        rec.missionId === missionId ||
        rec.opId.includes(missionId) ||
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
