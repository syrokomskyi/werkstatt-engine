/*
<MODULE_CONTRACT>
<purpose>
RFC-0896: Shared helpers for custom domain and redirect commands — system config
resolution, DNS/route/redirect payload builders, and environment variable resolution.
</purpose>
<non-goals>
  <item>Do not implement command logic — that lives in the individual command files.</item>
  <item>Do not log, echo, or serialize secret values.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0896: initial shared helpers — resolveCustomDomainConfig, buildApexDnsRecord, buildApexRoutePattern, buildWwwDnsRecord, buildRedirectRuleExpression, buildRedirectRuleDescription, resolveCustomDomainEnv.</item>
</CHANGE_SUMMARY>
*/

import type { SystemConfig } from "@warpgogol/werkstatt-engine/schemas";
import { readSystemConfig } from "../sternsystem/registry-io.ts";
import { filterEnv, sourceDotenv } from "../leitstand/adapters/cloudflare-workers.ts";

export interface CustomDomainConfig {
  zoneId: string;
  apexDomain: string;
  workerName: string;
}

export async function resolveCustomDomainConfig(
  workspaceRoot: string,
  systemId: string,
): Promise<CustomDomainConfig> {
  const config: SystemConfig = await readSystemConfig(workspaceRoot, systemId);

  if (!config.cloudflareZoneId) {
    throw new Error(
      `[customdomain] System '${systemId}' has no cloudflareZoneId in system-config.yaml. Add it to enable custom domain registration.`,
    );
  }

  const deployment = config.deployment;
  if (!deployment) {
    throw new Error(
      `[customdomain] System '${systemId}' has no deployment config in system-config.yaml.`,
    );
  }

  const mainUrl = deployment.channels.main.url;
  const apexDomain = extractDomainFromUrl(mainUrl);
  if (!apexDomain) {
    throw new Error(
      `[customdomain] System '${systemId}' has invalid deployment.channels.main.url: '${mainUrl}'. Expected a valid URL with a hostname.`,
    );
  }

  const workerName = deployment.channels.main.workerName;
  if (!workerName) {
    throw new Error(
      `[customdomain] System '${systemId}' has empty deployment.channels.main.workerName in system-config.yaml.`,
    );
  }

  return {
    zoneId: config.cloudflareZoneId,
    apexDomain,
    workerName,
  };
}

function extractDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

export function buildApexDnsRecord(domain: string): {
  type: "A";
  name: string;
  content: string;
  proxied: true;
} {
  return {
    type: "A",
    name: domain,
    content: "192.0.2.1",
    proxied: true,
  };
}

export function buildApexRoutePattern(domain: string): string {
  return `${domain}/*`;
}

export function buildWwwDnsRecord(apexDomain: string): {
  type: "CNAME";
  name: string;
  content: string;
  proxied: true;
} {
  return {
    type: "CNAME",
    name: `www.${apexDomain}`,
    content: apexDomain,
    proxied: true,
  };
}

export function buildWwwDomain(apexDomain: string): string {
  return `www.${apexDomain}`;
}

export function buildRedirectRuleExpression(wwwDomain: string): string {
  return `(http.host eq "${wwwDomain}")`;
}

export function buildRedirectRuleDescription(systemId: string): string {
  return `www → apex 301 (${systemId})`;
}

export function buildRedirectRuleTargetExpression(apexDomain: string): string {
  return `concat("https://${apexDomain}", http.request.uri.path)`;
}

export async function resolveCustomDomainEnv(
  secretsFilePath?: string,
): Promise<Record<string, string>> {
  const secretsEnv = secretsFilePath ? await sourceDotenv(secretsFilePath) : {};
  const merged = { ...filterEnv(process.env), ...secretsEnv };

  const token = merged["CLOUDFLARE_API_TOKEN"];
  if (!token) {
    throw new Error(
      "[customdomain] CLOUDFLARE_API_TOKEN is required. The token must have " +
        "Zone:DNS:Edit, Workers Routes:Edit, and Zone:Transform:Edit permissions.",
    );
  }

  return merged;
}
