/*
<MODULE_CONTRACT>
<purpose>
RFC-0564: Property-based tests for the G-Set genome log merge operation.
Verifies commutativity, associativity, and idempotency properties of
mergeGenomeLogs using fast-check.
</purpose>
<non-goals>
  <item>Do not test command handlers — those are integration tests.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0564: initial implementation — G-Set merge property-based tests.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { mergeGenomeLogs } from "./genome-log.ts";
import type { GenomeLogEntry } from "./types.ts";

const entryArbitrary = fc.record({
  workshopId: fc.string({ minLength: 1, maxLength: 20 }),
  event: fc.constantFrom("alive", "suspect", "dead", "left"),
  timestamp: fc.string({ minLength: 1, maxLength: 30 }),
  source: fc.string({ minLength: 1, maxLength: 20 }),
  signature: fc.string({ minLength: 1, maxLength: 40 }),
});

const logArbitrary = fc.array(entryArbitrary, { maxLength: 20 });

function sameEntries(a: GenomeLogEntry[], b: GenomeLogEntry[]): boolean {
  if (a.length !== b.length) return false;
  const aIds = new Set(a.map((e) => `${e.workshopId}|${e.event}|${e.timestamp}|${e.source}`));
  const bIds = new Set(b.map((e) => `${e.workshopId}|${e.event}|${e.timestamp}|${e.source}`));
  if (aIds.size !== bIds.size) return false;
  for (const id of aIds) {
    if (!bIds.has(id)) return false;
  }
  return true;
}

describe("mergeGenomeLogs properties (G-Set)", () => {
  it("commutativity: merge(a, b) == merge(b, a)", () => {
    fc.assert(
      fc.property(logArbitrary, logArbitrary, (a, b) => {
        const mergeAB = mergeGenomeLogs(a, b);
        const mergeBA = mergeGenomeLogs(b, a);
        expect(sameEntries(mergeAB, mergeBA)).toBe(true);
      }),
    );
  });

  it("associativity: merge(merge(a, b), c) == merge(a, merge(b, c))", () => {
    fc.assert(
      fc.property(logArbitrary, logArbitrary, logArbitrary, (a, b, c) => {
        const mergeAB_C = mergeGenomeLogs(mergeGenomeLogs(a, b), c);
        const mergeA_BC = mergeGenomeLogs(a, mergeGenomeLogs(b, c));
        expect(sameEntries(mergeAB_C, mergeA_BC)).toBe(true);
      }),
    );
  });

  it("idempotency: merge(a, a) == a", () => {
    fc.assert(
      fc.property(logArbitrary, (a) => {
        const merged = mergeGenomeLogs(a, a);
        expect(sameEntries(merged, a)).toBe(true);
      }),
    );
  });
});
