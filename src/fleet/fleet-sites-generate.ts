/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0964: fleet.sites.generate — generates fleet/fleet.sites.yaml from
    discoverSystems output (RFC-0790 convention). The registry is a truthful
    generated projection of systems-cache/{id}/system-config.yaml — no second
    source of truth (DNA-45). Moved from packages/werkstatt-site/src/checks/
    to packages/werkstatt-engine/src/fleet/ so fleet.apply can call it for
    self-healing without engine→site imports (DNA-64).
  </purpose>
  <non-goals>
    <item>Do not read or modify fleet status, plan, or killswitch state.</item>
    <item>Do not hardcode site names — derive entirely from convention-based discovery.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0378: initial implementation of fleet.sites.generate command (in werkstatt-site).</item>
  <item>RFC-0964: moved from werkstatt-site to werkstatt-engine, repointed from discoverSiteWorkspaces to discoverSystems, enriched output with platformVersion, channels, mirrors, activeMission, canary, path fields.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { stringify as yamlStringify } from "yaml";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "../kernel/types.ts";
import { buildGeneratedHeader, stripGeneratedMarker } from "../kernel/generated-marker.ts";
import { writeFileAtomic } from "../kernel/fs-atomic.ts";
import {
  discoverSystems,
  resolveCacheClonePath,
  readSystemState,
} from "../sternsystem/registry-io.ts";
import type { SystemConfig } from "../schemas/sternsystem.ts";

const FLEET_SITES_FILE = "fleet/fleet.sites.yaml";

export interface FleetSiteRecord {
  id: string;
  path: string;
  platformVersion: string;
  channels: Record<"dev" | "alt" | "main", { releaseId: string | null }>;
  mirrors: { count: number; protocols: string[] };
  activeMission: string | null;
  canary: boolean;
}

interface FleetSitesFile {
  sites: FleetSiteRecord[];
}

function extractMirrorProtocols(config: SystemConfig): string[] {
  const protocols = new Set<string>();
  for (const mirror of config.mirrors) {
    const proto =
      mirror.path.startsWith("http") || mirror.path.startsWith("git")
        ? new URL(mirror.path).protocol.replace(":", "")
        : "file";
    protocols.add(proto);
  }
  return [...protocols].sort();
}

async function buildFleetSiteRecord(
  workspaceRoot: string,
  config: SystemConfig,
): Promise<FleetSiteRecord> {
  const cacheClonePath = resolveCacheClonePath(workspaceRoot, config.id);
  const relPath = relative(workspaceRoot, cacheClonePath).replace(/\\/g, "/");

  let platformVersion = "unknown";
  try {
    const pinRaw = await readFile(join(cacheClonePath, "system.pin.json"), "utf8");
    const pin = JSON.parse(pinRaw) as { platform?: { version?: string } };
    platformVersion = pin.platform?.version ?? "unknown";
  } catch {
    // pin may not exist yet for registered-but-not-pinned systems
  }

  let state: Awaited<ReturnType<typeof readSystemState>>;
  try {
    state = await readSystemState(workspaceRoot, config.id);
  } catch {
    state = {
      schemaVersion: "1",
      systemId: config.id,
      currentMission: null,
      lastRelease: null,
      lastPropagated: {},
      accessPin: null,
      passportRequired: false,
      ownershipRequired: false,
    };
  }

  const channels: FleetSiteRecord["channels"] = {
    dev: { releaseId: state.lastPropagated.dev?.releaseId ?? null },
    alt: { releaseId: state.lastPropagated.alt?.releaseId ?? null },
    main: { releaseId: state.lastPropagated.main?.releaseId ?? null },
  };

  return {
    id: config.id,
    path: relPath,
    platformVersion,
    channels,
    mirrors: {
      count: config.mirrors.length,
      protocols: extractMirrorProtocols(config),
    },
    activeMission: state.currentMission,
    canary: config.fleet?.canary ?? false,
  };
}

export async function runFleetSitesGenerate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const { workspaceRoot } = context;
  const { systems, errors } = await discoverSystems(workspaceRoot);

  const records: FleetSiteRecord[] = [];
  for (const config of systems) {
    records.push(await buildFleetSiteRecord(workspaceRoot, config));
  }
  records.sort((a, b) => a.id.localeCompare(b.id));

  const fleetSites: FleetSitesFile = { sites: records };

  const outputPath = join(workspaceRoot, FLEET_SITES_FILE);
  await mkdir(dirname(outputPath), { recursive: true });

  const header = buildGeneratedHeader({
    filePath: FLEET_SITES_FILE,
    ownerCommand: "fleet.sites.generate",
  });
  const body = yamlStringify(fleetSites);
  const content = `${header}\n${body}`;

  await writeFileAtomic(outputPath, content);

  return {
    exitCode: 0,
    summary: `fleet.sites.generate: wrote ${records.length} site(s) to ${FLEET_SITES_FILE}`,
    data: {
      command: "fleet.sites.generate",
      sites: records,
      errors,
      written: FLEET_SITES_FILE,
    },
  };
}

export async function validateFleetSitesDrift(
  workspaceRoot: string,
): Promise<{ drifted: boolean; expected: string; actual: string }> {
  const { systems } = await discoverSystems(workspaceRoot);

  const records: FleetSiteRecord[] = [];
  for (const config of systems) {
    records.push(await buildFleetSiteRecord(workspaceRoot, config));
  }
  records.sort((a, b) => a.id.localeCompare(b.id));

  const expectedContent = yamlStringify({ sites: records });

  const filePath = join(workspaceRoot, FLEET_SITES_FILE);
  if (!existsSync(filePath)) {
    return { drifted: true, expected: expectedContent, actual: "" };
  }

  const raw = await readFile(filePath, "utf8");
  const { content: actualContent } = stripGeneratedMarker(raw);

  return {
    drifted: actualContent.trim() !== expectedContent.trim(),
    expected: expectedContent,
    actual: actualContent,
  };
}
