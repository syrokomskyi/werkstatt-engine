/*
<MODULE_CONTRACT>
<purpose>Shared test fixture helpers for mission.materialize tests — git init/commit, workspace setup with registry, system, and mission scaffolding.</purpose>

<non-goals>
  <item>Do not use in production — the fixture is test-only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0619: extracted shared helpers from mission-materialize-preflight-skip.test.ts and mission-materialize-force-cache-bypass.test.ts to eliminate duplicated code.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

export function gitInit(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

export function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

export function gitHead(dir: string): string {
  return execSync("git rev-parse HEAD", { cwd: dir, stdio: "pipe", encoding: "utf-8" }).trim();
}

export function createMaterializeWorkspace(testRoot: string): string {
  const tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });

  gitInit(testRoot);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  writeFileSync(join(tmpWorkspace, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  writeFileSync(join(tmpWorkspace, "pnpm-workspace.yaml"), "packages: []\n");
  gitCommit(testRoot, "initial");

  const cacheDir = join(testRoot, "systems-cache", "test-system");
  mkdirSync(cacheDir, { recursive: true });
  const configContent = `schemaVersion: system-config/v1
id: test-system
cosmicStar: Vega
mirrors:
  - path: "../systems-cache/test-system"
    storageType: non-bare
pinnedPlatform: "1.0.0"
status: active
registeredAt: "2026-01-01T00:00:00Z"
notes: ""
`;
  writeFileSync(join(cacheDir, "system-config.yaml"), configContent);
  gitCommit(testRoot, "add system config");

  writeFileSync(
    join(cacheDir, "system.pin.json"),
    JSON.stringify({ platform: { version: "1.0.0" } }, null, 2) + "\n",
  );
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), "");
  mkdirSync(join(cacheDir, "src", "content"), { recursive: true });
  writeFileSync(
    join(cacheDir, "src", "content", "system.md"),
    "---\n  domain: test\n  i18n:\n    default: de\n    languages:\n      - de\n---\n",
  );
  gitCommit(testRoot, "add system");

  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  mkdirSync(missionDir, { recursive: true });
  mkdirSync(join(missionDir, "workpiece"), { recursive: true });
  mkdirSync(join(missionDir, "evidence"), { recursive: true });

  const manifest = {
    schemaVersion: "1.0.0",
    missionId: "test-system-m000001",
    systemId: "test-system",
    state: "open",
    brief: "Test mission",
    openedAt: "2026-07-30T00:00:00.000Z",
    openedBy: "test-agent",
    closedAt: null,
    closedBy: null,
    pinAtOpen: "1.0.0",
    materializedAt: null,
    migratedAt: null,
    reconciledAt: null,
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");

  gitCommit(testRoot, "add mission");
  return cacheDir;
}
