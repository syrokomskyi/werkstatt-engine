/*
<MODULE_CONTRACT>
  <purpose>Barrel exports for the fleet module (RFC-0964).</purpose>
  <non-goals>
    <item>Do not re-export kernel types — consumers import those from @warpgogol/werkstatt-engine/kernel.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0964: initial barrel — runFleetSitesGenerate, validateFleetSitesDrift, FleetSiteRecord, createFleetModule.</item>
</CHANGE_SUMMARY>
*/

export { runFleetSitesGenerate, validateFleetSitesDrift, type FleetSiteRecord } from "./fleet-sites-generate.ts";
export { runFleetApply, type FleetApplyResult, type FleetApplyReportEntry } from "./apply.ts";
export { createFleetModule } from "./fleet.module.ts";
