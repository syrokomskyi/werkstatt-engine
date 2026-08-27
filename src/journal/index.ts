/*
<MODULE_CONTRACT>
  <purpose>Barrel exports for the operation journal module (RFC-0958).</purpose>
  <non-goals>
    <item>Do not re-export mission-specific types or logic.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial barrel exports for journal module.</item>
</CHANGE_SUMMARY>
*/

export type {
  JournalRecord,
  OperationStep,
  OperationDefinition,
  RunOperationResult,
} from "./types.ts";
export { appendRecord, readJournal, findIncompleteOperation, TornLineError } from "./jsonl.ts";
export { runOperation, abandonOperation } from "./runner.ts";
export {
  checkDifferentKindOperation,
  type BlockedResult,
  type NotBlockedResult,
} from "./check-blocking.ts";
