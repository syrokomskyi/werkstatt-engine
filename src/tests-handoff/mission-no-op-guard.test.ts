/*
<MODULE_CONTRACT>
<purpose>RFC-0820: unit tests for three-level silent no-op mission loss prevention guards.</purpose>
<keywords>RFC-0820, mission.git.commit, mission.close, mission.reconcile, zero-commit, no-op guard</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0820: initial tests for three-level no-op guard (git.commit warning, close zero-commit block, reconcile zero-transfer warning).</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Mocks — same pattern as rfc-0658-mission-close-bordbuch-validate.test.ts
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  testRoot = mkdtempSync(join(tmpdir(), "tmp-no-op-guard-"));
  tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });
  mockState.validateResult = { data: null, exitCode: 0, summary: "" };
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setupWorkspace(opts?: { withOperatorCommit?: boolean }): void {
  gitInit(testRoot);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommit(testRoot, "initial");

  // systems-cache as sibling of workspace (same as rfc-0658 pattern)
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

  // Create workpiece git repo with materialize-style commit
  gitInit(join(missionDir, "workpiece"));
  mkdirSync(join(missionDir, "workpiece", "src", "content"), { recursive: true });
  writeFileSync(join(missionDir, "workpiece", "src", "content", "test.md"), "# test\n");
  execSync("git add -A", { cwd: join(missionDir, "workpiece"), stdio: "pipe" });
  execSync('git commit -m "materialize from pin 1.0.0"', {
    cwd: join(missionDir, "workpiece"),
    stdio: "pipe",
  });

  // Optionally add an operator commit
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

  // RFC-0913: write reconciliation report so freshness gate passes
  const workpieceHead = execSync("git rev-parse HEAD", {
    cwd: join(missionDir, "workpiece"),
    encoding: "utf-8",
  }).trim();
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

  gitCommit(testRoot, "add mission");
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

// ---------------------------------------------------------------------------
// Level 1: mission.git.commit — noChanges field and warning
// ---------------------------------------------------------------------------

test("Level 1: mission.git.commit returns noChanges=true when workpiece is clean", async () => {
  setupWorkspace();

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");

  const input = {
    flags: { mission: "test-system-m000001", message: "test commit" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionGitCommit(input, context);

  expect(result.data?.noChanges).toBe(true);
  expect(result.summary).toContain("no changes to commit");
});

test("Level 1: mission.git.commit returns noChanges undefined when there are changes", async () => {
  setupWorkspace();

  // Add a change to the workpiece
  const workpieceDir = join(tmpWorkspace, "missions", "test-system-m000001", "workpiece");
  writeFileSync(join(workpieceDir, "src", "content", "test.md"), "# changed content\n");

  const { runMissionGitCommit } = await import("../mission/mission-git-commit.ts");

  const input = {
    flags: { mission: "test-system-m000001", message: "real changes" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionGitCommit(input, context);

  expect(result.data?.noChanges).toBeUndefined();
  expect(result.summary).toContain("committed");
});

// ---------------------------------------------------------------------------
// Level 2: mission.close — zero-commit guard
// ---------------------------------------------------------------------------

test("Level 2: mission.close blocks when zero operator commits since materialization", async () => {
  setupWorkspace({ withOperatorCommit: false });
  makePassingValidation();

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;

  await expect(runMissionClose(input, context)).rejects.toThrow(/ZERO-COMMIT-GUARD/);

  // Verify mission is still open
  const manifestRaw = readFileSync(
    join(tmpWorkspace, "missions", "test-system-m000001", "mission.yaml"),
    "utf8",
  );
  const manifest = JSON.parse(manifestRaw);
  expect(manifest.state).toBe("open");
});

test("Level 2: mission.close blocks with brief in error message", async () => {
  setupWorkspace({ withOperatorCommit: false });
  makePassingValidation();

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;

  await expect(runMissionClose(input, context)).rejects.toThrow(
    /Add founder positioning phrase to Person record bio/,
  );
});

test("Level 2: mission.close allows close with --allow-no-op when zero commits", async () => {
  setupWorkspace({ withOperatorCommit: false });
  makePassingValidation();

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent", "allow-no-op": true },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionClose(input, context);

  expect(result.data?.state).toBe("closed");
});

test("Level 2: mission.close proceeds normally when operator commits exist", async () => {
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

  const result = await runMissionClose(input, context);

  expect(result.data?.state).toBe("closed");
});

// ---------------------------------------------------------------------------
// Level 3: mission.reconcile — zero-transfer warning
// ---------------------------------------------------------------------------

test("Level 3: countOperatorCommits returns zero when only materialize commit exists", async () => {
  setupWorkspace({ withOperatorCommit: false });

  const { countOperatorCommits } = await import("../mission/mission-git-commit.ts");

  const workpieceDir = join(tmpWorkspace, "missions", "test-system-m000001", "workpiece");
  const result = countOperatorCommits(workpieceDir, null);

  expect(result.hasOperatorCommits).toBe(false);
  expect(result.commitCount).toBe(0);
});

test("Level 3: countOperatorCommits detects operator commits", async () => {
  setupWorkspace({ withOperatorCommit: true });

  const { countOperatorCommits } = await import("../mission/mission-git-commit.ts");

  const workpieceDir = join(tmpWorkspace, "missions", "test-system-m000001", "workpiece");
  const result = countOperatorCommits(workpieceDir, null);

  expect(result.hasOperatorCommits).toBe(true);
  expect(result.commitCount).toBeGreaterThanOrEqual(1);
});
