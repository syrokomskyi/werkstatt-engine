/*
<MODULE_CONTRACT>
  <purpose>RFC-0958: mission.journal.show — inspect the operation journal for a mission.</purpose>
  <non-goals>
    <item>Do not modify the journal — read-only command.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial mission.journal.show command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { resolveMissionDir } from "./mission-io.ts";
import { readJournal, findIncompleteOperation } from "../journal/index.ts";
import path from "node:path";

export interface MissionJournalShowData {
  missionId: string;
  records: unknown[];
  incompleteOperation: { opId: string; op: string; lastSeq: number } | null;
}

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  const v = input.flags[key];
  return v === true || v === "true";
}

export async function runMissionJournalShow(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<MissionJournalShowData>> {
  const { workspaceRoot } = context;
  const missionId = flagString(input, "mission");
  if (!missionId) {
    return {
      exitCode: 1,
      summary: "[mission.journal.show] --mission is required",
    };
  }

  const missionDir = resolveMissionDir(workspaceRoot, missionId);
  const journalPath = path.join(missionDir, "journal.jsonl");
  const opFilter = flagString(input, "op");
  const json = flagBool(input, "json");

  const allRecords = await readJournal(journalPath);
  const records = opFilter
    ? allRecords.filter((r) => "opId" in r && r.opId === opFilter)
    : allRecords;
  const incomplete = findIncompleteOperation(allRecords);

  if (json) {
    return {
      data: { missionId, records, incompleteOperation: incomplete },
      exitCode: 0,
      summary: `[mission.journal.show] ${records.length} records for ${missionId}`,
    };
  }

  const lines: string[] = [];
  for (const r of records) {
    const rec = r as Record<string, unknown>;
    const seq = rec.seq !== undefined ? ` seq=${rec.seq}` : "";
    const step = rec.step ? ` step=${rec.step}` : "";
    const error = rec.error ? ` error="${rec.error}"` : "";
    lines.push(`  ${rec.kind}${seq}${step}${error}`);
  }

  const incompleteSummary = incomplete
    ? `\n  incomplete: ${incomplete.op} (${incomplete.opId}) at seq ${incomplete.lastSeq}`
    : "\n  no incomplete operation";

  return {
    data: { missionId, records, incompleteOperation: incomplete },
    exitCode: 0,
    summary: `[mission.journal.show] ${missionId} — ${records.length} records${incompleteSummary}\n${lines.join("\n")}`,
  };
}
