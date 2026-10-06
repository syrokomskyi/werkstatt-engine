/*
<MODULE_CONTRACT>
<purpose>ADR-0092: passport staleness helpers — classify bordbuch drift as
bookkeeping-only (propagation records such as mirror-sync) versus
state-changing ledger activity. Used by sternsystem.passport.verify and
sternsystem.validate (PASSPORT-03) so that a sync run no longer marks a fresh
passport stale.</purpose>
<non-goals>
  <item>Does not read the bordbuch — callers pass entries from readBordbuch.</item>
  <item>Does not define a bordbuch entry-kind taxonomy — the bookkeeping set is a local constant until a schema-driven classification supersedes it.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0092: initial staleness helpers — BOOKKEEPING_BORDBUCH_KINDS, isBordbuchDriftBookkeepingOnly, dropTrailingBookkeepingEntries.</item>
  <item>RFC-1210: closed-loop signal ingest to bounded missions (RFC-1210)</item>
</CHANGE_SUMMARY>
*/

import type { BordbuchEntry, BordbuchEntryKind } from "@warpgogol/werkstatt-engine/schemas";

/**
 * ADR-0092: bordbuch kinds that record propagation of already-committed state
 * rather than a change to it. Deliberately fail-safe: kinds not listed here are
 * treated as state-changing, so a new bookkeeping kind must be added
 * explicitly or it will (correctly) stale passports.
 */
export const BOOKKEEPING_BORDBUCH_KINDS: ReadonlySet<BordbuchEntryKind> = new Set([
  "mirror-sync",
  // RFC-1210: remediation-mission records signal-triggered mission opens —
  // propagation/bookkeeping of an autonomy decision, not authored state change.
  "remediation-mission",
]);

/**
 * ADR-0092: true when every entry appended after `recordedHead` is a
 * bookkeeping kind — i.e. the ledger recorded propagation only, no state
 * change. A `null` recorded head means the passport predates the ledger, so
 * every entry counts as drift; the drift is bookkeeping-only iff all entries
 * are bookkeeping kinds. A recorded head that no longer resolves in the ledger
 * (rewritten history) fails safe: not bookkeeping-only.
 */
export function isBordbuchDriftBookkeepingOnly(
  entries: readonly BordbuchEntry[],
  recordedHead: string | null,
): boolean {
  if (recordedHead === null) {
    return entries.length > 0 && entries.every((e) => BOOKKEEPING_BORDBUCH_KINDS.has(e.kind));
  }
  const headIndex = entries.findIndex((e) => e.hash === recordedHead);
  if (headIndex === -1) {
    return false;
  }
  const tail = entries.slice(headIndex + 1);
  return tail.length > 0 && tail.every((e) => BOOKKEEPING_BORDBUCH_KINDS.has(e.kind));
}

/**
 * ADR-0092: return the ledger without its trailing run of bookkeeping entries —
 * the state-significant suffix. Used to evaluate drift rules (e.g. the
 * post-handover tolerance) on the entries that actually changed state.
 */
export function dropTrailingBookkeepingEntries(
  entries: readonly BordbuchEntry[],
): readonly BordbuchEntry[] {
  let end = entries.length;
  while (end > 0 && BOOKKEEPING_BORDBUCH_KINDS.has(entries[end - 1].kind)) {
    end -= 1;
  }
  return entries.slice(0, end);
}
