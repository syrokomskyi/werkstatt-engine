/*
<MODULE_CONTRACT>
  <purpose>Shared platform-scope constants and helpers for RFC-0533 ecosystem.commit and PC-04 rule.</purpose>
  <non-goals>
    <item>Do not define git or validation logic here — only scope classification and trailer matching.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0533: extract shared PLATFORM_SCOPE_PREFIXES, isPlatformScope, hasPlatformScopeFiles, and trailer regex helpers.</item>
</CHANGE_SUMMARY>
*/

export {
  PLATFORM_SCOPE_PREFIXES,
  isPlatformScope,
  hasPlatformScopeFiles,
  extractTrailer,
  hasTrailer,
} from "@warpgogol/werkstatt-engine/kernel";
