/*
<MODULE_CONTRACT>
<purpose>leitstand-fixture — write system config fixtures for leitstand handoff tests.</purpose>
<non-goals>
  <item>Do not use in production — the fixture is test-only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

export async function writeSystemConfig(
  testRoot: string,
  systemId: string,
  deployment?: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const cacheDir = join(testRoot, "systems-cache", systemId);
  await io.mkdir(cacheDir);

  const deploymentBlock = deployment ? `\ndeployment:\n${deployment}\n` : "\n";

  const configContent = `schemaVersion: system-config/v1
id: ${systemId}
cosmicStar: Acamar
mirrors:
  - path: "../systems-cache/${systemId}"
    storageType: non-bare
pinnedPlatform: 1.0.0
status: active
registeredAt: 2026-01-01T00:00:00Z
notes: ""
${deploymentBlock}`;
  await io.writeFile(join(cacheDir, "system-config.yaml"), configContent);
}

export async function writeSystemState(
  testRoot: string,
  systemId: string,
  lastPropagated?: string,
  currentMission: string | null = null,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  const cacheDir = join(testRoot, "systems-cache", systemId);
  await io.mkdir(cacheDir);

  const missionField = currentMission ? currentMission : "null";
  const stateContent = `schemaVersion: system-state/v1
systemId: ${systemId}
currentMission: ${missionField}
lastRelease: null
${lastPropagated ? `lastPropagated:\n${lastPropagated}` : ""}`;
  await io.writeFile(join(cacheDir, "system-state.yaml"), stateContent);
}

const DEPLOYMENT_NULL = `  adapter: "null"
  channels:
    dev:
      workerName: test-dev
      url: https://dev.example.com
    alt:
      workerName: test-alt
      url: https://alt.example.com
    main:
      workerName: test-main
      url: https://main.example.com`;

const DEPLOYMENT_CLOUDFLARE = `  adapter: "cloudflare-workers"
  channels:
    dev:
      workerName: test-dev
      url: https://dev.example.com
    alt:
      workerName: test-alt
      url: https://alt.example.com
    main:
      workerName: test-main
      url: https://main.example.com`;

export async function createLeitstandSystem(
  testRoot: string,
  systemId: string,
  opts?: {
    adapter?: "null" | "cloudflare-workers";
    lastPropagated?: string;
    currentMission?: string;
    io?: WorkspaceIO;
  },
): Promise<void> {
  const io = opts?.io ?? createDefaultIO().io;
  const deployment =
    opts?.adapter === "cloudflare-workers" ? DEPLOYMENT_CLOUDFLARE : DEPLOYMENT_NULL;
  await writeSystemConfig(testRoot, systemId, deployment, io);
  await writeSystemState(
    testRoot,
    systemId,
    opts?.lastPropagated,
    opts?.currentMission ?? null,
    io,
  );
}
