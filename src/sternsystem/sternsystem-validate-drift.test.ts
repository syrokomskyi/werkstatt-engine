/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1149 phase 1b: routeDriftDiagnostics routes generated.drift.validate
    diagnostics — DRIFT-02 (generator lacks dryRun support) becomes a blocking
    violation; DRIFT-01 (content drift) and other rules stay warnings per the
    ADR-0082 cleanup caveat.
  </purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1149: phase 1b — initial tests for DRIFT-02 promotion routing.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect } from "vitest";
import { routeDriftDiagnostics } from "./sternsystem-validate.ts";

describe("routeDriftDiagnostics (RFC-1149 phase 1b)", () => {
  it("routes DRIFT-02 to violations (blocking)", () => {
    const violations: Array<{ systemId: string; rule: string; message: string }> = [];
    const warnings: Array<{ systemId: string; field: string; message: string }> = [];

    routeDriftDiagnostics(
      [
        {
          ruleId: "DRIFT-02",
          file: "systems/acme/public/robots.txt",
          message: 'Generator "robots.generate" does not support dryRun mode.',
        },
      ],
      "acme",
      violations,
      warnings,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      systemId: "acme",
      rule: "DRIFT-02",
      message: 'Generator "robots.generate" does not support dryRun mode.',
    });
    expect(warnings).toHaveLength(0);
  });

  it("keeps DRIFT-01 in warnings (ADR-0082 cleanup caveat)", () => {
    const violations: Array<{ systemId: string; rule: string; message: string }> = [];
    const warnings: Array<{ systemId: string; field: string; message: string }> = [];

    routeDriftDiagnostics(
      [
        {
          ruleId: "DRIFT-01",
          file: "systems/acme/public/robots.txt",
          message: 'Committed file differs from generator "robots.generate" output.',
        },
      ],
      "acme",
      violations,
      warnings,
    );

    expect(violations).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      systemId: "acme",
      field: "DRIFT-01",
    });
  });

  it("falls back to DRIFT field and generic message when ruleId/message missing", () => {
    const violations: Array<{ systemId: string; rule: string; message: string }> = [];
    const warnings: Array<{ systemId: string; field: string; message: string }> = [];

    routeDriftDiagnostics([{ file: "systems/acme/x.txt" }], "acme", violations, warnings);

    expect(violations).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.field).toBe("DRIFT");
    expect(warnings[0]?.message).toContain("systems/acme/x.txt");
  });
});
