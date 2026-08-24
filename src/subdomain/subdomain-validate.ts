/*
<MODULE_CONTRACT>
<purpose>
RFC-0752: subdomain.validate command handler — validates that DNS CNAME and
Workers route for a service subdomain exist and are correctly configured.
Returns state: valid | not-registered | mismatched. Exit code 0 for all
validation states (not-registered and mismatched are validation results,
not errors).
</purpose>
<non-goals>
  <item>Do not create or update records — that is subdomain.register's responsibility.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0752: initial subdomain.validate command handler.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { readServicesRegistry, discoverSystems } from "../sternsystem/registry-io.ts";
import { listDnsRecords, listWorkersRoutes } from "../leitstand/adapters/cloudflare-api.ts";
import {
  flagString,
  resolveService,
  resolveZoneId,
  resolveAccountSubdomain,
  resolveSubdomainEnv,
  buildCnameContent,
  buildRoutePattern,
} from "./subdomain-helpers.ts";
import type { SubdomainRecord } from "./subdomain-register.ts";

export interface SubdomainValidateResult {
  command: "subdomain.validate";
  serviceId: string;
  subdomain: SubdomainRecord;
  dnsRecord: {
    exists: boolean;
    correct: boolean;
    id: string | null;
    type: string | null;
    content: string | null;
    proxied: boolean | null;
  };
  workersRoute: {
    exists: boolean;
    correct: boolean;
    id: string | null;
    pattern: string | null;
    script: string | null;
  };
  state: "valid" | "not-registered" | "mismatched";
}

export async function runSubdomainValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<SubdomainValidateResult>> {
  const { workspaceRoot } = context;
  const serviceId = flagString(input, "service");
  if (!serviceId) throw new Error("[subdomain.validate] --service is required");

  const registry = await readServicesRegistry(workspaceRoot);
  const service = resolveService(registry, serviceId);

  if (service.subdomains.length === 0) {
    throw new Error(
      `[subdomain.validate] Service '${serviceId}' has no subdomains declared in the registry.`,
    );
  }

  const env = await resolveSubdomainEnv();
  const apiToken = env["CLOUDFLARE_API_TOKEN"];
  if (!apiToken) {
    throw new Error(
      "[subdomain.validate] CLOUDFLARE_API_TOKEN is not set. " +
        "Set it in the environment or .env file.",
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

  const dnsExists = !!matchingDns;
  const dnsCorrect =
    dnsExists &&
    matchingDns!.type === "CNAME" &&
    matchingDns!.content === expectedCnameContent &&
    matchingDns!.proxied === true;

  const existingRoutes = await listWorkersRoutes(zoneId, apiToken);
  const matchingRoute = existingRoutes.find((r) => r.pattern === expectedRoutePattern);

  const routeExists = !!matchingRoute;
  const routeCorrect = routeExists && matchingRoute!.script === service.workerName;

  const state: SubdomainValidateResult["state"] =
    dnsCorrect && routeCorrect
      ? "valid"
      : !dnsExists && !routeExists
        ? "not-registered"
        : "mismatched";

  return {
    data: {
      command: "subdomain.validate",
      serviceId,
      subdomain,
      dnsRecord: {
        exists: dnsExists,
        correct: dnsCorrect,
        id: matchingDns?.id ?? null,
        type: matchingDns?.type ?? null,
        content: matchingDns?.content ?? null,
        proxied: matchingDns?.proxied ?? null,
      },
      workersRoute: {
        exists: routeExists,
        correct: routeCorrect,
        id: matchingRoute?.id ?? null,
        pattern: matchingRoute?.pattern ?? null,
        script: matchingRoute?.script ?? null,
      },
      state,
    },
    summary: `[subdomain.validate] ${subdomain.domain}: ${state}`,
    nextSteps: [],
  };
}
