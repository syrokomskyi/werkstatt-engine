/*
<MODULE_CONTRACT>
  <purpose>jsonl — crash-safe JSONL reader and writer for the operation journal (RFC-0958).</purpose>
  <non-goals>
    <item>Do not implement step execution logic — that lives in runner.ts.</item>
    <item>Do not import mission-specific types — the journal is pure infrastructure.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial JSONL reader/writer — appendRecord, readJournal, findIncompleteOperation.</item>
  <item>RFC-1219: findIncompleteOperation scans all op-started newest→oldest and returns status/failedStep — a completed later op no longer masks an earlier incomplete one; op-interrupted is non-terminal.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import path from "node:path";
import type { JournalRecord } from "./types.ts";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export async function appendRecord(
  journalPath: string,
  record: JournalRecord,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const dir = path.dirname(journalPath);
  if (!(await io.exists(dir))) {
    await io.mkdir(dir);
  }
  const line = JSON.stringify(record) + "\n";
  await io.appendFile(journalPath, line);
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

export async function readJournal(
  journalPath: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<JournalRecord[]> {
  if (!(await io.exists(journalPath))) {
    return [];
  }
  const content = await io.readFile(journalPath);
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
      const isLastNonEmpty =
        i === lines.length - 1 || (i === lines.length - 2 && lines[lines.length - 1].length === 0);
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

export interface IncompleteOperation {
  opId: string;
  op: string;
  lastSeq: number;
  /**
   * RFC-1219: "interrupted" when the op recorded a step-failed or
   * op-interrupted marker (resumable failure) — "running" when the op is
   * open with no failure signal (in-flight or crashed mid-step).
   */
  status: "interrupted" | "running";
  /** Latest failed step for the op, when one was recorded. */
  failedStep?: string;
}

/**
 * RFC-1219: scans every op-started newest→oldest and returns the first op
 * without a terminal record (op-done / op-abandoned). op-interrupted is a
 * non-terminal marker and does not close an op. Previously only the last
 * op-started was inspected — a completed later op masked an earlier
 * incomplete one (warpgogol-m000192 class of failure).
 */
export function findIncompleteOperation(records: JournalRecord[]): IncompleteOperation | null {
  const terminalOpIds = new Set(
    records.filter((r) => r.kind === "op-done" || r.kind === "op-abandoned").map((r) => r.opId),
  );

  const opStarted = records.filter((r) => r.kind === "op-started");
  for (let i = opStarted.length - 1; i >= 0; i--) {
    const started = opStarted[i];
    if (terminalOpIds.has(started.opId)) {
      continue;
    }

    let lastSeq = -1;
    let failedStep: string | undefined;
    for (const r of records) {
      if (r.opId !== started.opId) continue;
      if (
        (r.kind === "step-started" ||
          r.kind === "step-done" ||
          r.kind === "step-failed" ||
          r.kind === "step-skipped") &&
        r.seq > lastSeq
      ) {
        lastSeq = r.seq;
      }
      if (r.kind === "step-failed" || r.kind === "op-interrupted") {
        failedStep = r.kind === "step-failed" ? r.step : r.failedStep;
      }
    }

    return {
      opId: started.opId,
      op: started.op,
      lastSeq,
      status: failedStep !== undefined ? "interrupted" : "running",
      ...(failedStep !== undefined ? { failedStep } : {}),
    };
  }

  return null;
}
