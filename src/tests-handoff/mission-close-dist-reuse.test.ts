/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0918: integration test verifying mission.close succeeds without
    --skip-reconcile-check when distribution dist exists and build-input-hash
    matches. Confirms the dist-reuse path (RFC-0635) is active during close's
    inline validation — runMissionValidate is called without force: true.
  </purpose>
  <keywords>RFC-0918, RFC-0635, mission.close, dist-reuse, distribution, build-input-hash, inline validate</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0918: initial integration test for dist-reuse path during mission.close inline validate.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { tmpdir } from "node:os";

const mockState = vi.hoisted(() => ({
  validateResult: {
    data: null as Record<string, unknown> | null,
    exitCode: 0,
    summary: "",
  },
  validateCallFlags: null as Record<string, unknown> | null,
}));

vi.mock("../sternsystem/registry-io.ts", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    resolveCacheClonePath: vi.fn((workspaceRoot: string, systemId: string) =>
      join(workspaceRoot, "..", "systems-cache", systemId),
    ),
    readSystemConfigSmart: vi.fn(async () => ({
      schemaVersion: "system-config/v1",
      id: "test-system",
      cosmicStar: "Vega",
      mirrors: [{ path: "../systems-cache/test-system", storageType: "non-bare" }],
      pinnedPlatform: "4.5.0",
      status: "active",
      registeredAt: "2026-01-01T00:00:00Z",
      notes: "",
    })),
    readSystemState: vi.fn(async () => ({
      schemaVersion: "1.0.0",
      id: "test-system",
      currentMission: "test-system-m000001",
      lastRelease: null,
    })),
    writeSystemState: vi.fn(async () => {}),
  };
});

vi.mock("../mission/mission-materialization-commands.ts", () => ({
  runMissionValidate: vi.fn(async (input: KernelCommandInput) => {
    mockState.validateCallFlags = input.flags;
    return mockState.validateResult;
  }),
  runMissionMaterialize: vi.fn(),
  runMissionMigrate: vi.fn(),
  runMissionReconcile: vi.fn(),
}));

vi.mock("../bordbuch/bordbuch-io.ts", () => ({
  validateBordbuch: vi.fn(async () => ({ violations: [], checked: true })),
  readBordbuch: vi.fn(async () => []),
}));

vi.mock("../bordbuch/bordbuch-commit-helper.ts", () => ({
  appendAndCommitBordbuch: vi.fn(async () => ({
    commitResult: { commitSha: "abc123", pushed: true, error: null },
  })),
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelCommand: vi.fn(async (args: { commandName: string }) => {
      if (args.commandName === "sternsystem.pin") {
        return {
          exitCode: 0,
          data: { systemId: "test-system", pinnedVersion: "1.0.0" },
          summary: "pinned",
        };
      }
      return { exitCode: 0, data: {}, summary: "ok" };
    }),
  };
});

function gitInit(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
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
  testRoot = mkdtempSync(join(tmpdir(), "tmp-rfc-0918-close-"));
  tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });
  mockState.validateResult = { data: null, exitCode: 0, summary: "" };
  mockState.validateCallFlags = null;
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setupWorkspace(): string {
  gitInit(testRoot);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommit(testRoot, "initial");

  const cacheDir = join(testRoot, "systems-cache", "test-system");
  mkdirSync(cacheDir, { recursive: true });
  const configContent = `schemaVersion: system-config/v1
id: test-system
cosmicStar: Vega
mirrors:
  - path: "../systems-cache/test-system"
    storageType: non-bare
pinnedPlatform: "4.5.0"
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
  gitCommit(testRoot, "add system");

  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  mkdirSync(missionDir, { recursive: true });
  mkdirSync(join(missionDir, "workpiece"), { recursive: true });
  mkdirSync(join(missionDir, "evidence"), { recursive: true });

  gitInit(join(missionDir, "workpiece"));
  mkdirSync(join(missionDir, "workpiece", "src", "content"), { recursive: true });
  writeFileSync(join(missionDir, "workpiece", "src", "content", "test.md"), "# test\n");
  execSync("git add -A", { cwd: join(missionDir, "workpiece"), stdio: "pipe" });
  execSync('git commit -m "materialize from pin 1.0.0"', {
    cwd: join(missionDir, "workpiece"),
    stdio: "pipe",
  });

  // Add operator commit to pass ZERO-COMMIT-GUARD
  writeFileSync(
    join(missionDir, "workpiece", "src", "content", "test.md"),
    "# test with operator changes\n",
  );
  gitCommit(join(missionDir, "workpiece"), "operator: add content changes");

  const manifest = {
    schemaVersion: "1.0.0",
    missionId: "test-system-m000001",
    systemId: "test-system",
    state: "open",
    brief: "Test mission for dist-reuse",
    openedAt: "2026-08-22T00:00:00.000Z",
    openedBy: "test-agent",
    closedAt: null,
    closedBy: null,
    pinAtOpen: "1.0.0",
    materializedAt: "2026-08-22T01:00:00.000Z",
    migratedAt: null,
    reconciledAt: "2026-08-22T02:00:00.000Z",
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");

  gitCommit(testRoot, "add mission");
  return missionDir;
}

function makePassingValidation(): void {
  mockState.validateResult = {
    data: {
      missionId: "test-system-m000001",
      contractFull: { passed: true, validators: [] },
      build: { succeeded: true, routeCount: 5, sitemapHash: "abc" },
      distributionReused: true,
      buildInputHash: "sha256:matching-hash",
      fullBuildRan: false,
    },
    exitCode: 0,
    summary: "Validation passed (distribution reused)",
  };
}

function writeReconcileReport(missionDir: string, workpieceHead: string): void {
  const report = {
    schemaVersion: "1.0.0",
    missionId: "test-system-m000001",
    systemId: "test-system",
    commitSha: "abc123",
    preReconcileSha: "def456",
    reconciledAt: "2026-08-22T02:00:00.000Z",
    mergeCommitSha: "ghi789",
    transferredCommits: 1,
    zeroTransferWarning: false,
    message: "reconcile",
    copiedPaths: [],
    autoResolvedPaths: [],
    workpieceHeadAtReconcile: workpieceHead,
    gitignoreRestored: false,
    forbiddenFilesUntracked: [],
  };
  writeFileSync(
    join(missionDir, "evidence", "reconciliation-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}

function getWorkpieceHead(missionDir: string): string {
  return execSync("git rev-parse HEAD", {
    cwd: join(missionDir, "workpiece"),
    encoding: "utf-8",
  }).trim();
}

test("RFC-0918: mission.close succeeds without --skip-reconcile-check when dist reuse is active", async () => {
  const missionDir = setupWorkspace();
  makePassingValidation();

  const workpieceHead = getWorkpieceHead(missionDir);
  writeReconcileReport(missionDir, workpieceHead);

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionClose(input, context);

  // mission.close succeeded
  expect(result.data?.state).toBe("closed");

  // Inline validate was called (runMissionValidate mock was invoked)
  expect(mockState.validateCallFlags).not.toBeNull();

  // The key assertion: force flag was NOT set — dist-reuse path is active
  expect(mockState.validateCallFlags).not.toHaveProperty("force");
  expect(mockState.validateCallFlags?.force).toBeUndefined();

  // The validate result indicates distribution was reused
  expect(mockState.validateResult.data?.distributionReused).toBe(true);
  expect(mockState.validateResult.data?.fullBuildRan).toBe(false);
});
