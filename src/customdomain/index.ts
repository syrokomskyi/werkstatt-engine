/*
<MODULE_CONTRACT>
<purpose>customdomain index — barrel re-exports for the customdomain command family (RFC-0896).</purpose>
<non-goals>
  <item>Do not re-export helpers — they are internal to this module.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0896: initial barrel for customdomain commands.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export { createCustomdomainModule } from "./customdomain.module.ts";
export { runCustomdomainRegister } from "./customdomain-register.ts";
export type { CustomDomainRegisterResult } from "./customdomain-register.ts";
export { runRedirectRegister } from "./redirect-register.ts";
export type { RedirectRegisterResult } from "./redirect-register.ts";
