/*
<MODULE_CONTRACT>
<purpose>
RFC-0896: Barrel re-exports for the customdomain command family.
</purpose>
<non-goals>
  <item>Do not re-export helpers — they are internal to this module.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0896: initial barrel for customdomain commands.</item>
</CHANGE_SUMMARY>
*/

export { createCustomdomainModule } from "./customdomain.module.ts";
export { runCustomdomainRegister } from "./customdomain-register.ts";
export type { CustomDomainRegisterResult } from "./customdomain-register.ts";
export { runRedirectRegister } from "./redirect-register.ts";
export type { RedirectRegisterResult } from "./redirect-register.ts";
