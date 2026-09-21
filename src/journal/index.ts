/*
<MODULE_CONTRACT>
  <purpose>journal index — barrel exports for the operation journal module (RFC-0958).</purpose>
  <non-goals>
    <item>Do not re-export mission-specific types or logic.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial barrel exports for journal module.</item>
  <item>RFC-0962 fo-fix: export StepResult type from barrel.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export type {
  JournalRecord,
  OperationStep,
  OperationDefinition,
  RunOperationResult,
  StepResult,
} from "./types.ts";
export { appendRecord, readJournal, findIncompleteOperation, TornLineError } from "./jsonl.ts";
export { runOperation, abandonOperation } from "./runner.ts";
export {
  findIncompleteOperationsForMission,
  abandonIncompleteOperationsForMission,
  type IncompleteOperationRef,
  type OperationSweepResult,
} from "./sweep.ts";
export {
  checkDifferentKindOperation,
  type BlockedResult,
  type NotBlockedResult,
} from "./check-blocking.ts";
