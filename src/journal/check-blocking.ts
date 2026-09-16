/*
<MODULE_CONTRACT>
  <purpose>RFC-0958: shared helper for different-kind operation blocking — checks journal for incomplete operations of a different kind.</purpose>
<non-goals>
  <item>Do not evaluate checks — this module only reports whether a check is blocking.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial implementation — checkDifferentKindOperation helper.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { readJournal, findIncompleteOperation } from "./jsonl.ts";

export interface BlockedResult {
  blocked: true;
  incompleteOp: string;
  incompleteOpId: string;
}

export interface NotBlockedResult {
  blocked: false;
}

/**
 * RFC-0958 Step 7: Check if a different-kind operation is incomplete in the journal.
 * Returns a blocking result if a different-kind operation is found, or null if
 * no incomplete operation exists or the incomplete operation is the same kind.
 */
export async function checkDifferentKindOperation(
  journalPath: string,
  currentOp: string,
): Promise<BlockedResult | NotBlockedResult> {
  const records = await readJournal(journalPath);
  const incomplete = findIncompleteOperation(records);
  if (incomplete && incomplete.op !== currentOp) {
    return {
      blocked: true,
      incompleteOp: incomplete.op,
      incompleteOpId: incomplete.opId,
    };
  }
  return { blocked: false };
}
