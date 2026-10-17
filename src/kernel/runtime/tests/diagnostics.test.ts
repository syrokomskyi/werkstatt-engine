/*
<MODULE_CONTRACT>
<purpose>
Unit tests for diagnostics covering formatFailureDiagnostics. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the diagnostics suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to kernel internals beyond the public surface under test

import { test, expect, describe } from "vitest";
import { formatFailureDiagnostics } from "../diagnostics.ts";

describe("formatFailureDiagnostics", () => {
  test("returns [] for null", () => {
    expect(formatFailureDiagnostics(null)).toEqual([]);
  });

  test("returns [] for undefined", () => {
    expect(formatFailureDiagnostics(undefined)).toEqual([]);
  });

  test("returns [] for non-object", () => {
    expect(formatFailureDiagnostics(42)).toEqual([]);
    expect(formatFailureDiagnostics("string")).toEqual([]);
  });

  test("returns [] when no recognized array is present", () => {
    expect(formatFailureDiagnostics({ ok: false })).toEqual([]);
  });

  test("diagnostics[] (strings) wins over violations[]", () => {
    const lines = formatFailureDiagnostics({
      diagnostics: ["first remediation line"],
      violations: ["should not be picked"],
    });
    expect(lines).toEqual(["  first remediation line"]);
  });

  test("violations[] (objects) when diagnostics is absent", () => {
    const lines = formatFailureDiagnostics({
      violations: [{ ruleId: "OS-09", file: "apps/foo/", message: "exists" }],
    });
    expect(lines).toEqual(["  OS-09 · apps/foo/ · exists"]);
  });

  test("findings[] (audit shape)", () => {
    const lines = formatFailureDiagnostics({
      findings: [
        { ruleId: "PV-01", severity: "error", file: "dist/missing", message: "not found" },
      ],
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("PV-01");
  });

  test("errors[] fallback", () => {
    const lines = formatFailureDiagnostics({
      errors: ["something went wrong"],
    });
    expect(lines).toEqual(["  something went wrong"]);
  });

  test("details[] fallback", () => {
    const lines = formatFailureDiagnostics({
      details: ["detail line 1"],
    });
    expect(lines).toEqual(["  detail line 1"]);
  });

  test("diagnostics[] of objects formats with ruleId, file, message", () => {
    const lines = formatFailureDiagnostics({
      diagnostics: [{ ruleId: "X-01", file: "src/a.ts", message: "bad" }],
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("X-01");
  });

  test("truncates at 50 lines", () => {
    const diagnostics = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    const lines = formatFailureDiagnostics({ diagnostics });
    expect(lines.length).toBeLessThanOrEqual(51);
  });
});
