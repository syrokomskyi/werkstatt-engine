/*
<MODULE_CONTRACT>
<purpose>
RFC-0752: subdomain.list command handler — lists all subdomains in a zone
by cross-referencing DNS records with Workers routes.
</purpose>
<non-goals>
  <item>Do not validate correctness — that is subdomain.validate's responsibility.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0752: initial subdomain.list command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { discoverSystems } from "../sternsystem/registry-io.ts";
import { listDnsRecords, listWorkersRoutes } from "../leitstand/adapters/cloudflare-api.ts";
import { flagString, resolveZoneId, resolveSubdomainEnv } from "./subdomain-helpers.ts";

export interface SubdomainListEntry {
  domain: string;
  dnsRecord: {
    exists: boolean;
    id: string | null;
    type: string | null;
    content: string | null;
    proxied: boolean | null;
  };
  workersRoute: {
    exists: boolean;
    id: string | null;
    pattern: string | null;
    script: string | null;
  };
}

export interface SubdomainListResult {
  command: "subdomain.list";
  zone: string;
  subdomains: SubdomainListEntry[];
}

export async function runSubdomainList(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SubdomainListResult>> {
  const { workspaceRoot } = context;
  const zoneDomain = flagString(input, "zone");
  if (!zoneDomain) throw new Error("[subdomain.list] --zone is required");

  const { systems } = await discoverSystems(workspaceRoot);
  const zoneId = resolveZoneId(systems, zoneDomain);

  const env = await resolveSubdomainEnv();
  const apiToken = env["CLOUDFLARE_API_TOKEN"];
  if (!apiToken) {
    throw new Error(
      "[subdomain.list] CLOUDFLARE_API_TOKEN is not set. " +
        "Set it in the environment or .env file.",
    );
  }

  const dnsRecords = await listDnsRecords(zoneId, apiToken);
  const routes = await listWorkersRoutes(zoneId, apiToken);

  const routeByPattern = new Map<string, { id: string; script: string | null }>();
  for (const route of routes) {
    const domain = route.pattern.replace(/\/\*$/, "");
    routeByPattern.set(domain, { id: route.id, script: route.script });
  }

  const subdomains: SubdomainListEntry[] = [];

  for (const dns of dnsRecords) {
    const routeEntry = routeByPattern.get(dns.name);
    subdomains.push({
      domain: dns.name,
      dnsRecord: {
        exists: true,
        id: dns.id,
        type: dns.type,
        content: dns.content,
        proxied: dns.proxied,
      },
      workersRoute: routeEntry
        ? {
            exists: true,
            id: routeEntry.id,
            pattern: `${dns.name}/*`,
            script: routeEntry.script,
          }
        : {
            exists: false,
            id: null,
            pattern: null,
            script: null,
          },
    });
  }

  for (const [domain, route] of routeByPattern) {
    const hasDns = dnsRecords.some((d) => d.name === domain);
    if (!hasDns) {
      subdomains.push({
        domain,
        dnsRecord: {
          exists: false,
          id: null,
          type: null,
          content: null,
          proxied: null,
        },
        workersRoute: {
          exists: true,
          id: route.id,
          pattern: `${domain}/*`,
          script: route.script,
        },
      });
    }
  }

  subdomains.sort((a, b) => a.domain.localeCompare(b.domain));

  return {
    data: {
      command: "subdomain.list",
      zone: zoneDomain,
      subdomains,
    },
    summary: `[subdomain.list] Zone '${zoneDomain}': ${subdomains.length} subdomain(s) found`,
    nextSteps: [],
  };
}
