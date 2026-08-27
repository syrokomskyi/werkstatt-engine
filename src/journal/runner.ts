/*
<MODULE_CONTRACT>
  <purpose>Step runner for operation journal — executes OperationDefinitions with resume and skip semantics (RFC-0958).</purpose>
  <non-goals>
    <item>Do not implement mission-specific step logic — steps are defined in mission/steps/.</item>
    <item>Do not manage locks — the caller acquires and releases locks.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial step runner — runOperation, readJournal, findIncompleteOperation.</item>
</CHANGE_SUMMARY>
*/

import { appendRecord, readJournal, findIncompleteOperation } from "./jsonl.ts";
import type { JournalRecord, OperationDefinition, RunOperationResult } from "./types.ts";

export { readJournal, findIncompleteOperation };
export { appendRecord };
export { TornLineError } from "./jsonl.ts";

function nowIso(): string {
  return new Date().toISOString();
}

function generateOpId(op: string): string {
  const slug = op.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${slug}-${ts}`;
}

interface StepJournalState {
  doneSteps: Set<number>;
  crashStep: number | null;
}

function buildStepState(records: JournalRecord[], opId: string): StepJournalState {
  const doneSteps = new Set<number>();
  let crashStep: number | null = null;

  for (const r of records) {
    if (r.opId !== opId) continue;
    if (r.kind === "step-done") {
      doneSteps.add(r.seq);
    } else if (r.kind === "step-started") {
      if (!doneSteps.has(r.seq) && r.kind === "step-started") {
        const hasTerminal = records.some(
          (r2) =>
            r2.opId === opId &&
            (r2.kind === "step-done" || r2.kind === "step-failed" || r2.kind === "step-skipped") &&
            r2.seq === r.seq,
        );
        if (!hasTerminal) {
          crashStep = r.seq;
        }
      }
    }
  }

  return { doneSteps, crashStep };
}

export async function runOperation<C>(
  journalPath: string,
  def: OperationDefinition<C>,
  ctx: C,
  opts?: {
    resumeOpId?: string;
    missionId?: string;
    platformVersion?: string;
  },
): Promise<RunOperationResult> {
  const existingRecords = await readJournal(journalPath);
  const incomplete = findIncompleteOperation(existingRecords);

  let opId: string;
  let isResume = false;
  let stepState: StepJournalState = { doneSteps: new Set(), crashStep: null };

  if (opts?.resumeOpId) {
    opId = opts.resumeOpId;
    isResume = true;
    stepState = buildStepState(existingRecords, opId);
  } else if (incomplete && incomplete.op === def.op) {
    opId = incomplete.opId;
    isResume = true;
    stepState = buildStepState(existingRecords, opId);
  } else {
    opId = generateOpId(def.op);
    await appendRecord(journalPath, {
      kind: "op-started",
      opId,
      op: def.op,
      missionId: opts?.missionId ?? "",
      at: nowIso(),
      platformVersion: opts?.platformVersion ?? "",
    });
  }

  const skipped: string[] = [];
  const executed: string[] = [];

  for (let seq = 0; seq < def.steps.length; seq++) {
    const step = def.steps[seq];

    if (isResume && stepState.doneSteps.has(seq)) {
      skipped.push(step.name);
      continue;
    }

    if (isResume && stepState.crashStep === seq) {
      if (step.verify) {
        const verified = await step.verify(ctx);
        if (verified) {
          await appendRecord(journalPath, {
            kind: "step-skipped",
            opId,
            step: step.name,
            seq,
            at: nowIso(),
            reason: "resume",
          });
          skipped.push(step.name);
          continue;
        }
      }
    } else if (!isResume && step.verify) {
      const verified = await step.verify(ctx);
      if (verified) {
        await appendRecord(journalPath, {
          kind: "step-skipped",
          opId,
          step: step.name,
          seq,
          at: nowIso(),
          reason: "already-satisfied",
        });
        skipped.push(step.name);
        continue;
      }
    }

    await appendRecord(journalPath, {
      kind: "step-started",
      opId,
      step: step.name,
      seq,
      at: nowIso(),
    });

    try {
      await step.run(ctx);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await appendRecord(journalPath, {
        kind: "step-failed",
        opId,
        step: step.name,
        seq,
        at: nowIso(),
        error: errorMsg,
      });
      return {
        opId,
        completed: false,
        failedStep: step.name,
        failedStepError: errorMsg,
        skipped,
        executed,
      };
    }

    if (step.verify) {
      const verified = await step.verify(ctx);
      if (!verified) {
        await appendRecord(journalPath, {
          kind: "step-failed",
          opId,
          step: step.name,
          seq,
          at: nowIso(),
          error: `verify returned false after run for step "${step.name}"`,
        });
        return {
          opId,
          completed: false,
          failedStep: step.name,
          failedStepError: `verify returned false after run for step "${step.name}"`,
          skipped,
          executed,
        };
      }
    }

    await appendRecord(journalPath, {
      kind: "step-done",
      opId,
      step: step.name,
      seq,
      at: nowIso(),
    });
    executed.push(step.name);
  }

  await appendRecord(journalPath, {
    kind: "op-done",
    opId,
    at: nowIso(),
  });

  return {
    opId,
    completed: true,
    skipped,
    executed,
  };
}

export async function abandonOperation(
  journalPath: string,
  opId: string,
  reason: string,
): Promise<void> {
  await appendRecord(journalPath, {
    kind: "op-abandoned",
    opId,
    at: nowIso(),
    reason,
  });
}
