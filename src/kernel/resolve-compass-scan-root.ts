/*
<MODULE_CONTRACT>
<purpose>Compass scan-root resolution. Canonical implementation now lives
in @warpgogol/forge/os/compass/handlers/resolve-scan-root.ts (RFC-0556 dependency inversion).
This file re-exports it for backward-compatible imports from @warpgogol/site-kernel.</purpose>
<non-goals>
  <item>Do not duplicate the implementation — always re-export from forge.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Introduced as part of RFC-0015 to extend Compass commands to packages/.</item>
  <item>RFC-0556: moved canonical implementation to @warpgogol/forge, this file is now a re-export.</item>
</CHANGE_SUMMARY>
*/

export { resolveCompassScanRoot } from "@warpgogol/forge/os/compass";
