/*
<MODULE_CONTRACT>
  <purpose>Operation journal type definitions — JournalRecord, OperationStep, OperationDefinition (RFC-0958).</purpose>
  <non-goals>
    <item>Do not import mission-specific types — the journal is pure infrastructure.</item>
    <item>Do not implement journal I/O or step execution — those live in jsonl.ts and runner.ts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial journal type definitions — JournalRecord discriminated union, OperationStep, OperationDefinition.</item>
</CHANGE_SUMMARY>
*/

export type JournalRecord =
  | { kind: "op-started"; opId: string; op: string; missionId: string; at: string; platformVersion: string }
  | { kind: "step-started"; opId: string; step: string; seq: number; at: string }
  | { kind: "step-done"; opId: string; step: string; seq: number; at: string; meta?: Record<string, unknown> }
  | { kind: "step-failed"; opId: string; step: string; seq: number; at: string; error: string }
  | { kind: "step-skipped"; opId: string; step: string; seq: number; at: string; reason: "already-satisfied" | "resume" }
  | { kind: "op-done"; opId: string; at: string }
  | { kind: "op-abandoned"; opId: string; at: string; reason: string };

export interface OperationStep<C> {
  name: string;
  run(ctx: C): Promise<void>;
  verify?(ctx: C): Promise<boolean>;
}

export interface OperationDefinition<C> {
  op: string;
  steps: OperationStep<C>[];
}

export interface RunOperationResult {
  opId: string;
  completed: boolean;
  failedStep?: string;
  skipped: string[];
  executed: string[];
}
