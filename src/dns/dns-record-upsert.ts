/*
<MODULE_CONTRACT>
<purpose>
RFC-0753: dns.record.upsert command handler — synchronizes DNS records from
a declaration file to Cloudflare. Creates, updates, or skips records idempotently.
Supports --dry-run to preview changes without making API calls.
</purpose>
<non-goals>
  <item>Do not delete records that are absent from the declaration — that is dns.record.delete's responsibility.</item>
  <item>Do not validate schema — that is dns.records.schema.validate's responsibility.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial dns.record.upsert command handler.</item>
  <item>RFC-0812: export toApiRecord for unit testing.</item>
  <item>RFC-0817: graceful skip when dns-records.yaml is absent instead of throwing.</item>
  <item>RECOVERY-2026-10-04: upsert matches via pickBestLiveMatch + consumed-live tracking (same as dns.record.validate) — naive find(type+name) compared every declaration against the first same-identity record, misbinding parallel MX / dual apex TXT and producing bogus update/create calls (CF 1046 on Email-Routing MX, 81058 duplicate-TXT). Cloudflare codes 1046/81058 now classify as skipped (goal state externally owned or already satisfied) instead of errors.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { discoverSystems } from "../sternsystem/registry-io.ts";
import {
  listDnsRecords,
  createDnsRecord,
  updateDnsRecord,
} from "../leitstand/adapters/cloudflare-api.ts";
import {
  flagString,
  flagBoolean,
  loadDnsRecordFile,
  resolveDnsZoneId,
  resolveDnsEnv,
  recordsMatch,
  pickBestLiveMatch,
} from "./dns-helpers.ts";
import { ensureTxtQuoted } from "./txt-normalize.ts";
import type { DnsRecordDeclaration } from "@warpgogol/werkstatt-shared/ontology/schemas";

export interface DnsRecordUpsertResult {
  command: "dns.record.upsert";
  systemId: string;
  zone: string;
  dryRun: boolean;
  results: Array<{
    identity: string;
    action: "created" | "updated" | "skipped";
    recordId: string | null;
  }>;
  summary: {
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    total: number;
  };
}

export async function runDnsRecordUpsert(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DnsRecordUpsertResult>> {
  const { workspaceRoot } = context;
  const systemId = flagString(input, "system") ?? context.site?.name;
  if (!systemId)
    throw new Error("[dns.record.upsert] --system is required (or run in site-scoped context)");
  const dryRun = flagBoolean(input, "dry-run") ?? false;

  const declaration = await loadDnsRecordFile(workspaceRoot, systemId);
  if (!declaration) {
    return {
      data: {
        command: "dns.record.upsert",
        systemId,
        zone: "",
        dryRun,
        results: [],
        summary: { created: 0, updated: 0, skipped: 0, total: 0, errors: 0 },
      },
      summary: `[dns.record.upsert] ${systemId}: skipped — no dns-records.yaml found`,
      nextSteps: [
        {
          action: `Create a dns-records.yaml file for ${systemId} and re-run: pnpm exec werkstatt run dns.record.upsert --site ${systemId}`,
          kind: "optional",
        },
      ],
    };
  }

  const { systems } = await discoverSystems(workspaceRoot);
  let zoneId: string;
  try {
    zoneId = resolveDnsZoneId(systems, declaration.zone);
  } catch {
    return {
      data: {
        command: "dns.record.upsert",
        systemId,
        zone: declaration.zone,
        dryRun,
        results: [],
        summary: { created: 0, updated: 0, skipped: 0, total: 0, errors: 0 },
      },
      summary: `[dns.record.upsert] ${systemId}: skipped — zone '${declaration.zone}' not found in system-config.yaml`,
      nextSteps: [
        {
          action: `Add a system with deployment channel matching '${declaration.zone}' to system-config.yaml, or remove dns-records.yaml if DNS management is not needed.`,
          kind: "optional",
        },
      ],
    };
  }

  const env = await resolveDnsEnv();
  const apiToken = env["CLOUDFLARE_API_TOKEN"];
  if (!apiToken) {
    throw new Error(
      "[dns.record.upsert] CLOUDFLARE_API_TOKEN is not set. " +
        "Set it in the environment or .env file. " +
        "The token must have Zone:DNS:Edit permission.",
    );
  }

  const liveRecords = await listDnsRecords(zoneId, apiToken);

  const results: DnsRecordUpsertResult["results"] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  let errors = 0;
  const consumedLiveIds = new Set<string>();
  for (const declared of declaration.records) {
    const identity = `${declared.type}:${declared.name}`;
    const matching = pickBestLiveMatch(declared, liveRecords, consumedLiveIds);

    if (matching && recordsMatch(declared, matching)) {
      skipped++;
      consumedLiveIds.add(matching.id);
      results.push({ identity, action: "skipped", recordId: matching.id });
      continue;
    }

    if (dryRun) {
      if (matching) {
        updated++;
        results.push({ identity, action: "updated", recordId: null });
      } else {
        created++;
        results.push({ identity, action: "created", recordId: null });
      }
      continue;
    }

    const apiRecord = toApiRecord(declared);

    try {
      if (matching) {
        consumedLiveIds.add(matching.id);
        await updateDnsRecord(zoneId, apiToken, matching.id, apiRecord);
        updated++;
        results.push({ identity, action: "updated", recordId: matching.id });
      } else {
        const created_record = await createDnsRecord(zoneId, apiToken, apiRecord);
        created++;
        results.push({ identity, action: "created", recordId: created_record.id });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isUnmanageableRecordError(msg)) {
        skipped++;
        results.push({ identity, action: "skipped", recordId: matching?.id ?? null });
        console.warn(`[dns.record.upsert] ${identity}: skipped — ${msg}`);
      } else {
        errors++;
        results.push({ identity, action: "skipped", recordId: null });
        console.warn(`[dns.record.upsert] ${identity}: API error — ${msg}`);
      }
    }
  }

  const total = declaration.records.length;
  return {
    data: {
      command: "dns.record.upsert",
      systemId,
      zone: declaration.zone,
      dryRun,
      results,
      summary: { created, updated, skipped, total, errors },
    },
    summary: `[dns.record.upsert] ${systemId}: ${created} created, ${updated} updated, ${skipped} skipped, ${errors} error${errors === 1 ? "" : "s"} (${total} total)${dryRun ? " [dry-run]" : ""}`,
    nextSteps:
      errors > 0
        ? [
            {
              action: `Fix the ${errors} error${errors === 1 ? "" : "s"} above, then re-run: pnpm exec werkstatt run dns.record.upsert --site ${systemId}`,
              kind: "required",
            },
          ]
        : dryRun
          ? [
              {
                action: `Apply for real: pnpm exec werkstatt run dns.record.upsert --site ${systemId}`,
                kind: "optional",
              },
            ]
          : [
              {
                action: `Validate DNS records: pnpm exec werkstatt run dns.record.validate --site ${systemId}`,
                kind: "optional",
              },
            ],
  };
}

/**
 * Cloudflare API codes whose failure means the declared goal is unreachable
 * through this command or already satisfied — never an actionable error:
 * 1046 = record managed by Cloudflare Email Routing (update/remove forbidden),
 * 81058 = an identical record already exists (create is a no-op).
 */
