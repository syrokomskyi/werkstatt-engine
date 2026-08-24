/*
<MODULE_CONTRACT>
<purpose>
RFC-0752: Shared helpers for subdomain commands — zone ID resolution,
account subdomain derivation, and environment variable resolution.
</purpose>
<non-goals>
  <item>Do not implement command logic — that lives in the individual command files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0752: initial shared helpers — resolveZoneId, resolveAccountSubdomain, resolveSubdomainEnv.</item>
</CHANGE_SUMMARY>
*/

import type { SystemConfig, ServiceEntry, ServicesRegistry } from "@warpgogol/werkstatt-engine/schemas";
import { filterEnv, sourceDotenv } from "../leitstand/adapters/cloudflare-workers.ts";

export function flagString(
  input: { flags: Record<string, unknown> },
  key: string,
): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function extractDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

export function resolveZoneId(systems: SystemConfig[], zoneDomain: string): string {
  for (const system of systems) {
    if (!system.deployment) continue;
    const mainDomain = extractDomainFromUrl(system.deployment.channels.main.url);
    if (mainDomain === zoneDomain) {
      if (!system.cloudflareZoneId) {
        throw new Error(
          `[subdomain] System '${system.id}' matches zone '${zoneDomain}' but has no cloudflareZoneId. Add it to system-config.yaml.`,
        );
      }
      return system.cloudflareZoneId;
    }
  }
  throw new Error(
    `[subdomain] No system found matching zone '${zoneDomain}' in system-config.yaml files.`,
  );
}

export function resolveService(registry: ServicesRegistry, serviceId: string): ServiceEntry {
  const service = registry.services.find((s: ServiceEntry) => s.id === serviceId);
  if (!service) {
    const available = registry.services.map((s: ServiceEntry) => s.id).join(", ");
    throw new Error(
      `[subdomain] Service '${serviceId}' not found in services registry. Available services: ${available}`,
    );
  }
  return service;
}

function extractAccountFromWorkersDevUrl(
  url: string | undefined,
  workerName: string,
): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const parts = parsed.hostname.split(".");
    if (
      parts.length === 4 &&
      parts[0] === workerName &&
      parts[2] === "workers" &&
      parts[3] === "dev"
    ) {
      return parts[1];
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveAccountSubdomain(
  service: ServiceEntry,
  env: Record<string, string>,
): string {
  const fromUrl = extractAccountFromWorkersDevUrl(service.workersDevUrl, service.workerName);
  if (fromUrl) return fromUrl;

  const fromEnv = env["CLOUDFLARE_ACCOUNT_ID"];
  if (fromEnv) return fromEnv;

  throw new Error(
    `[subdomain] Cannot resolve <account> subdomain for service '${service.id}'. ` +
      `Set workersDevUrl in the registry service entry or CLOUDFLARE_ACCOUNT_ID in the environment.`,
  );
}

export async function resolveSubdomainEnv(
  secretsFilePath?: string,
): Promise<Record<string, string>> {
  const secretsEnv = secretsFilePath ? await sourceDotenv(secretsFilePath) : {};
  return { ...filterEnv(process.env), ...secretsEnv };
}

export function buildCnameContent(workerName: string, account: string): string {
  return `${workerName}.${account}.workers.dev`;
}

export function buildRoutePattern(domain: string): string {
  return `${domain}/*`;
}
