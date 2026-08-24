/*
<MODULE_CONTRACT>
<purpose>
ADR-0036: Shared system-config fixture builder for test files. Constructs
system-config.yaml via yaml.stringify from a typed JS object, eliminating
manual newline management that produced invalid YAML in string-interpolated
fixtures. Reusable across subdomain, leitstand, mission, and sternsystem tests.
RFC-0790: migrated from systems/registry.yaml to per-system system-config.yaml.
</purpose>
<non-goals>
  <item>Does not validate the registry against the Zod schema — callers are responsible for producing schema-valid shapes.</item>
  <item>Does not write files to disk — returns a YAML string. Callers use writeFileSync or mkdirSync + writeFileSync.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0036: initial registry builder helper with typed options and yaml.stringify serialization.</item>
</CHANGE_SUMMARY>
*/

import { stringify as stringifyYaml } from "yaml";
import type {
  DeploymentAdapterName,
  MirrorStorageType,
  ServiceEntry,
  SystemConfig,
} from "@warpgogol/werkstatt-engine/schemas";

export interface RegistryChannelOptions {
  workerName: string;
  url: string;
}

export interface RegistryDeploymentOptions {
  adapter: DeploymentAdapterName;
  channels: {
    dev: RegistryChannelOptions;
    alt: RegistryChannelOptions;
    main: RegistryChannelOptions;
  };
}

export interface RegistrySubdomainOptions {
  domain: string;
  zone: string;
}

export interface RegistryServiceOptions {
  id: string;
  kind: ServiceEntry["kind"];
  workerName: string;
  hostedBy: ServiceEntry["hostedBy"];
  url: string;
  workersDevUrl?: string;
  subdomains?: RegistrySubdomainOptions[];
}

export interface RegistrySystemOptions {
  id: string;
  cosmicStar: string;
  mirrors: { path: string; storageType: MirrorStorageType }[];
  pinnedPlatform: string;
  currentMission?: string | null;
  lastRelease?: string | null;
  status?: SystemConfig["status"];
  registeredAt?: string;
  cloudflareZoneId?: string;
  deployment?: RegistryDeploymentOptions;
  notes?: string;
}

export interface BuildRegistryOptions {
  schemaVersion?: string;
  systems: RegistrySystemOptions[];
  services?: RegistryServiceOptions[];
}

export function buildSystemConfig(sys: RegistrySystemOptions): string {
  const config: Record<string, unknown> = {
    schemaVersion: "system-config/v1",
    id: sys.id,
    cosmicStar: sys.cosmicStar,
    mirrors: sys.mirrors,
    pinnedPlatform: sys.pinnedPlatform,
    status: sys.status ?? "active",
    registeredAt: sys.registeredAt ?? "2026-01-01T00:00:00.000Z",
    notes: sys.notes ?? "",
  };
  if (sys.deployment !== undefined) {
    config.deployment = sys.deployment;
  }
  if (sys.cloudflareZoneId !== undefined) {
    config.cloudflareZoneId = sys.cloudflareZoneId;
  }
  return stringifyYaml(config);
}

export function buildServicesRegistry(opts: BuildRegistryOptions): string {
  if (opts.services === undefined || opts.services.length === 0) {
    return stringifyYaml({ schemaVersion: "services/v1", services: [] });
  }
  const registry: Record<string, unknown> = {
    schemaVersion: "services/v1",
    services: opts.services.map((svc) => {
      const entry: Record<string, unknown> = {
        id: svc.id,
        kind: svc.kind,
        workerName: svc.workerName,
        hostedBy: svc.hostedBy,
        url: svc.url,
      };
      if (svc.workersDevUrl !== undefined) {
        entry.workersDevUrl = svc.workersDevUrl;
      }
      if (svc.subdomains !== undefined) {
        entry.subdomains = svc.subdomains;
      }
      return entry;
    }),
  };
  return stringifyYaml(registry);
}
