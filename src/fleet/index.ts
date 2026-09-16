/*
<MODULE_CONTRACT>
  <purpose>fleet index — barrel exports for the fleet module command family (RFC-0964).</purpose>
  <non-goals>
    <item>Do not re-export kernel types — consumers import those from @warpgogol/werkstatt-engine/kernel.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0964: initial barrel — runFleetSitesGenerate, validateFleetSitesDrift, FleetSiteRecord, createFleetModule.</item>
  <item>RFC-0967: add registerOwnership, verifyOwnership, transferOwnership, deriveInstanceId, OwnershipError, OwnershipClaim, RegisterResult, VerifyResult, TransferResult.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export {
  runFleetSitesGenerate,
  validateFleetSitesDrift,
  type FleetSiteRecord,
} from "./fleet-sites-generate.ts";
export { runFleetApply, type FleetApplyResult, type FleetApplyReportEntry } from "./apply.ts";
export {
  registerOwnership,
  verifyOwnership,
  transferOwnership,
  deriveInstanceId,
  OwnershipError,
  type OwnershipClaim,
  type RegisterResult,
  type VerifyResult,
  type TransferResult,
} from "./ownership-registry.ts";
export { createFleetModule } from "./fleet.module.ts";
