/*
<MODULE_CONTRACT>
  <purpose>Step runner for operation journal — executes OperationDefinitions with resume and skip semantics (RFC-0958).</purpose>
  <non-goals>
    <item>Do not implement mission-specific step logic — steps are defined in mission/steps/.</item>
    <item>Do not manage locks — the caller acquires and releases locks.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0962 fo-fix: step metadata capture (run returns Record), per-step durationMs timing, StepResult[] in RunOperationResult, step-done meta field populated.</item>
  <item>RFC-1168: onTransition option on runOperation — per-record callback so callers can stream progress (stderr) without waiting for run completion.</item>
  <item>RFC-1168: ship stderr progress + leitstand.ship.status reader</item>
  <item>2026-10-04 recovery fix: buildStepState keys done/crash tracking on step name instead of seq index — a resumed plan with filtered steps (e.g. buildShipPlan missionClosed drops 3 lifecycle steps) shifted every later seq and would skip unexecuted steps or re-run done ones; step names are stable across plan shapes. Also adds getActiveOpIds() — the in-process set of currently-running opIds — so mission.close's ADR-0084 sweep can exclude the journal of the very operation it is invoked from (observed: ship op self-abandoned mid-run, breaking --resume).</item>
  <item>RFC-1219: op-interrupted record appended on step failure — explicit non-terminal resumable marker; findIncompleteOperation scans all op-started newest→oldest (a completed later op no longer masks an earlier incomplete one).</item>
  <item>RFC-1190: restore mission context + evidence archival in release-mode deploys

RFC-1190: precedence-ordered resolveMissionContext (--mission → release build-identity → currentMission), MISSION_CONTEXT_UNRESOLVED/MISMATCH blocking, fail-closed EVIDENCE_SYNC_FAILED with --skip-evidence-sync as sole escape hatch, journaled evidence-sync-* ship steps after each certify-*, evidence.sync --site/--system flag.

2026-10-04 handoff fixes: shared 25min mission.check timeout (inner 5min race + 300s orchestrator raced cold ~7-11min captures), sweep excludeOpIds so mission.close no longer self-abandons the live ship journal (broke --resume), name-keyed journal resume state so closed-mission plan shifts can't skip unexecuted steps, wrangler dev documented as the required --base-url preview server.</item>
  <history>RFC-0958</history>
</CHANGE_SUMMARY>
*/

import { appendRecord, readJournal, findIncompleteOperation } from "./jsonl.ts";
import type {
  JournalRecord,
  OperationDefinition,
  RunOperationResult,
  StepResult,
} from "./types.ts";

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
  doneSteps: Set<string>;
  crashStepName: string | null;
}

/**
 * Reconstruct step state for resume — keyed on step NAME, not seq index.
 * Plans may change shape between runs (e.g. buildShipPlan filters lifecycle
 * steps for closed missions, shifting every later seq); names survive that.
 * A step counts as crashed when its latest step-started has no following
 * terminal record (step-done/step-failed/step-skipped) for the same name.
 */
function buildStepState(records: JournalRecord[], opId: string): StepJournalState {
  const doneSteps = new Set<string>();
  const openStepNames: string[] = [];

  for (const r of records) {
    if (r.opId !== opId) continue;
    if (r.kind === "step-started") {
      openStepNames.push(r.step);
    } else if (r.kind === "step-done" || r.kind === "step-failed" || r.kind === "step-skipped") {
      if (r.kind === "step-done") doneSteps.add(r.step);
      const i = openStepNames.lastIndexOf(r.step);
      if (i !== -1) openStepNames.splice(i, 1);
    }
  }

  return { doneSteps, crashStepName: openStepNames[openStepNames.length - 1] ?? null };
}

/**
 * OpIds currently executing inside this process. The ADR-0084 mission sweep
 * must skip these: a sweep invoked from inside a running operation (e.g.
 * mission.close as a leitstand.ship step) must not append op-abandoned to the
 * journal its caller is still writing to — that would mark the live op
 * terminal and break --resume.
 */
const activeOpIds = new Set<string>();

export function getActiveOpIds(): ReadonlySet<string> {
  return activeOpIds;
}

