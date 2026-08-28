/*
<MODULE_CONTRACT>
  <purpose>Barrel exports for the e2e cold run command (RFC-0965).</purpose>
  <non-goals>
    <item>Do not re-export Node-only modules — this barrel may be imported by client-side code.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0965: initial barrel exporting ColdRunReport, ColdRunStep, ColdRunPhase, and runColdE2e.</item>
</CHANGE_SUMMARY>
*/

export { runColdE2e } from "./cold.ts";
export type { ColdRunReport, ColdRunStep, ColdRunPhase } from "./cold.ts";
