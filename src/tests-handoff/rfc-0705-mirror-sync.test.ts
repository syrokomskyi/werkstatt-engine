/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0705: unit tests for mirror sync enforcement in mission.reconcile and
    mission.close — verifies non-fatal sync in reconcile and blocking check in close.
  </purpose>
  <keywords>RFC-0705, mission.reconcile, mission.close, sternsystem.sync, mirrorSync</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0705: initial tests for mirror sync in reconcile and blocking check in close.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { expectData } from "./helpers/kernel-result-helpers.ts";
import { tmpdir } from "node:os";

// --- Mocks for mission.reconcile tests ---

const mockSync = vi.hoisted(() => ({
  executeKernelCommandResult: {
    exitCode: 0,
    data: {
      systemId: "test-system",
      mirrorUrls: [],
      direction: "push",
      branch: "main",
      commitSha: "abc",
      syncedAt: "2026-08-05T00:00:00.000Z",
    },
    summary: "sternsystem.sync: ok",
  },
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn(async () => mockSync.executeKernelCommandResult),
  };
});

// --- Shared helpers ---

function gitInit(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

let testRoot: string;
let tmpWorkspace: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-rfc-0705-"));
  tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });
  mockSync.executeKernelCommandResult = {
    exitCode: 0,
    data: {
      systemId: "test-system",
      mirrorUrls: [],
      direction: "push",
      branch: "main",
      commitSha: "abc",
      syncedAt: "2026-08-05T00:00:00.000Z",
    },
    summary: "sternsystem.sync: ok",
  };
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

// --- Reconcile tests ---

function setupReconcileWorkspace(opts?: { externalMirrors?: boolean }): void {
  gitInit(tmpWorkspace);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommit(tmpWorkspace, "initial");

  const cacheDir = join(testRoot, "systems-cache", "test-system");
  mkdirSync(cacheDir, { recursive: true });
  const mirrors = opts?.externalMirrors
    ? `  - path: "../systems-cache/test-system"
    storageType: non-bare
  - path: "../systems-cache/test-system.git"
    storageType: bare
  - path: "git@github.com:warpgogol/test-system.git"
    storageType: bare`
    : `  - path: "../systems-cache/test-system"
    storageType: non-bare
  - path: "../systems-cache/test-system.git"
    storageType: bare`;
  const configContent = `schemaVersion: system-config/v1
id: test-system
cosmicStar: Vega
mirrors:
${mirrors}
pinnedPlatform: "4.5.0"
status: active
registeredAt: "2026-01-01T00:00:00Z"
notes: ""
`;
  writeFileSync(join(cacheDir, "system-config.yaml"), configContent);
  const stateContent = `schemaVersion: system-state/v1
systemId: test-system
currentMission: test-system-m000001
lastRelease: null
`;
  writeFileSync(join(cacheDir, "system-state.yaml"), stateContent);

  // Create cache clone (non-bare) as a git repo
  gitInit(cacheDir);
  writeFileSync(join(cacheDir, "README.md"), "# system\n");
  gitCommit(cacheDir, "initial system");

  // Create bordbuch dir
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), "");
  gitCommit(cacheDir, "add bordbuch");

  // Create bare repo
  const bareDir = join(testRoot, "systems-cache", "test-system.git");
  execSync(`git clone --bare ${JSON.stringify(cacheDir)} ${JSON.stringify(bareDir)}`, {
    stdio: "pipe",
  });

  // Add origin remote to cache clone
  execSync(`git remote add origin ${JSON.stringify(bareDir)}`, {
    cwd: cacheDir,
    stdio: "pipe",
  });

  // Create mission
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
    openedAt: "2026-08-05T00:00:00.000Z",
    openedBy: "test-agent",
    closedAt: null,
    closedBy: null,
    pinAtOpen: "1.0.0",
    materializedAt: "2026-08-05T01:00:00.000Z",
    migratedAt: null,
    reconciledAt: null,
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");

  // Create validation-report.json so reconcile's validation gate passes
  writeFileSync(
    join(missionDir, "evidence", "validation-report.json"),
    JSON.stringify({ contractFull: { passed: true }, timestamp: "2026-08-05T01:30:00.000Z" }) +
      "\n",
  );

  // Create workpiece as a clone of the cache clone (shared history for merge)
  const workpieceDir = join(missionDir, "workpiece");
  execSync(`git clone ${JSON.stringify(cacheDir)} ${JSON.stringify(workpieceDir)}`, {
    stdio: "pipe",
  });
  mkdirSync(join(workpieceDir, "src", "content"), { recursive: true });
  writeFileSync(join(workpieceDir, "src", "content", "system.md"), "---\nid: test\n---\n# Test\n");
  gitCommit(workpieceDir, "workpiece change");

  gitCommit(tmpWorkspace, "add mission");
}

