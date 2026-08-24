/*
<MODULE_CONTRACT>
<purpose>RFC-0186: Lagebild CLI command handlers for tenant lifecycle management.
Talks to Supabase sync_tenants registry via PostgREST.</purpose>
<non-goals>
  <item>Do not validate workspace structure — that is handled by @warpgogol/site-kernel-checks.</item>
  <item>Do not implement the sync worker itself — that lives in services/lagebild-sync.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0186: Initial stub handlers for tenant lifecycle and validation.</item>
  <item>RFC-0186: Add runLagebildDevVarsGenerate for .dev.vars.example generation.</item>
  <item>RFC-0186: Add runLagebildDevVarsValidate leak-guard and real runLagebildValidate.</item>
  <item>RFC-0186: Replace stubs with real Supabase PostgREST calls for tenant lifecycle.</item>
  <item>RFC-0186: Review fixes — use stdio: "inherit" for wrangler deploy, cast SecretKind.</item>
  <item>RFC-0388: Remove runLagebildDevVarsGenerate and runLagebildDevVarsValidate. Update deploy to --secrets-file .env. Update validate to check .env.example.</item>
</CHANGE_SUMMARY>
*/

import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../types.ts";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createTenant,
  getTenantBySiteName,
  setTenantEnabled,
  updateTenantSecretRef,
  countOutboxByStatus,
  type SecretKind,
} from "@warpgogol/werkstatt-shared/integration-adapter-supabase-crm/tenant-registry";
import { resolveRegistryClient, extractProjectRef } from "./env.ts";

/** lagebild.tenant.add — create tenant row in sync_tenants and emit secret setup commands. */
export async function runLagebildTenantAdd(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const site = input.flags["site"] as string | undefined;
  if (!site) {
    return {
      data: {
        command: "lagebild.tenant.add",
        status: "error",
        tenantId: "",
        siteName: "",
        secretRefs: {
          supabaseUrl: "",
          supabaseServiceKey: "",
          destinationToken: "",
          destinationDomain: "",
        },
        commandsToRun: [],
        message: "Missing required --site flag",
      },
      summary: "[lagebild.tenant.add] --site required",
      exitCode: 1,
      nextSteps: [
        { action: "Provide the --site flag and re-run lagebild.tenant.add", kind: "required" },
      ],
    };
  }

  const tenantId = (input.flags["tenant-id"] as string | undefined) ?? randomUUID();
  const vendor = (input.flags["vendor"] as string | undefined) ?? "pipedrive";
  const siteSlug = site.toUpperCase().replace(/-/g, "_");

  const secretRefs = {
    supabaseUrl: `TENANT_${siteSlug}_SUPABASE_URL`,
    supabaseServiceKey: `TENANT_${siteSlug}_SUPABASE_SERVICE_KEY`,
    destinationToken: `TENANT_${siteSlug}_PIPEDRIVE_TOKEN`,
    destinationDomain: `TENANT_${siteSlug}_PIPEDRIVE_DOMAIN`,
  };

  const commandsToRun = [
    `wrangler secret put ${secretRefs.supabaseUrl}`,
    `wrangler secret put ${secretRefs.supabaseServiceKey}`,
    `wrangler secret put ${secretRefs.destinationToken}`,
    `wrangler secret put ${secretRefs.destinationDomain}`,
  ];

  try {
    const registry = await resolveRegistryClient(context.workspaceRoot);

    // Check if tenant already exists
    const existing = await getTenantBySiteName(registry, site);
    if (existing) {
      return {
        data: {
          command: "lagebild.tenant.add",
          status: "skip",
          tenantId: existing.tenant_id,
          siteName: site,
          secretRefs,
          commandsToRun: [],
          message: `Tenant already exists for site ${site} (tenant_id: ${existing.tenant_id}, enabled: ${existing.enabled}). Use lagebild.tenant.enable to activate.`,
        },
        exitCode: 0,
        summary: `[lagebild.tenant.add] skipped — tenant already exists for ${site}`,
      };
    }

    // Extract Supabase project ref from the registry URL
    const projectRef = extractProjectRef(registry.url);

    const tenant = await createTenant(registry, {
      tenant_id: tenantId,
      site_name: site,
      supabase_project_ref: projectRef,
      supabase_url_secret_ref: secretRefs.supabaseUrl,
      supabase_service_key_secret_ref: secretRefs.supabaseServiceKey,
      destination_vendor: vendor,
      destination_token_secret_ref: secretRefs.destinationToken,
      destination_domain_secret_ref: secretRefs.destinationDomain,
    });

    const message = [
      `Tenant ${tenant.tenant_id} for site ${site} created (enabled: false).`,
      `Run the following commands to set secrets:`,
      ...commandsToRun,
      `Then enable: pnpm exec werkstatt run lagebild.tenant.enable --site ${site}`,
    ].join("\n");

    return {
      data: {
        command: "lagebild.tenant.add",
        status: "ok",
        tenantId: tenant.tenant_id,
        siteName: site,
        secretRefs,
        commandsToRun,
        message,
      },
      exitCode: 0,
      summary: `[lagebild.tenant.add] ${tenant.tenant_id} for ${site}`,
    };
  } catch (err) {
    return {
      data: {
        command: "lagebild.tenant.add",
        status: "error",
        tenantId,
        siteName: site,
        secretRefs,
        commandsToRun,
        message: (err as Error).message,
      },
      summary: `[lagebild.tenant.add] failed: ${(err as Error).message}`,
      exitCode: 1,
      nextSteps: [
        { action: "Check the error message and re-run lagebild.tenant.add", kind: "required" },
      ],
    };
  }
}

