/*
<MODULE_CONTRACT>
<purpose>
RFC-0753: dns.record.list command handler — lists all live DNS records in a zone
from Cloudflare, optionally filtered by name. Read-only, no API token write
permissions needed.
</purpose>
<non-goals>
  <item>Do not create, update, or delete records.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial dns.record.list command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { discoverSystems } from "../sternsystem/registry-io.ts";
import { listDnsRecords } from "../leitstand/adapters/cloudflare-api.ts";
import {
  flagString,
  resolveDnsZoneId,
  resolveDnsEnv,
  resolveZoneDomainForSystem,
} from "./dns-helpers.ts";

export interface DnsRecordListResult {
  command: "dns.record.list";
  systemId: string;
  zone: string;
  records: Array<{
    id: string;
    type: string;
    name: string;
    content: string;
    proxied: boolean;
    priority: number | null;
  }>;
}

export async function runDnsRecordList(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<DnsRecordListResult>> {
  const { workspaceRoot } = context;
  const systemId = flagString(input, "system");
  if (!systemId) throw new Error("[dns.record.list] --system is required");
  const filterName = flagString(input, "name");

  const { systems } = await discoverSystems(workspaceRoot);
  const zoneDomain = resolveZoneDomainForSystem(systems, systemId);
  const zoneId = resolveDnsZoneId(systems, zoneDomain);

  const env = await resolveDnsEnv();
  const apiToken = env["CLOUDFLARE_API_TOKEN"];
  if (!apiToken) {
    throw new Error(
      "[dns.record.list] CLOUDFLARE_API_TOKEN is not set. " +
        "Set it in the environment or .env file.",
    );
  }

  const records = await listDnsRecords(zoneId, apiToken, filterName);

  return {
    data: {
      command: "dns.record.list",
      systemId,
      zone: zoneDomain,
      records: records.map((r) => ({
        id: r.id,
        type: r.type,
        name: r.name,
        content: r.content,
        proxied: r.proxied,
        priority: r.priority,
      })),
    },
    summary: `[dns.record.list] ${systemId}: ${records.length} records in zone ${zoneDomain}`,
    nextSteps: [
      {
        action: `Validate DNS records: pnpm exec werkstatt run dns.record.validate --site ${systemId}`,
        kind: "optional",
      },
    ],
  };
}
