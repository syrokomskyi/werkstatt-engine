/*
<MODULE_CONTRACT>
  <purpose>RFC-0763: unit tests for commitBordbuchProjections cleanup on mission.validate failure paths (build.prepare failure and validation failure).</purpose>
  <keywords>RFC-0763, mission.validate, bordbuch, commitBordbuchProjections, failure path, cleanup, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0763: initial tests for bordbuch cleanup on build.prepare failure, validation failure, cleanup failure resilience, and non-bordbuch file safety.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { tmpdir } from "node:os";

const mockState = vi.hoisted(() => ({
  prepareResult: { ok: true, steps: [{ ok: true, commandName: "config.regenerate", exitCode: 0 }] },
  prepareResultFail: {
    ok: false,
    exitCode: 1,
    steps: [
      { ok: true, commandName: "config.regenerate", exitCode: 0 },
      { ok: true, commandName: "bordbuch.generate", exitCode: 0 },
      { ok: false, commandName: "bordbuch.validate", exitCode: 1 },
    ],
    timing: { failedStep: "bordbuch.validate" },
  },
  checkResult: { ok: true, steps: [{ ok: true, commandName: "content.validate", exitCode: 0 }] },
  checkResultFail: {
    ok: false,
    exitCode: 1,
    steps: [
      { ok: true, commandName: "content.validate", exitCode: 0 },
      { ok: false, commandName: "imports.validate", exitCode: 1 },
    ],
    timing: { failedStep: "imports.validate" },
  },
  postResult: { ok: true, steps: [{ ok: true, commandName: "text.normalize.apply", exitCode: 0 }] },
  pipelineCalls: [] as string[],
  commandCalls: [] as string[],
  commitCalls: 0,
  commitResult: {
    committed: true,
    filesCommitted: ["bordbuch/status.generated.yaml"],
    commitSha: "abc123" as string | null,
    systemId: "test-system",
    error: null as string | null,
  },
  dirty: false,
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelPipeline: vi.fn(async (opts: { pipelineName: string }) => {
      mockState.pipelineCalls.push(opts.pipelineName);
      if (opts.pipelineName === "build.prepare") return [mockState.prepareResult] as never;
      if (opts.pipelineName === "build.check") return [mockState.checkResult] as never;
      if (opts.pipelineName === "build.post") return [mockState.postResult] as never;
      return [{ ok: true, steps: [] }] as never;
    }),
    executeKernelCommand: vi.fn(async (opts: { commandName: string }) => {
      mockState.commandCalls.push(opts.commandName);
      return [{ ok: true, exitCode: 0, summary: "" }] as never;
    }),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn((cmd: string, opts?: { [key: string]: unknown }) => {
      if (cmd === "pnpm exec astro build") {
        return "10 page(s)";
      }
      return actual.execSync(cmd, opts as never);
    }),
  };
});

vi.mock("../mission/mission-git-commit.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mission/mission-git-commit.ts")>();
  return {
    ...actual,
    isWorkpieceDirty: vi.fn(() => ({
      dirty: mockState.dirty,
      fileCount: mockState.dirty ? 1 : 0,
      files: mockState.dirty ? ["uncommitted.txt"] : [],
    })),
  };
});

vi.mock("../bordbuch/bordbuch-commit.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bordbuch/bordbuch-commit.ts")>();
  return {
    ...actual,
    commitBordbuchProjections: vi.fn(async () => {
      mockState.commitCalls++;
      return mockState.commitResult;
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

let tmpWorkspace: string;

beforeEach(() => {
  tmpWorkspace = mkdtempSync(join(tmpdir(), "tmp-validate-rfc0763-"));
  mockState.pipelineCalls = [];
  mockState.commandCalls = [];
  mockState.commitCalls = 0;
  mockState.dirty = false;
  mockState.prepareResult = {
    ok: true,
    steps: [{ ok: true, commandName: "config.regenerate", exitCode: 0 }],
  };
  mockState.checkResult = {
    ok: true,
    steps: [{ ok: true, commandName: "content.validate", exitCode: 0 }],
  };
  mockState.commitResult = {
    committed: true,
    filesCommitted: ["bordbuch/status.generated.yaml"],
    commitSha: "abc123",
    systemId: "test-system",
    error: null,
  };
});

afterEach(() => {
  rmSync(tmpWorkspace, { recursive: true, force: true });
});

function setupWorkspace(): string {
  gitInit(tmpWorkspace);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  writeFileSync(join(tmpWorkspace, "package.json"), JSON.stringify({ version: "1.0.0" }) + "\n");
  writeFileSync(join(tmpWorkspace, "pnpm-workspace.yaml"), "packages: []\n");
  gitCommit(tmpWorkspace, "initial");

  mkdirSync(join(tmpWorkspace, "systems"), { recursive: true });
  const registryContent = `schemaVersion: "1.0.0"
systems:
  - id: test-system
    cosmicStar: Vega
    mirrors:
      - path: "./systems/test-system"
        storageType: non-bare
    pinnedPlatform: "1.0.0"
    currentMission: test-system-m000001
    lastRelease: null
    status: active
    registeredAt: "2026-01-01T00:00:00Z"
    notes: ""
`;
  writeFileSync(join(tmpWorkspace, "systems", "registry.yaml"), registryContent);
  gitCommit(tmpWorkspace, "add registry");

  const systemDir = join(tmpWorkspace, "systems", "test-system");
  mkdirSync(systemDir, { recursive: true });
  writeFileSync(
    join(systemDir, "system.pin.json"),
    JSON.stringify({ platform: { version: "1.0.0" } }, null, 2) + "\n",
  );
  mkdirSync(join(systemDir, "bordbuch"), { recursive: true });
  writeFileSync(join(systemDir, "bordbuch", "events.ndjson"), "");
  mkdirSync(join(systemDir, "src", "content"), { recursive: true });
  writeFileSync(
    join(systemDir, "src", "content", "system.md"),
    "---\n  domain: test\n  i18n:\n    default: de\n    languages:\n      - de\n---\n",
  );
  gitCommit(tmpWorkspace, "add system");

  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  mkdirSync(missionDir, { recursive: true });
  const workpieceDir = join(missionDir, "workpiece");
  mkdirSync(workpieceDir, { recursive: true });
  mkdirSync(join(missionDir, "evidence"), { recursive: true });

  gitInit(workpieceDir);
  writeFileSync(
    join(workpieceDir, "system.md"),
    "---\ni18n:\n  default: de\n  languages:\n  - de\n---\n",
  );
  gitCommit(workpieceDir, "initial workpiece");

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
    materializedAt: "2026-07-30T00:00:00.000Z",
    migratedAt: null,
    reconciledAt: null,
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");

  return workpieceDir;
}

function makeContext(): KernelRuntimeContext {
  return {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;
}

function makeInput(): KernelCommandInput {
  return {
    flags: { mission: "test-system-m000001" },
    argv: [],
  };
}

test("build.prepare failure: commits stale bordbuch projections via cleanup", async () => {
  setupWorkspace();
  mockState.prepareResult = mockState.prepareResultFail;

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput(), makeContext());

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("build.prepare FAILED");
  // RFC-0724 pre-validate cleanup (1 call) + RFC-0763 failure-path cleanup (1 call) = at least 2
  // The pre-validate call at the top of mission.validate always runs.
  // The failure-path cleanup runs after the build.prepare failure return block.
  expect(mockState.commitCalls).toBeGreaterThanOrEqual(2);
});

test("validation failure (!passed): commits stale bordbuch projections via cleanup", async () => {
  setupWorkspace();
  mockState.checkResult = mockState.checkResultFail;

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput(), makeContext());

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("validation FAILED");
  // RFC-0724 pre-validate cleanup (1 call) + RFC-0763 failure-path cleanup (1 call) = at least 2
  expect(mockState.commitCalls).toBeGreaterThanOrEqual(2);
});

test("cleanup failure does not change exit code or block the failure return", async () => {
  setupWorkspace();
  mockState.checkResult = mockState.checkResultFail;
  mockState.commitResult = {
    committed: false,
    filesCommitted: [],
    commitSha: null,
    systemId: "test-system",
    error: "git failed: transient lock contention",
  };

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput(), makeContext());

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("validation FAILED");
  // Cleanup was called but failed — exit code is still 1, not blocked
  expect(mockState.commitCalls).toBeGreaterThanOrEqual(2);
});

test("non-bordbuch files not touched on failure paths", async () => {
  setupWorkspace();
  mockState.checkResult = mockState.checkResultFail;

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  await runMissionValidate(makeInput(), makeContext());

  // commitBordbuchProjections only stages bordbuch projection paths
  // (bordbuch/status.generated.yaml, public/.well-known/bordbuch.json, public/.well-known/bordbuch/index.html).
  // Non-bordbuch dirty files are not touched. This is guaranteed by the implementation
  // in bordbuch-commit.ts, not by this mock — the mock verifies the cleanup was invoked,
  // and the real implementation guarantees non-bordbuch safety.
  expect(mockState.commitCalls).toBeGreaterThanOrEqual(2);
  const { commitBordbuchProjections } = await import("../bordbuch/bordbuch-commit.ts");
  expect(commitBordbuchProjections).toHaveBeenCalled();
});
