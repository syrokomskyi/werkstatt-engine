/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0086 regression tests for the text-mode failure diagnostics printer.
    Exercises all four precedence shapes (diagnostics / violations / findings
    / details), the 50-line cap, and the empty/missing fallback paths.
  </purpose>
  <responsibilities>
    <item>Pin the precedence order so a future refactor cannot silently swap it.</item>
    <item>Pin the indent prefix shape that the logger consumes.</item>
    <item>Pin the 50-line cap and the truncation footer.</item>
  </responsibilities>
  <non-goals>
    <item>Do not assert on logger console output here — that is logger.ts territory.</item>
  </non-goals>
</MODULE_CONTRACT>
*/

import { test, expect } from "vitest";
import { formatFailureDiagnostics } from "../runtime.ts";

test("formatFailureDiagnostics returns [] for non-object data", () => {
  expect(formatFailureDiagnostics(null)).toEqual([]);
  expect(formatFailureDiagnostics(undefined)).toEqual([]);
  expect(formatFailureDiagnostics(42)).toEqual([]);
});

test("formatFailureDiagnostics returns [] when no recognized array is present", () => {
  expect(formatFailureDiagnostics({ ok: false })).toEqual([]);
});

test("formatFailureDiagnostics: diagnostics[] (strings) wins over violations[]", () => {
  const lines = formatFailureDiagnostics({
    diagnostics: ["first remediation line"],
    violations: ["should not be picked"],
  });
  expect(lines).toEqual(["  first remediation line"]);
});

test("formatFailureDiagnostics: violations[] (objects) when diagnostics is absent", () => {
  const lines = formatFailureDiagnostics({
    violations: [{ ruleId: "OS-09", file: "apps/foo/", message: "exists" }],
  });
  expect(lines).toEqual(["  OS-09 · apps/foo/ · exists"]);
});

test("formatFailureDiagnostics: findings[] (RFC-0074 audit shape)", () => {
  const lines = formatFailureDiagnostics({
    findings: [{ ruleId: "PV-01", severity: "error", file: "dist/missing", message: "not found" }],
  });
  expect(lines).toEqual(["  PV-01 · dist/missing · not found"]);
});

test("formatFailureDiagnostics: details[] (generic shape)", () => {
  const lines = formatFailureDiagnostics({
    details: [{ file: "packages/x.yaml", message: "stale" }],
  });
  expect(lines).toEqual(["  packages/x.yaml · stale"]);
});

test("formatFailureDiagnostics: severity used when ruleId is missing", () => {
  const lines = formatFailureDiagnostics({
    findings: [{ severity: "warn", message: "tone slip" }],
  });
  expect(lines).toEqual(["  warn · tone slip"]);
});

test("formatFailureDiagnostics: RFC-0203 file:line:column locator", () => {
  const lines = formatFailureDiagnostics({
    diagnostics: [
      {
        ruleId: "KEL-01",
        severity: "error",
        file: "src/registry.ts",
        line: 472,
        column: 5,
        message: "drifted",
      },
    ],
  });
  expect(lines).toEqual(["  KEL-01 · src/registry.ts:472:5 · drifted"]);
});

test("formatFailureDiagnostics: RFC-0203 fixHint renders on its own indented line", () => {
  const lines = formatFailureDiagnostics({
    diagnostics: [
      {
        ruleId: "KEL-01",
        severity: "error",
        file: "src/registry.ts",
        line: 472,
        message: "drifted",
        fixHint: "run uni.registry.build",
      },
    ],
  });
  expect(lines).toEqual([
    "  KEL-01 · src/registry.ts:472 · drifted",
    "  fix: run uni.registry.build",
  ]);
});

test("formatFailureDiagnostics: RFC-0203 deterministic order (severity, file, line, ruleId)", () => {
  const lines = formatFailureDiagnostics({
    diagnostics: [
      { ruleId: "B", severity: "warning", file: "a.ts", line: 1, message: "w" },
      { ruleId: "A", severity: "error", file: "z.ts", line: 9, message: "e2" },
      { ruleId: "A", severity: "error", file: "a.ts", line: 2, message: "e1" },
    ],
  });
  expect(lines).toEqual(["  A · a.ts:2 · e1", "  A · z.ts:9 · e2", "  B · a.ts:1 · w"]);
});

test("formatFailureDiagnostics: multiline message keeps indent per line", () => {
  const lines = formatFailureDiagnostics({
    diagnostics: ["line one\nline two"],
  });
  expect(lines).toEqual(["  line one", "  line two"]);
});

test("formatFailureDiagnostics: 50-line cap with truncation footer", () => {
  const many = Array.from({ length: 73 }, (_, i) => `item ${i + 1}`);
  const lines = formatFailureDiagnostics({ diagnostics: many });
  expect(lines.length).toBe(51);
  expect(lines[0]).toBe("  item 1");
  expect(lines[49]).toBe("  item 50");
  expect(lines[50]).toBe("  … and 23 more (run with --json for the full list)");
});

test("formatFailureDiagnostics: exactly 50 items produces no footer", () => {
  const fifty = Array.from({ length: 50 }, (_, i) => `item ${i + 1}`);
  const lines = formatFailureDiagnostics({ diagnostics: fifty });
  expect(lines.length).toBe(50);
});

test("formatFailureDiagnostics: empty diagnostics array returns []", () => {
  expect(formatFailureDiagnostics({ diagnostics: [] })).toEqual([]);
});

test("formatFailureDiagnostics: object without recognized fields falls back to JSON", () => {
  const lines = formatFailureDiagnostics({
    details: [{ unknown: "shape" }],
  });
  expect(lines).toEqual(['  {"unknown":"shape"}']);
});

test("formatFailureDiagnostics: errors[] (string[]) is recognized", () => {
  const lines = formatFailureDiagnostics({
    errors: ["[metadata-write-failed] batch: File not found"],
  });
  expect(lines).toEqual(["  [metadata-write-failed] batch: File not found"]);
});

test("formatFailureDiagnostics: errors[] wins over details[] but not over diagnostics[]", () => {
  const lines = formatFailureDiagnostics({
    diagnostics: ["diag line"],
    errors: ["error line"],
    details: [{ file: "x", message: "detail" }],
  });
  expect(lines).toEqual(["  diag line"]);
});
