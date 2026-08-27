/*
<MODULE_CONTRACT>
  <purpose>RFC-0958: shared helper for different-kind operation blocking — checks journal for incomplete operations of a different kind.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0958: initial implementation — checkDifferentKindOperation helper.</item>
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