test("reconcile with external mirrors calls sternsystem.sync and sets mirrorSync.succeeded=true", async () => {
  setupReconcileWorkspace({ externalMirrors: true });

  const { runMissionReconcile } = await import("../mission/mission-materialization-commands.ts");

  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionReconcile(input, context);
  const data = expectData(result);

  expect(data.mirrorSync).toBeDefined();
  expect(data.mirrorSync!.attempted).toBe(true);
  expect(data.mirrorSync!.succeeded).toBe(true);
  expect(data.mirrorSync!.error).toBeNull();
  expect(result.summary).toContain("mirrors synced");
});

test("reconcile with sync failure sets mirrorSync.succeeded=false and completes (non-fatal)", async () => {
  setupReconcileWorkspace({ externalMirrors: true });

  // Make executeKernelCommand throw
  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
  vi.mocked(executeKernelCommand).mockRejectedValueOnce(new Error("Connection timed out"));

  const { runMissionReconcile } = await import("../mission/mission-materialization-commands.ts");

  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionReconcile(input, context);
  const data = expectData(result);

  expect(data.mirrorSync).toBeDefined();
  expect(data.mirrorSync!.attempted).toBe(true);
  expect(data.mirrorSync!.succeeded).toBe(false);
  expect(data.mirrorSync!.error).toContain("Connection timed out");
  expect(result.summary).toContain("mirror sync failed");
});

