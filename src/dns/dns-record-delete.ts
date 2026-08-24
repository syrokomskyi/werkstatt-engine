/*
<MODULE_CONTRACT>
<purpose>
RFC-0753: dns.record.delete command handler — deletes a single DNS record
from Cloudflare by record ID or by name+type. Requires --record-id or
--name + --type. Supports --dry-run.
</purpose>
<non-goals>
  <item>Do not delete all records in a zone — use individual calls.</item>
  <item>Do not delete records that are still declared in dns-records.yaml — remove from declaration first.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial dns.record.delete command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { discoverSystems } from "../sternsystem/registry-io.ts";
import { listDnsRecords, deleteDnsRecord } from "../leitstand/adapters/cloudflare-api.ts";
import {
  flagString,
  flagBoolean,
  resolveDnsZoneId,
  resolveDnsEnv,
  resolveZoneDomainForSystem,
} from "./dns-helpers.ts";

export interface DnsRecordDeleteResult {
  command: "dns.record.delete";
  systemId: string;
  zone: string;
  dryRun: boolean;
  deleted: Array<{
    id: string;
    type: string;
    name: string;
  }>;
  state: "deleted" | "dry-run" | "not-found";
}

export async function runDnsRecordDelete(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DnsRecordDeleteResult>> {
  const { workspaceRoot } = context;
  const systemId = flagString(input, "system");
  if (!systemId) throw new Error("[dns.record.delete] --system is required");
  const recordId = flagString(input, "record-id");
  const name = flagString(input, "name");
  const recordType = flagString(input, "type");
  const dryRun = flagBoolean(input, "dry-run") ?? false;

  if (!recordId && !(name && recordType)) {
    throw new Error(
      "[dns.record.delete] Either --record-id or both --name and --type are required.",
    );
  }

  const { systems } = await discoverSystems(workspaceRoot);
  const zoneDomain = resolveZoneDomainForSystem(systems, systemId);
  const zoneId = resolveDnsZoneId(systems, zoneDomain);

  const env = await resolveDnsEnv();
  const apiToken = env["CLOUDFLARE_API_TOKEN"];
  if (!apiToken) {
    throw new Error(
      "[dns.record.delete] CLOUDFLARE_API_TOKEN is not set. " +
        "Set it in the environment or .env file.",
    );
  }

  const deleted: DnsRecordDeleteResult["deleted"] = [];

  if (recordId) {
    if (dryRun) {
      deleted.push({ id: recordId, type: "(unknown)", name: "(unknown)" });
    } else {
      await deleteDnsRecord(zoneId, apiToken, recordId);
      deleted.push({ id: recordId, type: "(unknown)", name: "(unknown)" });
    }
  } else {
    const liveRecords = await listDnsRecords(zoneId, apiToken, name);
    const matching = liveRecords.filter((r) => r.name === name && r.type === recordType);

    if (matching.length === 0) {
      return {
        data: {
          command: "dns.record.delete",
          systemId,
          zone: zoneDomain,
          dryRun,
          deleted: [],
          state: "not-found",
        },
        summary: `[dns.record.delete] ${systemId}: no records found for ${recordType}:${name}`,
        nextSteps: [
          {
            action: `List existing records: pnpm exec werkstatt run dns.record.list --site ${systemId}`,
            kind: "optional",
          },
        ],
      };
    }

    for (const record of matching) {
      if (dryRun) {
        deleted.push({ id: record.id, type: record.type, name: record.name });
      } else {
        await deleteDnsRecord(zoneId, apiToken, record.id);
        deleted.push({ id: record.id, type: record.type, name: record.name });
      }
    }
  }

  return {
    data: {
      command: "dns.record.delete",
      systemId,
      zone: zoneDomain,
      dryRun,
      deleted,
      state: dryRun ? "dry-run" : "deleted",
    },
    summary: `[dns.record.delete] ${systemId}: ${deleted.length} record(s) ${dryRun ? "would be deleted" : "deleted"} in zone ${zoneDomain}`,
    nextSteps: dryRun
      ? [
          {
            action: `Delete for real: pnpm exec werkstatt run dns.record.delete --site ${systemId} --type ${recordType} --name ${name}`,
            kind: "optional",
          },
        ]
      : undefined,
  };
}
