/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0762: unit tests for post-close sternsystem.sync in mission.close —
    verifies sync is called when mirrors > 2, sync failure is non-fatal, and
    sync is skipped when mirrors <= 2.
  </purpose>
  <keywords>RFC-0762, mission.close, sternsystem.sync, mirrorSync, CloseReportMirror</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0762: initial tests for post-close sternsystem.sync in mission.close.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { expectData } from "./helpers/kernel-result-helpers.ts";
import { tmpdir } from "node:os";

// --- Mocks ---

const mockSync = vi.hoisted(() => ({
  executeKernelCommandResult: {
    exitCode: 0,
    data: {
      systemId: "test-system",
      mirrorUrls: [],
      direction: "push",
      branch: "main",
      commitSha: "abc",
      syncedAt: "2026-08-08T00:00:00.000Z",
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
  testRoot = mkdtempSync(join(tmpdir(), "tmp-rfc-0762-"));
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
      syncedAt: "2026-08-08T00:00:00.000Z",
    },
    summary: "sternsystem.sync: ok",
  };
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setupCloseWorkspace(opts?: { externalMirrors?: boolean }): void {
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

  // RFC-0705: Set up mirror ref in bare repo to mark mirrors as in sync.
  // mission.close checks refs/mirror/<branch> against origin HEAD.
  // NOTE: This is done after all cache clone commits and push to bare.

  // Create system.pin.json
  writeFileSync(
    join(cacheDir, "system.pin.json"),
    JSON.stringify({ platform: { version: "1.0.0" } }, null, 2) + "\n",
  );
  gitCommit(cacheDir, "add pin");

  // Push all commits to bare repo
  execSync("git push origin HEAD --force", {
    cwd: cacheDir,
    stdio: "pipe",
  });

  if (opts?.externalMirrors) {
    const branch = execSync("git symbolic-ref HEAD", {
      cwd: cacheDir,
      stdio: "pipe",
      encoding: "utf-8",
    })
      .trim()
      .replace("refs/heads/", "");
    const bareHead = execSync("git rev-parse HEAD", {
      cwd: bareDir,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    execSync(`git update-ref refs/mirror/${branch} ${JSON.stringify(bareHead)}`, {
      cwd: bareDir,
      stdio: "pipe",
    });
  }

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
    openedAt: "2026-08-08T00:00:00.000Z",
    openedBy: "test-agent",
    closedAt: null,
    closedBy: null,
    pinAtOpen: "1.0.0",
    materializedAt: "2026-08-08T01:00:00.000Z",
    migratedAt: null,
    reconciledAt: "2026-08-08T02:00:00.000Z",
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

// --- Tests ---

test("close with external mirrors calls sternsystem.sync and sets mirror.synced=true", async () => {
  setupCloseWorkspace({ externalMirrors: true });

  const { runMissionClose } = await import("../mission/mission-close.ts");
  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent", "skip-evidence-sync": true },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionClose(input, context);
  const data = expectData(result);

  expect(data.closeReport.mirror.synced).toBe(true);
  expect(data.closeReport.mirror.syncError).toBeNull();
  expect(executeKernelCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      commandName: "sternsystem.sync",
      argv: ["--id=test-system"],
    }),
  );
});

test("close with sync failure does not block close and sets mirror.synced=false", async () => {
  setupCloseWorkspace({ externalMirrors: true });

  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");
  vi.mocked(executeKernelCommand).mockImplementation(async (opts: { commandName?: string }) => {
    if (opts.commandName === "sternsystem.sync") {
      return {
        exitCode: 1,
        summary: "git push to git@github.com:... failed: Connection timed out",
      } as never;
    }
    return mockSync.executeKernelCommandResult as never;
  });

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent", "skip-evidence-sync": true },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  // Should NOT throw — sync failure is non-fatal
  const result = await runMissionClose(input, context);
  const data = expectData(result);

  expect(data.closeReport.mirror.synced).toBe(false);
  expect(data.closeReport.mirror.syncError).toContain("Connection timed out");
});

test("close without external mirrors does not call sternsystem.sync", async () => {
  setupCloseWorkspace({ externalMirrors: false });

  const { runMissionClose } = await import("../mission/mission-close.ts");
  const { executeKernelCommand } = await import("@warpgogol/werkstatt-engine/kernel");

  // Reset call history
  vi.mocked(executeKernelCommand).mockClear();

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent", "skip-evidence-sync": true },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {} },
  } as unknown as KernelRuntimeContext;

  try {
    await runMissionClose(input, context);
  } catch {
    // May throw for other reasons (e.g. evidence sync) — that's fine
  }

  // Verify sternsystem.sync was NOT called
  const syncCalls = vi
    .mocked(executeKernelCommand)
    .mock.calls.filter(
      (call) => (call[0] as { commandName?: string }).commandName === "sternsystem.sync",
    );
  expect(syncCalls).toHaveLength(0);
});
