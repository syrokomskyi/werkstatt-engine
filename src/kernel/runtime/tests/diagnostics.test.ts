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
      findings: [{ ruleId: "PV-01", severity: "error", file: "dist/missing", message: "not found" }],
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
