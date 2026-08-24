/*
<MODULE_CONTRACT>
  <purpose>RFC-0652: unit tests for mission.close mandatory evidence.sync integration.</purpose>
  <keywords>RFC-0652, mission.close, evidence.sync, skip-evidence-sync, EVIDENCE_SYNC_FAILED</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0652: initial tests for mandatory evidence sync in mission.close.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createLeitstandSystem } from "./helpers/leitstand-fixture.ts";
import { tmpdir } from "node:os";

const mockState = vi.hoisted(() => ({
  validateResult: {
    data: {
      missionId: "test-system-m000001",
      contractFull: { passed: true, validators: [] },
      build: { succeeded: true, routeCount: 5, sitemapHash: "abc" },
    },
    exitCode: 0,
    summary: "Validation passed",
  },
  syncCalled: false,
  syncShouldFail: false,
  syncResult: {
    exitCode: 0,
    data: {
      missionId: "test-system-m000001",
      systemId: "test-system",
      runTimestamp: "2026-08-02T00-00-00-000Z",
      r2KeyPrefix: "test-system/test-system-m000001/2026-08-02T00-00-00-000Z",
      uploadedFiles: ["evidence-metadata.json", "raw/page-1.json"],
      skippedFiles: [],
      totalBytes: 1024,
      durationMs: 500,
    },
    summary: "[evidence.sync] uploaded 2 files to R2",
  },
}));

vi.mock("../mission/mission-materialization-commands.ts", () => ({
  runMissionValidate: vi.fn(async () => mockState.validateResult),
  runMissionMaterialize: vi.fn(),
  runMissionMigrate: vi.fn(),
  runMissionReconcile: vi.fn(),
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const original = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...original,
    executeKernelCommand: vi.fn(
      async (opts: { workspaceRoot: string; commandName: string; argv?: string[] }) => {
        if (opts.commandName === "evidence.sync") {
          mockState.syncCalled = true;
          if (mockState.syncShouldFail) {
            throw new Error("R2_UPLOAD_ERROR: failed to upload");
          }
          return mockState.syncResult;
        }
        return { exitCode: 0, data: {}, summary: "ok" };
      },
    ),
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
  testRoot = mkdtempSync(join(tmpdir(), "tmp-close-evidence-"));
  tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });
  mockState.syncCalled = false;
  mockState.syncShouldFail = false;
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function setupWorkspace(options?: {
  withAxiomEvidence?: boolean;
  withAxiomDirOnly?: boolean;
}): string {
  gitInit(tmpWorkspace);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommit(tmpWorkspace, "initial");

  createLeitstandSystem(testRoot, "test-system", {
    currentMission: "test-system-m000001",
  });

  const cacheDir = join(testRoot, "systems-cache", "test-system");
  mkdirSync(join(cacheDir, "bordbuch"), { recursive: true });
  writeFileSync(join(cacheDir, "bordbuch", "events.ndjson"), "");

  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  mkdirSync(missionDir, { recursive: true });
  mkdirSync(join(missionDir, "workpiece"), { recursive: true });
  mkdirSync(join(missionDir, "evidence"), { recursive: true });

  // RFC-0820: Create workpiece git repo with materialize + operator commit
  const workpieceDir = join(missionDir, "workpiece");
  gitInit(workpieceDir);
  writeFileSync(join(workpieceDir, "README.md"), "# workpiece\n");
  gitCommit(workpieceDir, "materialize from pin 1.0.0");
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

  if (options?.withAxiomEvidence) {
    const axiomDir = join(missionDir, "evidence", "axiom");
    mkdirSync(axiomDir, { recursive: true });
    writeFileSync(
      join(axiomDir, "evidence-metadata.json"),
      JSON.stringify(
        { auditId: "test-system-m000001", runTimestamp: "2026-08-02T00:00:00.000Z" },
        null,
        2,
      ) + "\n",
    );
  } else if (options?.withAxiomDirOnly) {
    const axiomDir = join(missionDir, "evidence", "axiom");
    mkdirSync(axiomDir, { recursive: true });
  }

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
    materializedAt: "2026-07-30T01:00:00.000Z",
    migratedAt: null,
    reconciledAt: "2026-07-30T02:00:00.000Z",
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");

  gitCommit(tmpWorkspace, "add mission");
  return cacheDir;
}

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return { flags, argv: [] } as unknown as KernelCommandInput;
}

function makeContext(): KernelRuntimeContext {
  return {
    workspaceRoot: tmpWorkspace,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
      debug: () => {},
    },
  } as unknown as KernelRuntimeContext;
}

test("mission.close invokes evidence.sync when evidence/axiom/ with metadata exists", async () => {
  setupWorkspace({ withAxiomEvidence: true });
  const { runMissionClose } = await import("../mission/mission-close.ts");

  await runMissionClose(
    makeInput({ mission: "test-system-m000001", actor: "test-agent" }),
    makeContext(),
  );

  expect(mockState.syncCalled).toBe(true);
});

test("mission.close throws EVIDENCE_SYNC_FAILED when evidence.sync fails", async () => {
  setupWorkspace({ withAxiomEvidence: true });
  mockState.syncShouldFail = true;
  const { runMissionClose } = await import("../mission/mission-close.ts");

  await expect(
    runMissionClose(
      makeInput({ mission: "test-system-m000001", actor: "test-agent" }),
      makeContext(),
    ),
  ).rejects.toThrow("EVIDENCE_SYNC_FAILED");
});

test("mission.close --skip-evidence-sync skips sync and does not call evidence.sync", async () => {
  setupWorkspace({ withAxiomEvidence: true });
  const { runMissionClose } = await import("../mission/mission-close.ts");

  await runMissionClose(
    makeInput({ mission: "test-system-m000001", actor: "test-agent", "skip-evidence-sync": true }),
    makeContext(),
  );

  expect(mockState.syncCalled).toBe(false);
});

test("mission.close skips sync with warning when evidence/axiom/ exists but metadata missing", async () => {
  setupWorkspace({ withAxiomDirOnly: true });
  const { runMissionClose } = await import("../mission/mission-close.ts");

  await runMissionClose(
    makeInput({ mission: "test-system-m000001", actor: "test-agent" }),
    makeContext(),
  );

  expect(mockState.syncCalled).toBe(false);
});

test("mission.close skips sync silently when evidence/axiom/ does not exist", async () => {
  setupWorkspace();
  const { runMissionClose } = await import("../mission/mission-close.ts");

  await runMissionClose(
    makeInput({ mission: "test-system-m000001", actor: "test-agent" }),
    makeContext(),
  );

  expect(mockState.syncCalled).toBe(false);
});

test("mission.close --json includes evidenceSynced and evidenceSyncResult fields", async () => {
  setupWorkspace({ withAxiomEvidence: true });
  const { runMissionClose } = await import("../mission/mission-close.ts");

  const result = await runMissionClose(
    makeInput({ mission: "test-system-m000001", actor: "test-agent" }),
    makeContext(),
  );

  const data = result.data as Record<string, unknown> | undefined;
  expect(data?.evidenceSynced).toBe(true);
  expect(data?.evidenceSyncResult).toEqual({
    r2KeyPrefix: "test-system/test-system-m000001/2026-08-02T00-00-00-000Z",
    uploadedFiles: 2,
  });
});

test("mission.close --skip-evidence-sync sets evidenceSynced=false in output", async () => {
  setupWorkspace({ withAxiomEvidence: true });
  const { runMissionClose } = await import("../mission/mission-close.ts");

  const result = await runMissionClose(
    makeInput({ mission: "test-system-m000001", actor: "test-agent", "skip-evidence-sync": true }),
    makeContext(),
  );

  const data = result.data as Record<string, unknown> | undefined;
  expect(data?.evidenceSynced).toBe(false);
  expect(data?.evidenceSyncResult).toBe(null);
});