/** lagebild.tenant.enable — set enabled=true in sync_tenants. */
export async function runLagebildTenantEnable(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const site = input.flags["site"] as string | undefined;
  if (!site) {
    return {
      data: {
        command: "lagebild.tenant.enable",
        status: "error",
        site: "",
        message: "--site required",
      },
      summary: "[lagebild.tenant.enable] --site required",
      exitCode: 1,
      nextSteps: [
        { action: "Provide the --site flag and re-run lagebild.tenant.enable", kind: "required" },
      ],
    };
  }
  try {
    const registry = await resolveRegistryClient(context.workspaceRoot);
    const tenant = await setTenantEnabled(registry, site, true);
    if (!tenant) {
      return {
        data: {
          command: "lagebild.tenant.enable",
          status: "error",
          site,
          message: `No tenant found for site ${site}. Run lagebild.tenant.add first.`,
        },
        summary: `[lagebild.tenant.enable] no tenant for ${site}`,
        exitCode: 1,
        nextSteps: [
          {
            action: `Run lagebild.tenant.add --site ${site} first, then re-run lagebild.tenant.enable`,
            kind: "required",
          },
        ],
      };
    }
    return {
      data: {
        command: "lagebild.tenant.enable",
        status: "ok",
        site,
        tenantId: tenant.tenant_id,
        enabled: tenant.enabled,
        message: `Tenant ${site} enabled`,
      },
      exitCode: 0,
      summary: `[lagebild.tenant.enable] ${site} enabled`,
    };
  } catch (err) {
    return {
      data: {
        command: "lagebild.tenant.enable",
        status: "error",
        site,
        message: (err as Error).message,
      },
      summary: `[lagebild.tenant.enable] failed: ${(err as Error).message}`,
      exitCode: 1,
      nextSteps: [
        { action: "Check the error message and re-run lagebild.tenant.enable", kind: "required" },
      ],
    };
  }
}