test("reconcile without external mirrors does not attempt sync", async () => {
  setupReconcileWorkspace({ externalMirrors: false });

  const { runMissionReconcile } = await import("../mission/mission-materialization-commands.ts");

  const input = {
    flags: { mission: "test-system-m000001" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionReconcile(input, context);
  const data = expectData(result);

  expect(data.mirrorSync).toBeUndefined();
  expect(result.summary).not.toContain("mirror sync");
});

// --- Close tests ---

function setupCloseWorkspace(opts?: { externalMirrors?: boolean; desynced?: boolean }): void {
  gitInit(tmpWorkspace);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommit(tmpWorkspace, "initial");
  writeFileSync(join(tmpWorkspace, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  gitCommit(tmpWorkspace, "add package.json");

  const cacheDir = join(testRoot, "systems-cache", "test-system");
  mkdirSync(cacheDir, { recursive: true });
  const mirrors = opts?.externalMirrors
    ? `  - path: "../systems-cache/test-system"
    storageType: non-bare
  - path: "../systems-cache/test-system.git"
    storageType: bare
  - path: "git@github.com:warpgogol/test-system.git"
    storageType: bare`
    : `  - path: "../systems-cache/test-system"
    storageType: non-bare
  - path: "../systems-cache/test-system.git"
    storageType: bare`;
  const configContent = `schemaVersion: system-config/v1
id: test-system
cosmicStar: Vega
mirrors:
${mirrors}
pinnedPlatform: "4.5.0"
status: active
registeredAt: "2026-01-01T00:00:00Z"
notes: ""
`;
  writeFileSync(join(cacheDir, "system-config.yaml"), configContent);
  const stateContent = `schemaVersion: system-state/v1
systemId: test-system
currentMission: test-system-m000001
lastRelease: null
`;
  writeFileSync(join(cacheDir, "system-state.yaml"), stateContent);

  // Create cache clone (non-bare) as a git repo
  gitInit(cacheDir);
  writeFileSync(join(cacheDir, "README.md"), "# system\n");
  gitCommit(cacheDir, "initial system");

  // Create bordbuch dir
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), "");
  gitCommit(cacheDir, "add bordbuch");

  // Create bare repo
  const bareDir = join(testRoot, "systems-cache", "test-system.git");
  execSync(`git clone --bare ${JSON.stringify(cacheDir)} ${JSON.stringify(bareDir)}`, {
    stdio: "pipe",
  });

  // Add origin remote to cache clone
  execSync(`git remote add origin ${JSON.stringify(bareDir)}`, {
    cwd: cacheDir,
    stdio: "pipe",
  });

  // If external mirrors and desynced, set up a mirror ref that differs from origin
  if (opts?.externalMirrors && opts?.desynced) {
    // Create a different commit in the bare repo's mirror ref
    try {
      execSync(
        `git update-ref refs/mirror/main ${JSON.stringify("0000000000000000000000000000000000000000")}`,
        {
          cwd: bareDir,
          stdio: "pipe",
        },
      );
    } catch {
      // ref doesn't exist yet — that's fine, it will cause mirrorSha to be null
    }
  }

  // Create system.pin.json
  writeFileSync(
    join(cacheDir, "system.pin.json"),
    JSON.stringify({ platform: { version: "1.0.0" } }, null, 2) + "\n",
  );
  gitCommit(cacheDir, "add pin");

  // Create mission
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
    openedAt: "2026-08-05T00:00:00.000Z",
    openedBy: "test-agent",
    closedAt: null,
    closedBy: null,
    pinAtOpen: "1.0.0",
    materializedAt: "2026-08-05T01:00:00.000Z",
    migratedAt: null,
    reconciledAt: "2026-08-05T02:00:00.000Z",
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");

  // Create workpiece as a git repo
  const workpieceDir = join(missionDir, "workpiece");
  gitInit(workpieceDir);
  writeFileSync(join(workpieceDir, "README.md"), "# workpiece\n");
  gitCommit(workpieceDir, "materialize from pin 1.0.0");
  // RFC-0820: operator commit to pass zero-commit guard
  writeFileSync(join(workpieceDir, "README.md"), "# workpiece changed\n");
  gitCommit(workpieceDir, "operator: test changes");

  const workpieceHead = execSync("git rev-parse HEAD", {
    cwd: workpieceDir,
    stdio: "pipe",
    encoding: "utf-8",
  }).trim();
  writeFileSync(
    join(missionDir, "evidence", "reconciliation-report.json"),
    JSON.stringify({ workpieceHeadAtReconcile: workpieceHead }) + "\n",
  );

  gitCommit(tmpWorkspace, "add mission");
}

// Mock mission.validate for close tests
vi.mock("../mission/mission-materialization-commands.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../mission/mission-materialization-commands.ts")>();
  return {
    ...actual,
    runMissionValidate: vi.fn(async () => ({
      data: {
        missionId: "test-system-m000001",
        contractFull: { passed: true, validators: [] },
        build: { succeeded: true, routeCount: 5, sitemapHash: "abc" },
      },
      exitCode: 0,
      summary: "Validation passed",
    })),
    runMissionMaterialize: vi.fn(),
    runMissionMigrate: vi.fn(),
  };
});

test("close with desynced external mirrors throws with actionable error", async () => {
  setupCloseWorkspace({ externalMirrors: true, desynced: true });

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent", "skip-evidence-sync": true },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  await expect(runMissionClose(input, context)).rejects.toThrow(
    /external mirrors are out of sync for system 'test-system'/,
  );

  // Verify mission is still open
  const fs = await import("node:fs/promises");
  const manifestRaw = await fs.readFile(
    join(tmpWorkspace, "missions", "test-system-m000001", "mission.yaml"),
    "utf8",
  );
  const manifest = JSON.parse(manifestRaw);
  expect(manifest.state).toBe("open");
});

test("close with no external mirrors does not throw on mirror check", async () => {
  setupCloseWorkspace({ externalMirrors: false });

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent", "skip-evidence-sync": true },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  // Should not throw about mirror sync — may throw about other things (e.g. evidence sync)
  // but the error must NOT contain "external mirrors are out of sync"
  try {
    await runMissionClose(input, context);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    expect(msg).not.toContain("external mirrors are out of sync");
  }
});
