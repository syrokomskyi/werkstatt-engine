/*
<MODULE_CONTRACT>
<purpose>RFC-0520: unit tests for evaluateCSurfaceGate pure function.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0520: initial unit tests for C-surface regression guard.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { evaluateCSurfaceGate } from "./c-surface-guard.ts";

const baseInput = {
  systemId: "test-system",
  missionId: "mission-001",
  workspaceRoot: "/tmp/test",
};

test("surface passes → verdict: pass", () => {
  const result = evaluateCSurfaceGate({
    ...baseInput,
    surfaceValidateResult: { exitCode: 0, summary: "ok" },
    rfcId: "RFC-0500",
    breaksC: false,
  });
  expect(result.verdict).toBe("pass");
  expect(result.violations).toHaveLength(0);
  expect(result.metadata?.surfaceSummary).toBe("ok");
});

test("surface fails, no RFC (rfcId: null) → verdict: fail", () => {
  const result = evaluateCSurfaceGate({
    ...baseInput,
    surfaceValidateResult: { exitCode: 1, summary: "regression" },
    rfcId: null,
    breaksC: false,
  });
  expect(result.verdict).toBe("fail");
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0]!.rule).toBe("c-surface-regression-without-breaksC");
  expect(result.violations[0]!.message).toContain("(unknown)");
});

test("surface fails, RFC without breaksC → verdict: fail", () => {
  const result = evaluateCSurfaceGate({
    ...baseInput,
    surfaceValidateResult: { exitCode: 1, summary: "regression" },
    rfcId: "RFC-0500",
    breaksC: false,
  });
  expect(result.verdict).toBe("fail");
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0]!.message).toContain("RFC-0500");
});

test("surface fails, RFC with breaksC: true → verdict: pass", () => {
  const result = evaluateCSurfaceGate({
    ...baseInput,
    surfaceValidateResult: { exitCode: 1, summary: "regression" },
    rfcId: "RFC-0500",
    breaksC: true,
  });
  expect(result.verdict).toBe("pass");
  expect(result.violations).toHaveLength(0);
  expect(result.summary).toContain("breaksC: true");
  expect(result.metadata?.breaksC).toBe(true);
});
