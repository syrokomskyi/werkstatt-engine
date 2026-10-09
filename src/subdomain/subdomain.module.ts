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
  <item>RFC-1173: declare mutatesState on all kernel commands — collectDeclarationDiagnostics emits error-severity MUTATES-STATE-DECLARED, command.manifest.validate is the blocking consumer in packages.check, sweep declares the flag on every command definition (factories hardcode false for read-only check specs)</item>
  <item>RFC-1231: step 1 — rename supportsAllSites to acceptsAllFlag

Mechanical sweep: the field only ever gated --all argv acceptance; fan-out
follows the parsed selector. Guard renamed assertAllSitesAllowed ->
assertAllFlagAccepted, message updated. 417 declaration sites + type
surfaces (KernelCommandMetadata, ForgeCommandMetadata) in one atomic pass.</item>
  <item>RFC-1248: VITE-CLIENT-DEP-02 lazy-import gate + SCAN-02 validator reads-root existence check (RFC-1248)</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createSubdomainModule(): Promise<ModuleExport> {
  const { runSubdomainRegister } = await import("./subdomain-register.ts");
  const { runSubdomainValidate } = await import("./subdomain-validate.ts");
  const { runSubdomainList } = await import("./subdomain-list.ts");
  return {
    name: "subdomain",
    version: "0.1.0",
    declarations: [],
    commands: [
      {
        name: "subdomain.register",
        modulePath: "packages/werkstatt-engine/src/subdomain/subdomain.module.ts",
        description:
          "Register DNS CNAME and Workers route for a service subdomain (RFC-0752). Idempotent. Flags: --service.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: false,
        flags: {
          service: {
            kind: "string",
            required: true,
            description: "Service id from services/registry.yaml services[].",
          },
        },
        reads: ["services/registry.yaml", "../systems-cache/{system}/system-config.yaml"],
        cacheable: false,
        execute: runSubdomainRegister,
      },
      {
        name: "subdomain.validate",
        mutatesState: false,
        contract: "subdomain",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/subdomain/subdomain.module.ts",
        description:
          "Validate DNS CNAME and Workers route for a service subdomain (RFC-0752). Flags: --service.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          service: {
            kind: "string",
            required: true,
            description: "Service id from services/registry.yaml services[].",
          },
        },
        reads: ["services/registry.yaml", "../systems-cache/{system}/system-config.yaml"],
        cacheable: false,
        execute: runSubdomainValidate,
      },
      {
        name: "subdomain.list",
        mutatesState: false,
        modulePath: "packages/werkstatt-engine/src/subdomain/subdomain.module.ts",
        description:
          "List all subdomains in a zone by cross-referencing DNS records with Workers routes (RFC-0752). Flags: --zone.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          zone: {
            kind: "string",
            required: true,
            description: "Zone domain name (e.g. warpgogol.com).",
          },
        },
        reads: ["../systems-cache/*/system-config.yaml"],
        cacheable: false,
        execute: runSubdomainList,
      },
    ],
    pipelines: [],
  };
}
