/*
<MODULE_CONTRACT>
<purpose>RFC-0186: Lagebild kernel module. Registers CLI commands for tenant lifecycle and shared Worker management.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0186: Initial lagebild module with tenant and worker commands.</item>
  <item>RFC-0388: Remove lagebild.worker.dev.vars.generate and .validate commands. Update lagebild.worker.deploy to use --secrets-file .env. Update lagebild.validate to check .env.example.</item>
  <item>RFC-0806: Remove lagebild.worker.deploy — replaced by leitstand.service.promote.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "../types.ts";
import type { KernelRegistry } from "../registry.ts";

export const lagebildModule: KernelModule = {
  name: "lagebild",
  version: "0.1.0",

  async register(registry: KernelRegistry) {
    const {
      runLagebildTenantAdd,
      runLagebildTenantEnable,
      runLagebildTenantDisable,
      runLagebildTenantStatus,
      runLagebildTenantRotateSecret,
      runLagebildValidate,
    } = await import("./handlers.ts");
    registry.registerCommand({
      name: "lagebild.tenant.add",
      description:
        "RFC-0186: Add a tenant to sync_tenants registry (disabled by default). Generates secret reference names and emits setup commands.",
      scope: "workspace",
      flags: {
        site: {
          kind: "string",
          required: true,
          description: "Site id for the Lagebild tenant.",
        },
        "tenant-id": {
          kind: "string",
          description: "Optional deterministic tenant id; defaults to a UUID.",
        },
        vendor: {
          kind: "string",
          description: "CRM/vendor id for the tenant; defaults to pipedrive.",
        },
      },
      mutatesState: true,
      cacheable: false,
      execute: runLagebildTenantAdd,
    });

    registry.registerCommand({
      name: "lagebild.tenant.enable",
      description: "RFC-0186: Enable a tenant after secrets are present.",
      scope: "workspace",
      flags: {
        site: {
          kind: "string",
          required: true,
          description: "Site id for the Lagebild tenant.",
        },
      },
      mutatesState: true,
      cacheable: false,
      execute: runLagebildTenantEnable,
    });

    registry.registerCommand({
      name: "lagebild.tenant.disable",
      description: "RFC-0186: Disable a tenant without deleting history.",
      scope: "workspace",
      flags: {
        site: {
          kind: "string",
          required: true,
          description: "Site id for the Lagebild tenant.",
        },
      },
      mutatesState: true,
      cacheable: false,
      execute: runLagebildTenantDisable,
    });

    registry.registerCommand({
      name: "lagebild.tenant.status",
      description: "RFC-0186: Inspect tenant health, outbox counts, and missing secrets.",
      scope: "workspace",
      flags: {
        site: {
          kind: "string",
          required: true,
          description: "Site id for the Lagebild tenant.",
        },
      },
      cacheable: false,
      execute: runLagebildTenantStatus,
    });

    registry.registerCommand({
      name: "lagebild.tenant.rotate-secret",
      description: "RFC-0186: Rotate a tenant secret reference.",
      scope: "workspace",
      flags: {
        site: {
          kind: "string",
          required: true,
          description: "Site id for the Lagebild tenant.",
        },
        kind: {
          kind: "string",
          required: true,
          description:
            "Secret kind to rotate (supabase-url, supabase-service-key, pipedrive-token, pipedrive-domain).",
        },
        "new-ref": {
          kind: "string",
          required: true,
          description: "New secret reference name to store in sync_tenants.",
        },
      },
      mutatesState: true,
      cacheable: false,
      execute: runLagebildTenantRotateSecret,
    });

    registry.registerCommand({
      name: "lagebild.validate",
      description:
        "RFC-0186: Validate Lagebild configuration (no per-site Workers, migrations present).",
      scope: "workspace",
      flags: {},
      reads: ["services/lagebild-sync/**", "packages/os/site-kernel/src/lagebild/**"],
      execute: runLagebildValidate,
    });
  },
};
