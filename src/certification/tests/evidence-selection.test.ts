/*
<MODULE_CONTRACT>
<purpose>
Unit tests for evidence selection covering EVIDENCE_SELECTION_LIMITS; buildEvidenceIndex. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the evidence suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe } from "vitest";
import { buildEvidenceIndex, EVIDENCE_SELECTION_LIMITS } from "../evidence-selection.ts";

describe("EVIDENCE_SELECTION_LIMITS", () => {
  test("has MAX_REQUIREMENTS", () => {
    expect(EVIDENCE_SELECTION_LIMITS.MAX_REQUIREMENTS).toBeGreaterThan(0);
  });

  test("has MAX_EVIDENCE", () => {
    expect(EVIDENCE_SELECTION_LIMITS.MAX_EVIDENCE).toBeGreaterThan(0);
  });
});

describe("buildEvidenceIndex", () => {
  test("returns empty index for no evidence", () => {
    const result = buildEvidenceIndex({
      candidateId: "cand-001",
      evidence: [],
      evaluationCutSequence: 1,
    });
    expect("ok" in result && result.ok === false).toBe(false);
    if ("ok" in result) return;
    expect(result.totalCount).toBe(0);
    expect(result.candidateId).toBe("cand-001");
  });
});
