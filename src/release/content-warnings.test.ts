/*
<MODULE_CONTRACT>
<purpose>
Unit tests for content warnings covering computeContentWarnings (RFC-1296). It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the content suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

// @vitest-environment node
/*
 * RFC-1296 AC-5: computeContentWarnings — per-rule warning budget with
 * previous-release deltas; only content-contract validators contribute.
 */
import { describe, it, expect } from "vitest";

import { computeContentWarnings, type ValidationReportLike } from "./content-warnings.ts";

const CONTRACTS: Record<string, string> = {
  "text.corpus.validate": "text-corpus",
  "typography.validate": "typography",
  "list.punctuation.validate": "list-punctuation",
  "surface-quality.validate": "surface",
  "dist.coverage.validate": "dist",
  "build.compile": "build", // not a content contract
};
const contractOf = (cmd: string) => CONTRACTS[cmd];

function report(
  validators: Array<{ name: string; rules?: Record<string, { error: number; warning: number }> }>,
): ValidationReportLike {
  return { contractFull: { validators } };
}

describe("computeContentWarnings (RFC-1296)", () => {
  it("accumulates warnings per rule and flags increases vs previous release", () => {
    const current = report([
      {
        name: "typography.validate",
        rules: { "TERMS-DRIFT-01": { error: 0, warning: 12 } },
      },
      { name: "text.corpus.validate", rules: { "TERM-04": { error: 0, warning: 1 } } },
      { name: "build.compile", rules: { "BUILD-01": { error: 0, warning: 9 } } }, // ignored
    ]);
    const previous = report([
      {
        name: "typography.validate",
        rules: { "TERMS-DRIFT-01": { error: 0, warning: 9 } },
      },
      { name: "text.corpus.validate", rules: { "TERM-04": { error: 0, warning: 1 } } },
    ]);

    const cw = computeContentWarnings(current, previous, contractOf, "r000038", "r000037");
    expect(cw.schema).toBe("werkstatt/content-warnings@1");
    expect(cw.rules["TERMS-DRIFT-01"]).toEqual({
      warning: 12,
      error: 0,
      previous: 9,
      delta: 3,
    });
    expect(cw.rules["TERM-04"]).toEqual({ warning: 1, error: 0, previous: 1, delta: 0 });
    expect(cw.increased).toEqual(["TERMS-DRIFT-01"]);
    expect(cw.rules["BUILD-01"]).toBeUndefined();
  });

  it("handles missing previous release — previous/delta null, nothing increased", () => {
    const cw = computeContentWarnings(
      report([{ name: "typography.validate", rules: { "TYPO-01": { error: 0, warning: 4 } } }]),
      null,
      contractOf,
      "r000001",
      null,
    );
    expect(cw.previousReleaseId).toBeNull();
    expect(cw.rules["TYPO-01"]).toEqual({ warning: 4, error: 0, previous: null, delta: null });
    expect(cw.increased).toEqual([]);
  });

  it("shrinking or flat warnings are not increased", () => {
    const cw = computeContentWarnings(
      report([{ name: "typography.validate", rules: { "TYPO-01": { error: 0, warning: 2 } } }]),
      report([{ name: "typography.validate", rules: { "TYPO-01": { error: 0, warning: 5 } } }]),
      contractOf,
      "r000038",
      "r000037",
    );
    expect(cw.rules["TYPO-01"]!.delta).toBe(-3);
    expect(cw.increased).toEqual([]);
  });
});
