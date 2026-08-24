/*
<MODULE_CONTRACT>
<purpose>
RFC-0753: Kernel module for DNS record management commands —
dns.record.upsert, dns.record.validate, dns.record.list, dns.record.delete,
dns.records.schema.validate.
</purpose>
<non-goals>
  <item>Do not register subdomain or leitstand commands here — those live in their own modules.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial DNS module with upsert, validate, list, delete, schema.validate commands.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createDnsModule(): KernelModule {
  return {
    name: "dns",
    version: "0.1.0",
    async register(registry) {
      const { runDnsRecordUpsert } = await import("./dns-record-upsert.ts");
      const { runDnsRecordValidate } = await import("./dns-record-validate.ts");
      const { runDnsRecordList } = await import("./dns-record-list.ts");
      const { runDnsRecordDelete } = await import("./dns-record-delete.ts");
      const { runDnsRecordsSchemaValidate } = await import("./dns-records-schema-validate.ts");

      registry.registerCommand({
        name: "dns.record.upsert",
        description:
          "Synchronize DNS records from declaration file to Cloudflare (RFC-0753). Idempotent. Flags: --system, --dry-run.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        flags: {
          system: {
            kind: "string",
            required: true,
            description:
              "System ID from system-config.yaml. Auto-injected by pipeline/CLI when --site is provided.",
          },
          "dry-run": {
            kind: "boolean",
            description: "Preview changes without making API calls.",
          },
        },
        reads: [
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/dns-records.yaml",
        ],
        cacheable: false,
        execute: runDnsRecordUpsert,
      });

      registry.registerCommand({
        name: "dns.record.validate",
        description:
          "Validate live Cloudflare DNS records against declaration file (RFC-0753). Flags: --system.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          system: {
            kind: "string",
            required: true,
            description: "System ID from system-config.yaml.",
          },
        },
        reads: [
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/dns-records.yaml",
        ],
        cacheable: false,
        execute: runDnsRecordValidate,
      });

      registry.registerCommand({
        name: "dns.record.list",
        description:
          "List all live DNS records in a zone from Cloudflare (RFC-0753). Flags: --system, --name.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          system: {
            kind: "string",
            required: true,
            description: "System ID from system-config.yaml.",
          },
          name: {
            kind: "string",
            description: "Filter by record name (e.g. warpgogol.com).",
          },
        },
        reads: ["systems-cache/{system}/system-config.yaml"],
        cacheable: false,
        execute: runDnsRecordList,
      });

      registry.registerCommand({
        name: "dns.record.delete",
        description:
          "Delete a DNS record from Cloudflare by ID or name+type (RFC-0753). Flags: --system, --record-id, --name, --type, --dry-run.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        flags: {
          system: {
            kind: "string",
            required: true,
            description: "System ID from system-config.yaml.",
          },
          "record-id": {
            kind: "string",
            description: "Cloudflare record ID to delete.",
          },
          name: {
            kind: "string",
            description: "Record name (requires --type).",
          },
          type: {
            kind: "string",
            description: "Record type (requires --name).",
          },
          "dry-run": {
            kind: "boolean",
            description: "Preview deletion without making API calls.",
          },
        },
        reads: ["systems-cache/{system}/system-config.yaml"],
        cacheable: false,
        execute: runDnsRecordDelete,
      });

      registry.registerCommand({
        name: "dns.records.schema.validate",
        description:
          "Schema-only validation of DNS record declaration files (RFC-0753). No API calls. Flags: --system.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          system: {
            kind: "string",
            description: "System ID. If omitted, validates all systems with dns-records.yaml.",
          },
        },
        reads: ["systems-cache/{system}/dns-records.yaml"],
        cacheable: true,
        execute: runDnsRecordsSchemaValidate,
      });
    },
  };
}
