/*
<MODULE_CONTRACT>
<purpose>RFC-0615: unit tests for behavior snapshot auto-regeneration on SNAP-01 in mission.validate.</purpose>
<keywords>RFC-0615, mission.validate, SNAP-01, behavior snapshot, auto-regeneration, dirty workpiece, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0615: initial tests for SNAP-01 auto-regeneration, dirty workpiece skip, non-SNAP-01 skip, and persistent failure.</item>
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
  checkResult: { ok: true, steps: [{ ok: true, commandName: "content.validate", exitCode: 0 }] },
  postResult: { ok: true, steps: [{ ok: true, commandName: "text.normalize.apply", exitCode: 0 }] },
  postResultFail: {
    ok: false,
    exitCode: 1,
    steps: [
      { ok: true, commandName: "text.normalize.apply", exitCode: 0 },
      {
        ok: false,
        commandName: "behavior.snapshot.validate",
        exitCode: 1,
        data: {
          diagnostics: [{ ruleId: "SNAP-01", severity: "error", message: "snapshot mismatch" }],
        },
      },
    ],
    timing: { failedStep: "behavior.snapshot.validate" },
  },
  postResultNonSnap01: {
    ok: false,
    exitCode: 1,
    steps: [
      { ok: true, commandName: "text.normalize.apply", exitCode: 0 },
      {
        ok: false,
        commandName: "generated.stale.validate",
        exitCode: 1,
        data: { diagnostics: [{ ruleId: "STALE-01", severity: "error", message: "stale file" }] },
      },
    ],
    timing: { failedStep: "generated.stale.validate" },
  },
  postResultRevalidateOk: {
    ok: true,
    exitCode: 0,
    pipelineName: "build.post",
    steps: [{ ok: true, commandName: "behavior.snapshot.validate", exitCode: 0 }],
    timing: {},
  },
  postResultRevalidateFail: {
    ok: false,
    exitCode: 1,
    pipelineName: "build.post",
    steps: [
      {
        ok: false,
        commandName: "behavior.snapshot.validate",
        exitCode: 1,
        data: {
          diagnostics: [{ ruleId: "SNAP-01", severity: "error", message: "persistent mismatch" }],
        },
      },
    ],
    timing: { failedStep: "behavior.snapshot.validate" },
  },
  commandCalls: [] as string[],
  pipelineCalls: [] as string[],
  revalidateResult: null as { ok: boolean } | null,
  dirty: false,
  postResultOverride: null as { ok: boolean; steps: unknown[]; timing?: unknown } | null,
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelPipeline: vi.fn(async (opts: { pipelineName: string }) => {
      mockState.pipelineCalls.push(opts.pipelineName);
      if (opts.pipelineName === "build.prepare") return [mockState.prepareResult] as never;
      if (opts.pipelineName === "build.check") return [mockState.checkResult] as never;
      if (opts.pipelineName === "build.post") {
        // First call returns the override or fail result; second call (revalidation) returns revalidateResult
        const postCalls = mockState.pipelineCalls.filter((p) => p === "build.post");
        if (postCalls.length === 1) {
          return [mockState.postResultOverride ?? mockState.postResultFail] as never;
        }
        return [mockState.revalidateResult ?? mockState.postResultRevalidateOk] as never;
      }
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
  tmpWorkspace = mkdtempSync(join(tmpdir(), "tmp-validate-snap-"));
  mockState.commandCalls = [];
  mockState.pipelineCalls = [];
  mockState.revalidateResult = null;
  mockState.dirty = false;
  mockState.postResultOverride = null;
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

test("SNAP-01 with clean workpiece: auto-regenerates, commits, re-validates, passes", async () => {
  setupWorkspace();
  mockState.dirty = false;
  mockState.revalidateResult = mockState.postResultRevalidateOk;

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput(), makeContext());

  expect(mockState.commandCalls).toContain("behavior.snapshot.generate");
  expect(mockState.commandCalls).toContain("mission.git.commit");
  const postCalls = mockState.pipelineCalls.filter((p) => p === "build.post");
  expect(postCalls.length).toBe(2);
  expect(result.summary).toContain("passed");
});

test("SNAP-01 with dirty workpiece: does NOT auto-regenerate, reports failure", async () => {
  setupWorkspace();
  mockState.dirty = true;
  mockState.revalidateResult = mockState.postResultRevalidateOk;

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput(), makeContext());

  expect(mockState.commandCalls).not.toContain("behavior.snapshot.generate");
  expect(mockState.commandCalls).not.toContain("mission.git.commit");
  const postCalls = mockState.pipelineCalls.filter((p) => p === "build.post");
  expect(postCalls.length).toBe(1);
  expect(result.exitCode).toBe(1);
});

test("Non-SNAP-01 failure (STALE-01): does NOT auto-regenerate", async () => {
  setupWorkspace();
  mockState.dirty = false;
  mockState.postResultOverride = mockState.postResultNonSnap01;

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput(), makeContext());

  expect(mockState.commandCalls).not.toContain("behavior.snapshot.generate");
  expect(result.exitCode).toBe(1);
});

test("SNAP-01 auto-regeneration succeeds but re-validation still fails: reports persistent failure", async () => {
  setupWorkspace();
  mockState.dirty = false;
  mockState.revalidateResult = mockState.postResultRevalidateFail;

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionValidate(makeInput(), makeContext());

  expect(mockState.commandCalls).toContain("behavior.snapshot.generate");
  expect(mockState.commandCalls).toContain("mission.git.commit");
  const postCalls = mockState.pipelineCalls.filter((p) => p === "build.post");
  expect(postCalls.length).toBe(2);
  expect(result.exitCode).toBe(1);
});