/** lagebild.tenant.disable — set enabled=false in sync_tenants. */
export async function runLagebildTenantDisable(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const site = input.flags["site"] as string | undefined;
  if (!site) {
    return {
      data: {
        command: "lagebild.tenant.disable",
        status: "error",
        site: "",
        message: "--site required",
      },
      summary: "[lagebild.tenant.disable] --site required",
      exitCode: 1,
      nextSteps: [
        { action: "Provide the --site flag and re-run lagebild.tenant.disable", kind: "required" },
      ],
    };
  }
  try {
    const registry = await resolveRegistryClient(context.workspaceRoot);
    const tenant = await setTenantEnabled(registry, site, false);
    if (!tenant) {
      return {
        data: {
          command: "lagebild.tenant.disable",
          status: "error",
          site,
          message: `No tenant found for site ${site}. Run lagebild.tenant.add first.`,
        },
        summary: `[lagebild.tenant.disable] no tenant for ${site}`,
        exitCode: 1,
        nextSteps: [
          {
            action: `Run lagebild.tenant.add --site ${site} first, then re-run lagebild.tenant.disable`,
            kind: "required",
          },
        ],
      };
    }
    return {
      data: {
        command: "lagebild.tenant.disable",
        status: "ok",
        site,
        tenantId: tenant.tenant_id,
        enabled: tenant.enabled,
        message: `Tenant ${site} disabled`,
      },
      exitCode: 0,
      summary: `[lagebild.tenant.disable] ${site} disabled`,
    };
  } catch (err) {
    return {
      data: {
        command: "lagebild.tenant.disable",
        status: "error",
        site,
        message: (err as Error).message,
      },
      summary: `[lagebild.tenant.disable] failed: ${(err as Error).message}`,
      exitCode: 1,
      nextSteps: [
        { action: "Check the error message and re-run lagebild.tenant.disable", kind: "required" },
      ],
    };
  }
}

/** lagebild.tenant.status — read tenant health and outbox counts. */
export async function runLagebildTenantStatus(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const site = input.flags["site"] as string | undefined;
  if (!site) {
    return {
      data: {
        command: "lagebild.tenant.status",
        status: "error",
        tenant: null,
        pendingCount: 0,
        failedCount: 0,
        deadCount: 0,
        missingSecrets: [],
      },
      summary: "[lagebild.tenant.status] --site required",
      exitCode: 1,
      nextSteps: [
        { action: "Provide the --site flag and re-run lagebild.tenant.status", kind: "required" },
      ],
    };
  }
  try {
    const registry = await resolveRegistryClient(context.workspaceRoot);
    const tenant = await getTenantBySiteName(registry, site);
    if (!tenant) {
      return {
        data: {
          command: "lagebild.tenant.status",
          status: "error",
          tenant: null,
          pendingCount: 0,
          failedCount: 0,
          deadCount: 0,
          missingSecrets: [],
          message: `No tenant found for site ${site}`,
        },
        summary: `[lagebild.tenant.status] no tenant for ${site}`,
        exitCode: 1,
        nextSteps: [
          {
            action: `Run lagebild.tenant.add --site ${site} first, then re-run lagebild.tenant.status`,
            kind: "required",
          },
        ],
      };
    }
    const counts = await countOutboxByStatus(registry, tenant.tenant_id);
    return {
      data: {
        command: "lagebild.tenant.status",
        status: "ok",
        tenant: {
          tenant_id: tenant.tenant_id,
          site_name: tenant.site_name,
          enabled: tenant.enabled,
          last_seen_at: tenant.last_seen_at,
          last_success_at: tenant.last_success_at,
          last_error: tenant.last_error,
        },
        pendingCount: counts.pending,
        failedCount: counts.failed,
        deadCount: counts.dead,
        missingSecrets: [],
      },
      summary: `[lagebild.tenant.status] ${site} (enabled: ${tenant.enabled}, pending: ${counts.pending})`,
      exitCode: 0,
    };
  } catch (err) {
    return {
      data: {
        command: "lagebild.tenant.status",
        status: "error",
        tenant: null,
        pendingCount: 0,
        failedCount: 0,
        deadCount: 0,
        missingSecrets: [],
        message: (err as Error).message,
      },
      summary: `[lagebild.tenant.status] failed: ${(err as Error).message}`,
      exitCode: 1,
      nextSteps: [
        { action: "Check the error message and re-run lagebild.tenant.status", kind: "required" },
      ],
    };
  }
}

