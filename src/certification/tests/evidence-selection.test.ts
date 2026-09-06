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
