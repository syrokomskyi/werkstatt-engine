/*
<MODULE_CONTRACT>
<purpose>
RFC-0896: customdomain.register command handler — registers a proxied A record
and Workers route for a site's apex domain via the Cloudflare API. Idempotent:
skips existing correct records, errors on mismatched A records. Coexists with
non-A records (MX, TXT, etc.) for the same domain name — only A records are
managed by this command.
</purpose>
<non-goals>
  <item>Do not auto-update mismatched A DNS records or Workers routes — operator must fix manually.</item>
  <item>Do not modify or delete non-A records (MX, TXT, etc.) — those are managed by dns.record.upsert.</item>
  <item>Do not handle DNS propagation waiting — that is out of scope.</item>
  <item>Do not handle www subdomain — that is redirect.register's responsibility.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0896: initial customdomain.register command handler.</item>
  <item>Fix: filter by type=A when searching existing records so MX/TXT records for the same domain name do not block A record creation.</item>
  <item>Fix: handle Cloudflare error 81062 (DNS record managed by Workers already exists) as idempotent success — listDnsRecords does not return Workers-managed records.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { flagSite } from "../leitstand/deploy-helpers.ts";
import {
  listDnsRecords,
  createDnsRecord,
  listWorkersRoutes,
  createWorkersRoute,
} from "../leitstand/adapters/cloudflare-api.ts";
import {
  resolveCustomDomainConfig,
  resolveCustomDomainEnv,
  buildApexDnsRecord,
  buildApexRoutePattern,
} from "./customdomain-helpers.ts";

export interface CustomDomainRegisterResult {
  command: "customdomain.register";
  systemId: string;
  domain: string;
  dnsRecord: {
    id: string;
    type: "A";
    name: string;
    content: string;
    proxied: true;
    created: boolean;
  };
  workersRoute: {
    id: string;
    pattern: string;
    script: string;
    created: boolean;
  };
  state: "registered" | "already-registered" | "failed";
}

export async function runCustomdomainRegister(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CustomDomainRegisterResult>> {
  const { workspaceRoot } = context;
  const systemId = flagSite(input);
  if (!systemId) throw new Error("[customdomain.register] --site is required");

  const { zoneId, apexDomain, workerName } = await resolveCustomDomainConfig(
    workspaceRoot,
    systemId,
  );

  const env = await resolveCustomDomainEnv();
  const apiToken = env["CLOUDFLARE_API_TOKEN"];

  const expectedDnsRecord = buildApexDnsRecord(apexDomain);
  const expectedRoutePattern = buildApexRoutePattern(apexDomain);

  const existingDnsRecords = await listDnsRecords(zoneId, apiToken, apexDomain);
  // Only look for A records — MX, TXT, and other record types for the same
  // domain name can coexist with the proxied A record and are not managed here.
  const matchingDns = existingDnsRecords.find((r) => r.name === apexDomain && r.type === "A");

  let dnsResult: CustomDomainRegisterResult["dnsRecord"];
  let dnsCreated = false;

  if (matchingDns) {
    if (matchingDns.proxied === true) {
      dnsResult = {
        id: matchingDns.id,
        type: "A",
        name: matchingDns.name,
        content: matchingDns.content,
        proxied: true,
        created: false,
      };
    } else {
      throw new Error(
        `[customdomain.register] A record for '${apexDomain}' exists but is not proxied. ` +
          `Current: proxied=${matchingDns.proxied}. ` +
          `Expected: proxied=true. ` +
          `Enable Cloudflare proxy on the A record manually before re-running.`,
      );
    }
  } else {
    try {
      const created = await createDnsRecord(zoneId, apiToken, expectedDnsRecord);
      dnsCreated = true;
      dnsResult = {
        id: created.id,
        type: "A",
        name: created.name,
        content: created.content,
        proxied: true,
        created: true,
      };
    } catch (err) {
      // Cloudflare error 81062: "A DNS record managed by Workers already exists on that host."
      // listDnsRecords does not return Workers-managed records — treat as idempotent success.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("81062")) {
        dnsResult = {
          id: "workers-managed",
          type: "A",
          name: apexDomain,
          content: expectedDnsRecord.content,
          proxied: true,
          created: false,
        };
      } else {
        throw err;
      }
    }
  }

  const existingRoutes = await listWorkersRoutes(zoneId, apiToken);
  const matchingRoute = existingRoutes.find((r) => r.pattern === expectedRoutePattern);

  let routeResult: CustomDomainRegisterResult["workersRoute"];
  let routeCreated = false;

  if (matchingRoute) {
    if (matchingRoute.script === workerName) {
      routeResult = {
        id: matchingRoute.id,
        pattern: matchingRoute.pattern,
        script: matchingRoute.script ?? workerName,
        created: false,
      };
    } else {
      throw new Error(
        `[customdomain.register] Workers route for '${expectedRoutePattern}' exists but points to wrong script. ` +
          `Current: script=${matchingRoute.script}. Expected: script=${workerName}. ` +
          `Delete or fix the route manually before re-running.`,
      );
    }
  } else {
    const created = await createWorkersRoute(zoneId, apiToken, {
      pattern: expectedRoutePattern,
      script: workerName,
    });
    routeCreated = true;
    routeResult = {
      id: created.id,
      pattern: created.pattern,
      script: created.script ?? workerName,
      created: true,
    };
  }

  const state: CustomDomainRegisterResult["state"] =
    dnsCreated || routeCreated ? "registered" : "already-registered";

  return {
    data: {
      command: "customdomain.register",
      systemId,
      domain: apexDomain,
      dnsRecord: dnsResult,
      workersRoute: routeResult,
      state,
    },
    summary: `[customdomain.register] ${apexDomain}: ${state} (dns: ${dnsCreated ? "created" : "exists"}, route: ${routeCreated ? "created" : "exists"})`,
    nextSteps: [
      {
        action: `Verify the domain is serving: curl -I https://${apexDomain}`,
        kind: "optional",
      },
    ],
  };
}
