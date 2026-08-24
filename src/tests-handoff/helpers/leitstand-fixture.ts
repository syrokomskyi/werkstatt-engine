import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeSystemConfig(testRoot: string, systemId: string, deployment?: string): void {
  const cacheDir = join(testRoot, "systems-cache", systemId);
  mkdirSync(cacheDir, { recursive: true });

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
  writeFileSync(join(cacheDir, "system-config.yaml"), configContent);
}

export function writeSystemState(
  testRoot: string,
  systemId: string,
  lastPropagated?: string,
  currentMission: string | null = null,
): void {
  const cacheDir = join(testRoot, "systems-cache", systemId);
  mkdirSync(cacheDir, { recursive: true });

  const missionField = currentMission ? currentMission : "null";
  const stateContent = `schemaVersion: system-state/v1
systemId: ${systemId}
currentMission: ${missionField}
lastRelease: null
${lastPropagated ? `lastPropagated:\n${lastPropagated}` : ""}`;
  writeFileSync(join(cacheDir, "system-state.yaml"), stateContent);
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

export function createLeitstandSystem(
  testRoot: string,
  systemId: string,
  opts?: {
    adapter?: "null" | "cloudflare-workers";
    lastPropagated?: string;
    currentMission?: string;
  },
): void {
  const deployment =
    opts?.adapter === "cloudflare-workers" ? DEPLOYMENT_CLOUDFLARE : DEPLOYMENT_NULL;
  writeSystemConfig(testRoot, systemId, deployment);
  writeSystemState(testRoot, systemId, opts?.lastPropagated, opts?.currentMission ?? null);
}
