/*
<MODULE_CONTRACT>
<purpose>
RFC-0752: Barrel re-exports for the subdomain command family.
</purpose>
<non-goals>
  <item>Do not re-export helpers — they are internal to this module.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0752: initial barrel for subdomain commands.</item>
</CHANGE_SUMMARY>
*/

export { createSubdomainModule } from "./subdomain.module.ts";
export { runSubdomainRegister } from "./subdomain-register.ts";
export type { SubdomainRegisterResult, SubdomainRecord } from "./subdomain-register.ts";
export { runSubdomainValidate } from "./subdomain-validate.ts";
export type { SubdomainValidateResult } from "./subdomain-validate.ts";
export { runSubdomainList } from "./subdomain-list.ts";
export type { SubdomainListResult, SubdomainListEntry } from "./subdomain-list.ts";
