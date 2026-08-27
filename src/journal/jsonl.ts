/*
<MODULE_CONTRACT>
  <purpose>Crash-safe JSONL reader/writer for the operation journal (RFC-0958).</purpose>
  <non-goals>
    <item>Do not implement step execution logic — that lives in runner.ts.</item>
    <item>Do not import mission-specific types — the journal is pure infrastructure.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial JSONL reader/writer — appendRecord, readJournal, findIncompleteOperation.</item>
</CHANGE_SUMMARY>
*/

import { appendFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { JournalRecord } from "./types.ts";

export async function appendRecord(journalPath: string, record: JournalRecord): Promise<void> {
  const dir = path.dirname(journalPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const line = JSON.stringify(record) + "\n";
  await appendFile(journalPath, line, "utf8");
}

export class TornLineError extends Error {
  constructor(
    message: string,
    readonly lineNumber: number,
    readonly rawLine: string,
  ) {
    super(message);
    this.name = "TornLineError";
  }
}

export async function readJournal(journalPath: string): Promise<JournalRecord[]> {
  if (!existsSync(journalPath)) {
    return [];
  }
  const content = await readFile(journalPath, "utf8");
  if (content.length === 0) {
    return [];
  }
  const lines = content.split("\n");
  const records: JournalRecord[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) {
      if (i === lines.length - 1) {
        continue;
      }
      continue;
    }

    try {
      const parsed = JSON.parse(line) as JournalRecord;
      records.push(parsed);
    } catch {
      const isLastNonEmpty = i === lines.length - 1 || (i === lines.length - 2 && lines[lines.length - 1].length === 0);
      if (isLastNonEmpty) {
        throw new TornLineError(
          `Torn final line at journal line ${i + 1} — discard or inspect manually: ${line.slice(0, 80)}`,
          i + 1,
          line,
        );
      }
      throw new TornLineError(
        `Corrupt journal line ${i + 1} (not at EOF) — hard error, inspect manually: ${line.slice(0, 80)}`,
        i + 1,
        line,
      );
    }
  }

  return records;
}

export function findIncompleteOperation(
  records: JournalRecord[],
): { opId: string; op: string; lastSeq: number } | null {
  const opStarted = records.filter((r) => r.kind === "op-started");
  if (opStarted.length === 0) {
    return null;
  }

  const lastStarted = opStarted[opStarted.length - 1];
  const terminalForOp = records.filter(
    (r) =>
      (r.kind === "op-done" || r.kind === "op-abandoned") && r.opId === lastStarted.opId,
  );

  if (terminalForOp.length > 0) {
    return null;
  }

  const stepRecords = records.filter(
    (r) =>
      r.kind === "step-started" || r.kind === "step-done" || r.kind === "step-failed" || r.kind === "step-skipped",
  );
  const opStepRecords = stepRecords.filter((r) => r.opId === lastStarted.opId);

  let lastSeq = -1;
  for (const r of opStepRecords) {
    if (r.seq > lastSeq) {
      lastSeq = r.seq;
    }
  }

  return {
    opId: lastStarted.opId,
    op: lastStarted.op,
    lastSeq,
  };
}
