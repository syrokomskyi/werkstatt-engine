/*
<MODULE_CONTRACT>
<purpose>
Unit tests for certification transition block covering buildCertificationTransitionBlock; isCertificationTransitionBlock. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the certification suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect } from "vitest";
import {
  buildCertificationTransitionBlock,
  isCertificationTransitionBlock,
} from "../certification/transition-block.ts";

describe("buildCertificationTransitionBlock", () => {
  it("returns a block with CERT-TRANSITION-01 diagnostic", () => {
    const block = buildCertificationTransitionBlock("leitstand.dev-deploy");
    expect(block.command).toBe("leitstand.dev-deploy");
    expect(block.status).toBe("incomplete");
    expect(block.requiredNode).toBe("CERT-007");
    expect(block.exitCode).toBe(1);
    expect(block.diagnostics).toHaveLength(1);
    expect(block.diagnostics[0]!.ruleId).toBe("CERT-TRANSITION-01");
    expect(block.diagnostics[0]!.severity).toBe("error");
    expect(block.diagnostics[0]!.message).toContain("certification transition");
    expect(block.diagnostics[0]!.fixHint).toContain("CERT-007");
  });

  it("preserves the command name for each leitstand handler", () => {
    const commands = [
      "leitstand.dev-deploy",
      "leitstand.propagate",
      "leitstand.promote",
      "leitstand.status",
      "leitstand.rollback",
      "leitstand.health",
      "leitstand.pipeline.check",
    ];
    for (const cmd of commands) {
      const block = buildCertificationTransitionBlock(cmd);
      expect(block.command).toBe(cmd);
    }
  });
});

describe("isCertificationTransitionBlock", () => {
  it("accepts a valid transition block", () => {
    const block = buildCertificationTransitionBlock("leitstand.dev-deploy");
    expect(isCertificationTransitionBlock(block)).toBe(true);
  });

  it("rejects null", () => {
    expect(isCertificationTransitionBlock(null)).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isCertificationTransitionBlock("string")).toBe(false);
    expect(isCertificationTransitionBlock(42)).toBe(false);
    expect(isCertificationTransitionBlock(undefined)).toBe(false);
  });

  it("rejects objects with wrong status", () => {
    const fake = {
      command: "leitstand.dev-deploy",
      status: "ok",
      diagnostics: [{ ruleId: "CERT-TRANSITION-01" }],
      requiredNode: "CERT-007",
      exitCode: 1,
    };
    expect(isCertificationTransitionBlock(fake)).toBe(false);
  });

  it("rejects objects with wrong requiredNode", () => {
    const fake = {
      command: "leitstand.dev-deploy",
      status: "incomplete",
      diagnostics: [{ ruleId: "CERT-TRANSITION-01" }],
      requiredNode: "CERT-006",
      exitCode: 1,
    };
    expect(isCertificationTransitionBlock(fake)).toBe(false);
  });

  it("rejects objects without CERT-TRANSITION-01 diagnostic", () => {
    const fake = {
      command: "leitstand.dev-deploy",
      status: "incomplete",
      diagnostics: [{ ruleId: "OTHER-01" }],
      requiredNode: "CERT-007",
      exitCode: 1,
    };
    expect(isCertificationTransitionBlock(fake)).toBe(false);
  });
});
