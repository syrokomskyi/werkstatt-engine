/*
<MODULE_CONTRACT>
<purpose>RFC-0520: shared GuardResult types for extracted inline guards in release.prepare and sternsystem.validate.</purpose>
<non-goals>
  <item>Does not define gate metadata — that is RFC-0518.</item>
  <item>Does not unify with GateResult from @warpgogol/werkstatt-shared/surface — different semantics.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0520: initial shared guard types extracted from inline blocks.</item>
</CHANGE_SUMMARY>
*/

export type GuardVerdict = "pass" | "fail" | "skipped";

export interface GuardViolation {
  rule: string;
  message: string;
  systemId?: string;
}

export interface GuardResult {
  verdict: GuardVerdict;
  violations: GuardViolation[];
  summary: string;
  metadata?: Record<string, unknown>;
}
