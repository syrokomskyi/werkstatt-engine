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
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import { createDefaultIO, type WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

async function gitExec(dir: string, args: string[], io: WorkspaceIO): Promise<string> {
  const result = await io.exec("git", args, { cwd: dir });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0] ?? ""} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export async function gitInit(dir: string, io: WorkspaceIO = createDefaultIO().io): Promise<void> {
  await gitExec(dir, ["init", "-b", "main"], io);
  await gitExec(dir, ["config", "user.email", "test@test.com"], io);
  await gitExec(dir, ["config", "user.name", "Test"], io);
}

export async function gitCommit(
  dir: string,
  msg: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<void> {
  await gitExec(dir, ["add", "-A"], io);
  await gitExec(dir, ["commit", "-m", msg], io);
}

export async function gitHead(
  dir: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string> {
  return gitExec(dir, ["rev-parse", "HEAD"], io);
}

export async function createMaterializeWorkspace(
  testRoot: string,
  io: WorkspaceIO = createDefaultIO().io,
): Promise<string> {
  const tmpWorkspace = join(testRoot, "workspace");
  await io.mkdir(tmpWorkspace);

  await gitInit(testRoot, io);
  await io.writeFile(join(tmpWorkspace, "README.md"), "# test\n");
  await io.writeFile(
    join(tmpWorkspace, "package.json"),
    JSON.stringify({ version: "1.0.0" }) + "\n",
  );
  await io.writeFile(join(tmpWorkspace, "pnpm-workspace.yaml"), "packages: []\n");
  await gitCommit(testRoot, "initial", io);

  const cacheDir = join(testRoot, "systems-cache", "test-system");
  await io.mkdir(cacheDir);
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
  await io.writeFile(join(cacheDir, "system-config.yaml"), configContent);
  await gitCommit(testRoot, "add system config", io);

  await io.writeFile(
    join(cacheDir, "system.pin.json"),
    JSON.stringify({ platform: { version: "1.0.0" } }, null, 2) + "\n",
  );
  await io.mkdir(join(cacheDir, "bordbuch"));
  await io.writeFile(join(cacheDir, "bordbuch", "events.ndjson"), "");
  await io.mkdir(join(cacheDir, "src", "content"));
  await io.writeFile(
    join(cacheDir, "src", "content", "system.md"),
    "---\n  domain: test\n  i18n:\n    default: de\n    languages:\n      - de\n---\n",
  );
  await gitCommit(testRoot, "add system", io);

  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  await io.mkdir(missionDir);
  await io.mkdir(join(missionDir, "workpiece"));
  await io.mkdir(join(missionDir, "evidence"));

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
  await io.writeFile(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");

  await gitCommit(testRoot, "add mission", io);
  return cacheDir;
}
