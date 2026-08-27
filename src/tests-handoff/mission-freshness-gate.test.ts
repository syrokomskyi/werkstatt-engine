/*
<MODULE_CONTRACT>
<purpose>RFC-0913: unit tests for reconcile-freshness gate in mission.close.</purpose>
<keywords>RFC-0913, mission.close, reconcile-freshness, skip-reconcile-check, workpieceHeadAtReconcile</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0913: initial tests for reconcile-freshness gate — blocks on mismatch, passes on match, fails closed on missing report, escape hatch works.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
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
  runMissionValidate: vi.fn(async () => mockState.validateResult),
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
  testRoot = mkdtempSync(join(tmpdir(), "tmp-freshness-"));
  tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });
  mockState.validateResult = { data: null, exitCode: 0, summary: "" };
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setupWorkspace(opts?: { withOperatorCommit?: boolean }): string {
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

  if (opts?.withOperatorCommit) {
    writeFileSync(
      join(missionDir, "workpiece", "src", "content", "test.md"),
      "# test with changes\n",
    );
    gitCommit(join(missionDir, "workpiece"), "operator: add content changes");
  }

  const manifest = {
    schemaVersion: "1.0.0",
    missionId: "test-system-m000001",
    systemId: "test-system",
    state: "open",
    brief: "Add founder positioning phrase to Person record bio",
    openedAt: "2026-07-30T00:00:00.000Z",
    openedBy: "test-agent",
    closedAt: null,
    closedBy: null,
    pinAtOpen: "1.0.0",
    materializedAt: "2026-07-30T01:00:00.000Z",
    migratedAt: null,
    reconciledAt: "2026-07-30T02:00:00.000Z",
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");

  gitCommit(testRoot, "add mission");
  return missionDir;
}

function makePassingValidation() {
  mockState.validateResult = {
    data: {
      missionId: "test-system-m000001",
      contractFull: { passed: true, validators: [] },
      build: { succeeded: true, routeCount: 5, sitemapHash: "abc" },
    },
    exitCode: 0,
    summary: "Validation passed",
  };
}

function writeReconcileReport(missionDir: string, workpieceHead: string): void {
  const report = {
    schemaVersion: "1.0.0",
    missionId: "test-system-m000001",
    systemId: "test-system",
    commitSha: "abc123",
    preReconcileSha: "def456",
    reconciledAt: "2026-07-30T02:00:00.000Z",
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

test("freshness gate: passes when workpiece HEAD matches workpieceHeadAtReconcile", async () => {
  const missionDir = setupWorkspace({ withOperatorCommit: true });
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

  expect(result.data?.state).toBe("closed");
  expect(result.data?.closeReport.reconcile.freshnessChecked).toBe(true);
  expect(result.data?.closeReport.reconcile.unreconciledCommits).toBe(0);
});

test("freshness gate: blocks when workpiece HEAD differs from workpieceHeadAtReconcile", async () => {
  const missionDir = setupWorkspace({ withOperatorCommit: true });
  makePassingValidation();

  const workpieceHead = getWorkpieceHead(missionDir);
  writeReconcileReport(missionDir, workpieceHead);

  // Add another commit after reconcile
  writeFileSync(
    join(missionDir, "workpiece", "src", "content", "test.md"),
    "# test with more changes\n",
  );
  gitCommit(join(missionDir, "workpiece"), "operator: more changes after reconcile");

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;

  await expect(runMissionClose(input, context)).rejects.toThrow(/unreconciled commit/);

  const manifestRaw = readFileSync(
    join(tmpWorkspace, "missions", "test-system-m000001", "mission.yaml"),
    "utf8",
  );
  const manifest = JSON.parse(manifestRaw);
  expect(manifest.state).toBe("open");
});

test("freshness gate: fails closed when reconciliation report is missing", async () => {
  setupWorkspace({ withOperatorCommit: true });
  makePassingValidation();

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;

  await expect(runMissionClose(input, context)).rejects.toThrow(/reconciliation report not found/);
});

test("freshness gate: blocks when report lacks workpieceHeadAtReconcile field", async () => {
  const missionDir = setupWorkspace({ withOperatorCommit: true });
  makePassingValidation();

  // Write report without workpieceHeadAtReconcile
  const report = {
    schemaVersion: "1.0.0",
    missionId: "test-system-m000001",
    systemId: "test-system",
    commitSha: "abc123",
    reconciledAt: "2026-07-30T02:00:00.000Z",
  };
  writeFileSync(
    join(missionDir, "evidence", "reconciliation-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;

  await expect(runMissionClose(input, context)).rejects.toThrow(
    /missing workpieceHeadAtReconcile field/,
  );
});

test("freshness gate: --skip-reconcile-check bypasses the gate", async () => {
  const missionDir = setupWorkspace({ withOperatorCommit: true });
  makePassingValidation();

  const workpieceHead = getWorkpieceHead(missionDir);
  writeReconcileReport(missionDir, workpieceHead);

  // Add another commit after reconcile
  writeFileSync(
    join(missionDir, "workpiece", "src", "content", "test.md"),
    "# test with more changes\n",
  );
  gitCommit(join(missionDir, "workpiece"), "operator: more changes after reconcile");

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: {
      mission: "test-system-m000001",
      actor: "test-agent",
      "skip-reconcile-check": true,
    },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionClose(input, context);

  expect(result.data?.state).toBe("closed");
  expect(result.data?.closeReport.reconcile.freshnessChecked).toBe(false);
});