/** lagebild.tenant.rotate-secret — update a secret_ref column in sync_tenants. */
export async function runLagebildTenantRotateSecret(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const site = input.flags["site"] as string | undefined;
  const kind = input.flags["kind"] as string | undefined;
  const newRef = input.flags["new-ref"] as string | undefined;
  if (!site || !kind) {
    return {
      data: {
        command: "lagebild.tenant.rotate-secret",
        status: "error",
        site: site ?? "",
        kind: kind ?? "",
        message: "--site and --kind required",
      },
      summary: "[lagebild.tenant.rotate-secret] --site and --kind required",
      exitCode: 1,
      nextSteps: [
        {
          action: "Provide the --site and --kind flags and re-run lagebild.tenant.rotate-secret",
          kind: "required",
        },
      ],
    };
  }
  if (!newRef) {
    return {
      data: {
        command: "lagebild.tenant.rotate-secret",
        status: "error",
        site,
        kind,
        message: "--new-ref required (the new secret reference name to store in sync_tenants)",
      },
      summary: "[lagebild.tenant.rotate-secret] --new-ref required",
      exitCode: 1,
      nextSteps: [
        {
          action:
            "Provide the --new-ref flag (the new secret reference name) and re-run lagebild.tenant.rotate-secret",
          kind: "required",
        },
      ],
    };
  }
  try {
    const registry = await resolveRegistryClient(context.workspaceRoot);
    const tenant = await updateTenantSecretRef(registry, site, kind as SecretKind, newRef);
    if (!tenant) {
      return {
        data: {
          command: "lagebild.tenant.rotate-secret",
          status: "error",
          site,
          kind,
          message: `No tenant found for site ${site}`,
        },
        summary: `[lagebild.tenant.rotate-secret] no tenant for ${site}`,
        exitCode: 1,
        nextSteps: [
          {
            action: `Run lagebild.tenant.add --site ${site} first, then re-run lagebild.tenant.rotate-secret`,
            kind: "required",
          },
        ],
      };
    }
    return {
      data: {
        command: "lagebild.tenant.rotate-secret",
        status: "ok",
        site,
        kind,
        newRef,
        message: `Secret ref for ${kind} updated to ${newRef} for site ${site}`,
      },
      summary: `[lagebild.tenant.rotate-secret] ${kind} → ${newRef} for ${site}`,
      exitCode: 0,
    };
  } catch (err) {
    return {
      data: {
        command: "lagebild.tenant.rotate-secret",
        status: "error",
        site,
        kind,
        message: (err as Error).message,
      },
      summary: `[lagebild.tenant.rotate-secret] failed: ${(err as Error).message}`,
      exitCode: 1,
      nextSteps: [
        {
          action: "Check the error message and re-run lagebild.tenant.rotate-secret",
          kind: "required",
        },
      ],
    };
  }
}

/** lagebild.validate — check no per-site sync Workers exist; also verify .env.example. */
export async function runLagebildValidate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const workspaceRoot = context.workspaceRoot ?? process.cwd();
  const integrationsDir = join(workspaceRoot, "integrations");
  const violations: string[] = [];

  try {
    const entries = await readdir(integrationsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const syncDir = join(integrationsDir, entry.name, "workers", "supabase-sync");
      try {
        const fs = await import("node:fs/promises");
        await fs.access(syncDir);
        violations.push(
          `Forbidden per-site sync Worker folder: integrations/${entry.name}/workers/supabase-sync/`,
        );
      } catch {
        // Directory does not exist — OK
      }
    }
  } catch {
    // integrations/ directory missing — nothing to check
  }

  // Also verify .env.example exists and has no leaked values
  const envExampleFile = join(workspaceRoot, "services", "lagebild-sync", ".env.example");
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(envExampleFile, "utf8");
    const leaked = raw.split("\n").filter((line) => {
      const trimmed = line.trim();
      return (
        /^[^#\s][^=]*=.+$/.test(trimmed) && trimmed.split("=").slice(1).join("=").trim().length > 0
      );
    });
    if (leaked.length > 0) {
      violations.push(`.env.example contains ${leaked.length} non-empty value(s) (leak guard)`);
    }
  } catch {
    violations.push(
      "Missing .env.example — create one with all required keys and # How to obtain: instructions",
    );
  }

  if (violations.length > 0) {
    return {
      data: { command: "lagebild.validate", status: "error", violations },
      summary: `[lagebild.validate] ${violations.length} violation${violations.length === 1 ? "" : "s"}: ${violations.join("; ")}`,
      exitCode: 1,
      nextSteps: [
        {
          action: "Fix the violations listed above, then re-run lagebild.validate",
          kind: "required",
        },
      ],
    };
  }

  return {
    data: { command: "lagebild.validate", status: "ok", violations: [] },
    summary: "[lagebild.validate] OK (no per-site Workers, .env.example clean)",
    exitCode: 0,
  };
}
