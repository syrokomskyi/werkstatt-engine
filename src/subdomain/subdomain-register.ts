/*
<MODULE_CONTRACT>
<purpose>
RFC-0752: subdomain.register command handler — registers DNS CNAME and Workers
route for a service subdomain via the Cloudflare API. Idempotent: skips existing
correct records, errors on mismatched records.
</purpose>
<non-goals>
  <item>Do not auto-update mismatched DNS records or Workers routes — operator must fix manually.</item>
  <item>Do not handle DNS propagation waiting — that is out of scope.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0752: initial subdomain.register command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { readServicesRegistry, discoverSystems } from "../sternsystem/registry-io.ts";
import {
  listDnsRecords,
  createDnsRecord,
  listWorkersRoutes,
  createWorkersRoute,
} from "../leitstand/adapters/cloudflare-api.ts";
import {
  flagString,
  resolveService,
  resolveZoneId,
  resolveAccountSubdomain,
  resolveSubdomainEnv,
  buildCnameContent,
  buildRoutePattern,
} from "./subdomain-helpers.ts";

export interface SubdomainRecord {
  domain: string;
  zone: string;
}

export interface SubdomainRegisterResult {
  command: "subdomain.register";
  serviceId: string;
  subdomain: SubdomainRecord;
  dnsRecord: {
    id: string;
    type: "CNAME";
    name: string;
    content: string;
    proxied: boolean;
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

export async function runSubdomainRegister(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SubdomainRegisterResult>> {
  const { workspaceRoot } = context;
  const serviceId = flagString(input, "service");
  if (!serviceId) throw new Error("[subdomain.register] --service is required");

  const registry = await readServicesRegistry(workspaceRoot);
  const service = resolveService(registry, serviceId);

  if (service.subdomains.length === 0) {
    throw new Error(
      `[subdomain.register] Service '${serviceId}' has no subdomains declared in the registry.`,
    );
  }

  const env = await resolveSubdomainEnv();
  const apiToken = env["CLOUDFLARE_API_TOKEN"];
  if (!apiToken) {
    throw new Error(
      "[subdomain.register] CLOUDFLARE_API_TOKEN is not set. " +
        "Set it in the environment or .env file. " +
        "The token must have Zone:DNS:Edit and Workers Routes:Edit permissions.",
    );
  }

  const account = resolveAccountSubdomain(service, env);

  const subdomain = service.subdomains[0];
  const { systems } = await discoverSystems(workspaceRoot);
  const zoneId = resolveZoneId(systems, subdomain.zone);
  const expectedCnameContent = buildCnameContent(service.workerName, account);
  const expectedRoutePattern = buildRoutePattern(subdomain.domain);

  const existingDnsRecords = await listDnsRecords(zoneId, apiToken, subdomain.domain);
  const matchingDns = existingDnsRecords.find((r) => r.name === subdomain.domain);

  let dnsResult: SubdomainRegisterResult["dnsRecord"];
  let dnsCreated = false;

  if (matchingDns) {
    if (
      matchingDns.type === "CNAME" &&
      matchingDns.content === expectedCnameContent &&
      matchingDns.proxied === true
    ) {
      dnsResult = {
        id: matchingDns.id,
        type: "CNAME",
        name: matchingDns.name,
        content: matchingDns.content,
        proxied: matchingDns.proxied,
        created: false,
      };
    } else {
      throw new Error(
        `[subdomain.register] DNS record for '${subdomain.domain}' exists but has wrong values. ` +
          `Current: type=${matchingDns.type}, content=${matchingDns.content}, proxied=${matchingDns.proxied}. ` +
          `Expected: type=CNAME, content=${expectedCnameContent}, proxied=true. ` +
          `Delete or fix the record manually before re-running.`,
      );
    }
  } else {
    const created = await createDnsRecord(zoneId, apiToken, {
      type: "CNAME",
      name: subdomain.domain,
      content: expectedCnameContent,
      proxied: true,
    });
    dnsCreated = true;
    dnsResult = {
      id: created.id,
      type: "CNAME",
      name: created.name,
      content: created.content,
      proxied: created.proxied,
      created: true,
    };
  }

  const existingRoutes = await listWorkersRoutes(zoneId, apiToken);
  const matchingRoute = existingRoutes.find((r) => r.pattern === expectedRoutePattern);

  let routeResult: SubdomainRegisterResult["workersRoute"];
  let routeCreated = false;

  if (matchingRoute) {
    if (matchingRoute.script === service.workerName) {
      routeResult = {
        id: matchingRoute.id,
        pattern: matchingRoute.pattern,
        script: matchingRoute.script ?? service.workerName,
        created: false,
      };
    } else {
      throw new Error(
        `[subdomain.register] Workers route for '${expectedRoutePattern}' exists but points to wrong script. ` +
          `Current: script=${matchingRoute.script}. Expected: script=${service.workerName}. ` +
          `Delete or fix the route manually before re-running.`,
      );
    }
  } else {
    const created = await createWorkersRoute(zoneId, apiToken, {
      pattern: expectedRoutePattern,
      script: service.workerName,
    });
    routeCreated = true;
    routeResult = {
      id: created.id,
      pattern: created.pattern,
      script: created.script ?? service.workerName,
      created: true,
    };
  }

  const state: SubdomainRegisterResult["state"] =
    dnsCreated || routeCreated ? "registered" : "already-registered";

  return {
    data: {
      command: "subdomain.register",
      serviceId,
      subdomain,
      dnsRecord: dnsResult,
      workersRoute: routeResult,
      state,
    },
    summary: `[subdomain.register] ${subdomain.domain}: ${state} (dns: ${dnsCreated ? "created" : "exists"}, route: ${routeCreated ? "created" : "exists"})`,
    nextSteps: [],
  };
}
