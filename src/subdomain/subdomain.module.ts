/*
<MODULE_CONTRACT>
<purpose>
RFC-0752: Kernel module for subdomain management commands —
subdomain.register, subdomain.validate, subdomain.list.
</purpose>
<non-goals>
  <item>Do not register leitstand or deployment commands here — those live in leitstand.module.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0752: initial subdomain module with register, validate, list commands.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createSubdomainModule(): KernelModule {
  return {
    name: "subdomain",
    version: "0.1.0",
    async register(registry) {
      const { runSubdomainRegister } = await import("./subdomain-register.ts");
      const { runSubdomainValidate } = await import("./subdomain-validate.ts");
      const { runSubdomainList } = await import("./subdomain-list.ts");

      registry.registerCommand({
        name: "subdomain.register",
        modulePath: "packages/werkstatt-engine/src/subdomain/subdomain.module.ts",
        description:
          "Register DNS CNAME and Workers route for a service subdomain (RFC-0752). Idempotent. Flags: --service.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        flags: {
          service: {
            kind: "string",
            required: true,
            description: "Service id from services/registry.yaml services[].",
          },
        },
        reads: ["services/registry.yaml", "systems-cache/{system}/system-config.yaml"],
        cacheable: false,
        execute: runSubdomainRegister,
      });

      registry.registerCommand({
        name: "subdomain.validate",
        contract: "subdomain",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/subdomain/subdomain.module.ts",
        description:
          "Validate DNS CNAME and Workers route for a service subdomain (RFC-0752). Flags: --service.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          service: {
            kind: "string",
            required: true,
            description: "Service id from services/registry.yaml services[].",
          },
        },
        reads: ["services/registry.yaml", "systems-cache/{system}/system-config.yaml"],
        cacheable: false,
        execute: runSubdomainValidate,
      });

      registry.registerCommand({
        name: "subdomain.list",
        modulePath: "packages/werkstatt-engine/src/subdomain/subdomain.module.ts",
        description:
          "List all subdomains in a zone by cross-referencing DNS records with Workers routes (RFC-0752). Flags: --zone.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          zone: {
            kind: "string",
            required: true,
            description: "Zone domain name (e.g. warpgogol.com).",
          },
        },
        reads: ["systems-cache/*/system-config.yaml"],
        cacheable: false,
        execute: runSubdomainList,
      });
    },
  };
}
