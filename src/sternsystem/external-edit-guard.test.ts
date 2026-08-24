/*
<MODULE_CONTRACT>
<purpose>RFC-0520: unit tests for evaluateExternalEditGate pure function.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0520: initial unit tests for Bordbuch-vs-git-log external edit guard.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { evaluateExternalEditGate } from "./external-edit-guard.ts";

const systemId = "test-system";

test("empty Bordbuch, empty git log → verdict: pass", () => {
  const result = evaluateExternalEditGate({
    systemId,
    bordbuchEntries: [],
    gitLogShas: [],
    rangeShas: [],
  });
  expect(result.verdict).toBe("pass");
  expect(result.violations).toHaveLength(0);
});

test("Bordbuch has reconcile SHA, git log matches → verdict: pass", () => {
  const result = evaluateExternalEditGate({
    systemId,
    bordbuchEntries: [{ type: "mission-reconcile", metadata: { commitSha: "abc123" } }],
    gitLogShas: ["abc123"],
    rangeShas: [],
  });
  expect(result.verdict).toBe("pass");
});

test("git log has SHA not in Bordbuch → verdict: fail, rule: external-edit-detected", () => {
  const result = evaluateExternalEditGate({
    systemId,
    bordbuchEntries: [{ type: "mission-reconcile", metadata: { commitSha: "abc123" } }],
    gitLogShas: ["abc123", "def456"],
    rangeShas: [],
  });
  expect(result.verdict).toBe("fail");
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0]!.rule).toBe("external-edit-detected");
  expect(result.violations[0]!.message).toContain("1 commit(s)");
  expect(result.violations[0]!.message).toContain("def456");
});

test("Bordbuch has reconcile entry with rangeShas, all SHAs accounted for → verdict: pass", () => {
  const result = evaluateExternalEditGate({
    systemId,
    bordbuchEntries: [
      { type: "mission-reconcile", metadata: { commitSha: "abc123", preReconcileSha: "pre000" } },
    ],
    gitLogShas: ["abc123", "range1", "range2"],
    rangeShas: ["range1", "range2"],
  });
  expect(result.verdict).toBe("pass");
});

test("git log has SHAs in range but also extra SHAs → verdict: fail", () => {
  const result = evaluateExternalEditGate({
    systemId,
    bordbuchEntries: [
      { type: "mission-reconcile", metadata: { commitSha: "abc123", preReconcileSha: "pre000" } },
    ],
    gitLogShas: ["abc123", "range1", "range2", "extra999"],
    rangeShas: ["range1", "range2"],
  });
  expect(result.verdict).toBe("fail");
  expect(result.violations[0]!.message).toContain("extra999");
});
