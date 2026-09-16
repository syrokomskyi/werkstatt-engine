/*
<MODULE_CONTRACT>
<purpose>subdomain index — barrel re-exports for the subdomain command family (RFC-0752).</purpose>
<non-goals>
  <item>Do not re-export helpers — they are internal to this module.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0752: initial barrel for subdomain commands.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export { createSubdomainModule } from "./subdomain.module.ts";
export { runSubdomainRegister } from "./subdomain-register.ts";
export type { SubdomainRegisterResult, SubdomainRecord } from "./subdomain-register.ts";
export { runSubdomainValidate } from "./subdomain-validate.ts";
export type { SubdomainValidateResult } from "./subdomain-validate.ts";
export { runSubdomainList } from "./subdomain-list.ts";
export type { SubdomainListResult, SubdomainListEntry } from "./subdomain-list.ts";
