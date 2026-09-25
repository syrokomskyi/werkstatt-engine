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
    bordbuchEntries: [{ kind: "mission-reconcile", metadata: { commitSha: "abc123" } }],
    gitLogShas: ["abc123"],
    rangeShas: [],
  });
  expect(result.verdict).toBe("pass");
});

test("git log has SHA not in Bordbuch → verdict: fail, rule: external-edit-detected", () => {
  const result = evaluateExternalEditGate({
    systemId,
    bordbuchEntries: [{ kind: "mission-reconcile", metadata: { commitSha: "abc123" } }],
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
      { kind: "mission-reconcile", metadata: { commitSha: "abc123", preReconcileSha: "pre000" } },
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
      { kind: "mission-reconcile", metadata: { commitSha: "abc123", preReconcileSha: "pre000" } },
    ],
    gitLogShas: ["abc123", "range1", "range2", "extra999"],
    rangeShas: ["range1", "range2"],
  });
  expect(result.verdict).toBe("fail");
  expect(result.violations[0]!.message).toContain("extra999");
});

// ADR-0091: externalEditBaselineSha grandfathering

test("baseline SHA grandfathers itself and all older commits → verdict: pass", () => {
  const result = evaluateExternalEditGate({
    systemId,
    bordbuchEntries: [{ kind: "mission-reconcile", metadata: { commitSha: "new001" } }],
    // rev-list order: newest-first — old001..old003 pre-date Bordbuch tracing
    gitLogShas: ["new001", "base00", "old001", "old002", "old003"],
    rangeShas: [],
    externalEditBaselineSha: "base00",
  });
  expect(result.verdict).toBe("pass");
  expect(result.violations).toHaveLength(0);
});

test("baseline SHA with newer untraced commit → fail reports only the newer commit", () => {
  const result = evaluateExternalEditGate({
    systemId,
    bordbuchEntries: [{ kind: "mission-reconcile", metadata: { commitSha: "new001" } }],
    gitLogShas: ["untraced", "new001", "base00", "old001", "old002"],
    rangeShas: [],
    externalEditBaselineSha: "base00",
  });
  expect(result.verdict).toBe("fail");
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0]!.rule).toBe("external-edit-detected");
  expect(result.violations[0]!.message).toContain("1 commit(s)");
  expect(result.violations[0]!.message).toContain("untraced");
  expect(result.violations[0]!.message).not.toContain("old001");
});

test("baseline SHA as newest commit → entire history grandfathered → verdict: pass", () => {
  const result = evaluateExternalEditGate({
    systemId,
    bordbuchEntries: [],
    gitLogShas: ["base00", "old001", "old002"],
    rangeShas: [],
    externalEditBaselineSha: "base00",
  });
  expect(result.verdict).toBe("pass");
});

test("baseline SHA absent from rev-list → external-edit-baseline-missing violation", () => {
  const result = evaluateExternalEditGate({
    systemId,
    bordbuchEntries: [{ kind: "mission-reconcile", metadata: { commitSha: "abc123" } }],
    gitLogShas: ["abc123"],
    rangeShas: [],
    externalEditBaselineSha: "missing0",
  });
  expect(result.verdict).toBe("fail");
  expect(result.violations).toHaveLength(1);
  expect(result.violations[0]!.rule).toBe("external-edit-baseline-missing");
  expect(result.violations[0]!.message).toContain("missing0");
});

test("no baseline → untraced legacy history still flagged (unchanged behavior)", () => {
  const result = evaluateExternalEditGate({
    systemId,
    bordbuchEntries: [{ kind: "mission-reconcile", metadata: { commitSha: "abc123" } }],
    gitLogShas: ["abc123", "legacy1", "legacy2"],
    rangeShas: [],
  });
  expect(result.verdict).toBe("fail");
  expect(result.violations[0]!.rule).toBe("external-edit-detected");
  expect(result.violations[0]!.message).toContain("2 commit(s)");
});
