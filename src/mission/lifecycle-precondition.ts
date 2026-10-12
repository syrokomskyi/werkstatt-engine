/*
<MODULE_CONTRACT>
<purpose>
  RFC-1263: shared lifecycle coverage predicate for mission.reconcile and
  mission.close. A mission may reconcile or close when EITHER the stored
  full-validation report is green OR the mission record carries a green
  fast-lane gate set (mission.content-edit). Both commands consult this one
  predicate — no per-command re-derivation.
</purpose>
<non-goals>
  <item>Do not weaken leitstand.ship — ship still runs full mission.validate
  before deploy phases; the fast lane only relaxes the pre-ship lifecycle
  precondition.</item>
  <item>Do not synthesize a validation report — fast-lane evidence lives in
  the mission manifest under fastLane; validation-report.json is only ever
  written by a real mission.validate run.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1263: initial predicate — contractFull.passed || fastLane.green.</item>
  <item>RFC-1263</item>
</CHANGE_SUMMARY>
*/

import type { MissionManifest } from "@warpgogol/werkstatt-engine/schemas";

/** Shape of evidence/validation-report.json fields the predicate consults. */
export interface MissionValidationReportLike {
  contractFull?: { passed?: boolean };
}

/**
 * True when the mission may reconcile/close: a green full-validation report,
 * or a green fast-lane gate record persisted by mission.content-edit.
 */
export function missionHasGreenCoverage(
  manifest: Pick<MissionManifest, "fastLane">,
  validationReport: MissionValidationReportLike | null,
): boolean {
  if (validationReport?.contractFull?.passed === true) return true;
  return manifest.fastLane?.green === true;
}