export async function runOperation<C>(
  journalPath: string,
  def: OperationDefinition<C>,
  ctx: C,
  opts?: {
    resumeOpId?: string;
    missionId?: string;
    platformVersion?: string;
    // RFC-1168: invoked after each record append — lets callers stream
    // progress (e.g. stderr lines) while the operation is still running.
    onTransition?: (record: JournalRecord) => void;
  },
): Promise<RunOperationResult> {
  const onTransition = opts?.onTransition;
  const append = async (record: JournalRecord): Promise<void> => {
    await appendRecord(journalPath, record);
    try {
      onTransition?.(record);
    } catch {
      // Progress hooks are informational — a failing emitter must not break
      // the operation being journaled.
    }
  };

  const existingRecords = await readJournal(journalPath);
  const incomplete = findIncompleteOperation(existingRecords);

  let opId: string;
  let isResume = false;
  let stepState: StepJournalState = { doneSteps: new Set(), crashStepName: null };

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
    await append({
      kind: "op-started",
      opId,
      op: def.op,
      missionId: opts?.missionId ?? "",
      at: nowIso(),
      platformVersion: opts?.platformVersion ?? "",
    });
  }

  activeOpIds.add(opId);

  const skipped: string[] = [];
  const executed: string[] = [];
  const stepResults: StepResult[] = [];

  try {
    for (let seq = 0; seq < def.steps.length; seq++) {
      const step = def.steps[seq];

      if (isResume && stepState.doneSteps.has(step.name)) {
        skipped.push(step.name);
        stepResults.push({ step: step.name, status: "skipped", durationMs: 0 });
        continue;
      }

      if (isResume && stepState.crashStepName === step.name) {
        if (step.verify) {
          const verified = await step.verify(ctx);
          if (verified) {
            await append({
              kind: "step-skipped",
              opId,
              step: step.name,
              seq,
              at: nowIso(),
              reason: "resume",
            });
            skipped.push(step.name);
            stepResults.push({ step: step.name, status: "skipped", durationMs: 0 });
            continue;
          }
        }
      } else if (!isResume && step.verify) {
        const verified = await step.verify(ctx);
        if (verified) {
          await append({
            kind: "step-skipped",
            opId,
            step: step.name,
            seq,
            at: nowIso(),
            reason: "already-satisfied",
          });
          skipped.push(step.name);
          stepResults.push({ step: step.name, status: "skipped", durationMs: 0 });
          continue;
        }
      }

      await append({
        kind: "step-started",
        opId,
        step: step.name,
        seq,
        at: nowIso(),
      });

      const stepStart = Date.now();
      let stepMeta: Record<string, unknown> | undefined;
      try {
        const runResult = await step.run(ctx);
        if (runResult && typeof runResult === "object") {
          stepMeta = runResult;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - stepStart;
        await append({
          kind: "step-failed",
          opId,
          step: step.name,
          seq,
          at: nowIso(),
          error: errorMsg,
        });
        // RFC-1219: explicit interrupted marker — non-terminal, the op stays
        // resumable; tooling (ship.status, journal.show) can distinguish a
        // failed-resumable op from an in-flight/crashed one.
        await append({
          kind: "op-interrupted",
          opId,
          at: nowIso(),
          failedStep: step.name,
        });
        stepResults.push({ step: step.name, status: "failed", durationMs });
        return {
          opId,
          completed: false,
          failedStep: step.name,
          failedStepError: errorMsg,
          skipped,
          executed,
          stepResults,
        };
      }

      if (step.verify) {
        const verified = await step.verify(ctx);
        if (!verified) {
          await append({
            kind: "step-failed",
            opId,
            step: step.name,
            seq,
            at: nowIso(),
            error: `verify returned false after run for step "${step.name}"`,
          });
          await append({
            kind: "op-interrupted",
            opId,
            at: nowIso(),
            failedStep: step.name,
          });
          stepResults.push({
            step: step.name,
            status: "failed",
            durationMs: Date.now() - stepStart,
          });
          return {
            opId,
            completed: false,
            failedStep: step.name,
            failedStepError: `verify returned false after run for step "${step.name}"`,
            skipped,
            executed,
            stepResults,
          };
        }
      }

      const durationMs = Date.now() - stepStart;
      await append({
        kind: "step-done",
        opId,
        step: step.name,
        seq,
        at: nowIso(),
        ...(stepMeta ? { meta: stepMeta } : {}),
      });
      executed.push(step.name);
      stepResults.push({
        step: step.name,
        status: "done",
        durationMs,
        ...(stepMeta ? { meta: stepMeta } : {}),
      });
    }

    await append({
      kind: "op-done",
      opId,
      at: nowIso(),
    });

    return {
      opId,
      completed: true,
      skipped,
      executed,
      stepResults,
    };
  } finally {
    activeOpIds.delete(opId);
  }
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