function isUnmanageableRecordError(message: string): boolean {
  return /\b(1046|81058):/.test(message);
}

export function toApiRecord(declared: DnsRecordDeclaration): {
  type: string;
  name: string;
  content?: string;
  data?: { priority: number; target: string; value: string };
  proxied?: boolean;
  priority?: number;
  ttl?: number;
  comment?: string;
} {
  if (declared.type === "SVCB" || declared.type === "HTTPS") {
    const parts = declared.content.split(/\s+/);
    const priority = parseInt(parts[0] ?? "0", 10);
    const target = parts[1] ?? ".";
    const value = parts.slice(2).join(" ");
    return {
      type: declared.type,
      name: declared.name,
      data: { priority, target, value },
      proxied: declared.proxied ?? false,
      ...(declared.ttl !== undefined ? { ttl: declared.ttl } : {}),
      ...(declared.comment ? { comment: declared.comment } : {}),
    };
  }
  return {
    type: declared.type,
    name: declared.name,
    content: declared.type === "TXT" ? ensureTxtQuoted(declared.content) : declared.content,
    proxied: declared.proxied ?? false,
    ...(declared.priority !== undefined ? { priority: declared.priority } : {}),
    ...(declared.ttl !== undefined ? { ttl: declared.ttl } : {}),
    ...(declared.comment ? { comment: declared.comment } : {}),
  };
}
