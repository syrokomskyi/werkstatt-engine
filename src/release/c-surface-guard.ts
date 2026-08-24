/*
<MODULE_CONTRACT>
<purpose>RFC-0520: pure C-surface regression guard extracted from release.prepare inline block.</purpose>
<non-goals>
  <item>Does not run surface.contract.validate — the caller gathers I/O and passes results.</item>
  <item>Does not change the error message or violation shape — purely structural extraction.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0520: initial extraction of C-surface regression guard as pure function.</item>
</CHANGE_SUMMARY>
*/

import type { GuardResult } from "../handoff/guards.ts";

export interface CSurfaceGuardInput {
  systemId: string;
  missionId: string;
  workspaceRoot: string;
  surfaceValidateResult: { exitCode: number; summary?: string };
  rfcId: string | null;
  breaksC: boolean;
}

export interface CSurfaceGuardResult extends GuardResult {
  metadata?: {
    surfaceSummary?: string;
    rfcId?: string | null;
    breaksC?: boolean;
  };
}

export function evaluateCSurfaceGate(input: CSurfaceGuardInput): CSurfaceGuardResult {
  const { surfaceValidateResult, rfcId, breaksC } = input;

  if (surfaceValidateResult.exitCode === 0) {
    return {
      verdict: "pass",
      violations: [],
      summary: "C-surface contract validation passed",
      metadata: { surfaceSummary: surfaceValidateResult.summary },
    };
  }

  if (breaksC) {
    return {
      verdict: "pass",
      violations: [],
      summary: `C-surface regression detected but breaksC: true declared in RFC ${rfcId ?? "(unknown)"}`,
      metadata: { surfaceSummary: surfaceValidateResult.summary, rfcId, breaksC: true },
    };
  }

  return {
    verdict: "fail",
    violations: [
      {
        rule: "c-surface-regression-without-breaksC",
        message: `[release.prepare] C-surface regression detected without breaksC: true in RFC ${rfcId ?? "(unknown)"}. Fix the regression or declare breaksC: true in the RFC.`,
      },
    ],
    summary: `C-surface regression blocked: breaksC not declared in RFC ${rfcId ?? "(unknown)"}`,
    metadata: { surfaceSummary: surfaceValidateResult.summary, rfcId, breaksC: false },
  };
}
