/*
<MODULE_CONTRACT>
<purpose>Compass inventory scanning logic. Canonical implementation now lives
in @warpgogol/forge/os/compass/handlers/compass-inventory.ts (RFC-0556 dependency inversion).
This file re-exports it for imports from @warpgogol/werkstatt-engine/kernel.</purpose>
<non-goals>
  <item>Do not duplicate the implementation — always re-export from forge.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0348: collapsed to two-block contract (MODULE_CONTRACT + CHANGE_SUMMARY); removed MODULE_MAP, keywords, responsibilities, COMPASS_BLOCK anchors; coverage modes collapsed to standard/none.</item>
  <item>Post-refactor hardening: exclude src/templates generation inputs from authored Compass requirements.</item>
  <item>Post-refactor hardening: detect nested packages/os workspaces before deriving Compass layer and workspace name.</item>
  <item>RFC-0556: moved canonical implementation to @warpgogol/forge, this file is now a re-export.</item>
</CHANGE_SUMMARY>
*/

export {
  createCompassInventoryEntries,
  type CompassInventoryEntry,
} from "@warpgogol/forge/os/compass";
