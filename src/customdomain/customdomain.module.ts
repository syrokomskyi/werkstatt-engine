/*
<MODULE_CONTRACT>
<purpose>
RFC-0896: Kernel module for custom domain and redirect management commands —
customdomain.register, redirect.register.
</purpose>
<non-goals>
  <item>Do not register leitstand or deployment commands here — those live in leitstand.module.ts.</item>
  <item>Do not register subdomain or DNS record commands — those live in subdomain.module.ts and dns.module.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0896: initial customdomain module with register and redirect.register commands.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createCustomdomainModule(): KernelModule {
  return {
    name: "customdomain",
    version: "0.1.0",
    async register(registry) {
      const { runCustomdomainRegister } = await import("./customdomain-register.ts");
      const { runRedirectRegister } = await import("./redirect-register.ts");

      registry.registerCommand({
        name: "customdomain.register",
        description:
          "Register proxied A record and Workers route for a site apex domain (RFC-0896). Idempotent. Flags: --site.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        flags: {
          site: {
            kind: "string",
            required: true,
            description: "System id from systems-cache/{system}/system-config.yaml.",
          },
        },
        reads: ["systems-cache/{system}/system-config.yaml"],
        cacheable: false,
        execute: runCustomdomainRegister,
      });

      registry.registerCommand({
        name: "redirect.register",
        description:
          "Register proxied CNAME and Redirect Rule (301) for www.{apex} → apex (RFC-0896). Idempotent. Flags: --site.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        flags: {
          site: {
            kind: "string",
            required: true,
            description: "System id from systems-cache/{system}/system-config.yaml.",
          },
        },
        reads: ["systems-cache/{system}/system-config.yaml"],
        cacheable: false,
        execute: runRedirectRegister,
      });
    },
  };
}
