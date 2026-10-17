/*
<MODULE_CONTRACT>
<purpose>
Unit tests for transition block covering buildCertificationTransitionBlock; isCertificationTransitionBlock. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the transition suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, describe } from "vitest";
import {
  buildCertificationTransitionBlock,
  isCertificationTransitionBlock,
} from "../transition-block.ts";

describe("buildCertificationTransitionBlock", () => {
  test("returns incomplete status with CERT-TRANSITION-01 diagnostic", () => {
    const result = buildCertificationTransitionBlock("site.deploy");
    expect(result.status).toBe("incomplete");
    expect(result.command).toBe("site.deploy");
    expect(result.requiredNode).toBe("CERT-007");
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.ruleId).toBe("CERT-TRANSITION-01");
    expect(result.diagnostics[0]!.severity).toBe("error");
  });

  test("includes fix hint in diagnostic", () => {
    const result = buildCertificationTransitionBlock("site.deploy");
    expect(result.diagnostics[0]!.fixHint).toContain("CERT-007");
  });
});

describe("isCertificationTransitionBlock", () => {
  test("returns true for a transition block result", () => {
    const result = buildCertificationTransitionBlock("site.deploy");
    expect(isCertificationTransitionBlock(result)).toBe(true);
  });

  test("returns false for null", () => {
    expect(isCertificationTransitionBlock(null)).toBe(false);
  });

  test("returns false for plain object without required fields", () => {
    expect(isCertificationTransitionBlock({ status: "incomplete" })).toBe(false);
  });

  test("returns false for object with wrong status", () => {
    expect(
      isCertificationTransitionBlock({
        status: "pass",
        requiredNode: "CERT-007",
        diagnostics: [{ ruleId: "CERT-TRANSITION-01" }],
      }),
    ).toBe(false);
  });

  test("returns false for object with wrong requiredNode", () => {
    expect(
      isCertificationTransitionBlock({
        status: "incomplete",
        requiredNode: "OTHER",
        diagnostics: [{ ruleId: "CERT-TRANSITION-01" }],
      }),
    ).toBe(false);
  });
});
