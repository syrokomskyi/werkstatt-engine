/*
<MODULE_CONTRACT>
<purpose>RFC-0635: unit tests for build.check phase in mission.build.</purpose>
<keywords>RFC-0635, mission.build, build.check, pipeline, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0635: initial tests for build.check phase addition to mission.build.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { tmpdir } from "node:os";

const mock = vi.hoisted(() => ({
  pipelineCalls: [] as string[],
  prepareOk: true,
  checkOk: true,
  postOk: true,
  execSyncCalled: false,
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelPipeline: vi.fn(async (opts: { pipelineName: string }) => {
      mock.pipelineCalls.push(opts.pipelineName);
      if (opts.pipelineName === "build.prepare")
        return [
          {
            ok: mock.prepareOk,
            steps: [{ ok: true, commandName: "config.regenerate", exitCode: 0 }],
          },
        ] as never;
      if (opts.pipelineName === "build.check")
        return [
          {
            ok: mock.checkOk,
            steps: [
              { ok: mock.checkOk, commandName: "content.validate", exitCode: mock.checkOk ? 0 : 1 },
            ],
          },
        ] as never;
      if (opts.pipelineName === "build.post")
        return [
          {
            ok: mock.postOk,
            steps: [{ ok: true, commandName: "text.normalize.apply", exitCode: 0 }],
          },
        ] as never;
      return [{ ok: true, steps: [] }] as never;
    }),
    executeKernelCommand: vi.fn(async () => [{ ok: true, exitCode: 0, summary: "" }] as never),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn((cmd: string, opts?: Record<string, unknown>) => {
      if (cmd === "pnpm exec astro build") {
        mock.execSyncCalled = true;
        return "10 page(s)";
      }
      return actual.execSync(cmd, opts as never);
    }),
  };
});

vi.mock("../handoff/build-pipeline-helpers.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../handoff/build-pipeline-helpers.ts")>();
  return {
    ...actual,
    computeBuildInputHash: vi.fn(async () => ({
      buildInputHash: "sha256:test-hash",
      workpieceTreeHash: "sha256:tree",
      platformVersion: "1.0.0",
      platformSemanticHash: "sha256:platform",
    })),
    runPipelinePhase: vi.fn(async (_workspaceRoot: string, pipelineName: string) => {
      mock.pipelineCalls.push(pipelineName);
      if (pipelineName === "build.prepare" && !mock.prepareOk) {
        throw new Error("build.prepare failed");
      }
      if (pipelineName === "build.check" && !mock.checkOk) {
        throw new Error("build.check failed: content.validate exit code 1");
      }
      if (pipelineName === "build.post" && !mock.postOk) {
        throw new Error("build.post failed");
      }
      return { ok: true, steps: [], timing: { durationMs: 0 } } as never;
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
  tmpWorkspace = mkdtempSync(join(tmpdir(), "tmp-build-check-"));
  mock.pipelineCalls = [];
  mock.prepareOk = true;
  mock.checkOk = true;
  mock.postOk = true;
  mock.execSyncCalled = false;
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

function makeInput(): KernelCommandInput {
  return {
    flags: { mission: "test-system-m000001" },
    argv: [],
  };
}

function makeContext(): KernelRuntimeContext {
  return {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;
}

test("mission.build calls runPipelinePhase with build.check between build.prepare and build.post", async () => {
  setupWorkspace();

  const { runMissionBuild } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionBuild(makeInput(), makeContext());

  expect(result.summary).toContain("built");
  expect(mock.pipelineCalls).toContain("build.prepare");
  expect(mock.pipelineCalls).toContain("build.check");
  expect(mock.pipelineCalls).toContain("build.post");
  const checkIndex = mock.pipelineCalls.indexOf("build.check");
  const prepareIndex = mock.pipelineCalls.indexOf("build.prepare");
  const postIndex = mock.pipelineCalls.indexOf("build.post");
  expect(prepareIndex).toBeLessThan(checkIndex);
  expect(checkIndex).toBeLessThan(postIndex);
  expect(mock.execSyncCalled).toBe(true);
});

test("build.check failure → mission.build fails, build-input-hash.json not written", async () => {
  setupWorkspace();
  mock.checkOk = false;

  const { runMissionBuild } = await import("../mission/mission-materialization-commands.ts");
  const result = await runMissionBuild(makeInput(), makeContext());

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("FAILED");
  expect(mock.execSyncCalled).toBe(false);

  const missionDir = join(tmpWorkspace, "missions", "test-system-m000001");
  const hashPath = join(missionDir, "distribution", "build-input-hash.json");
  expect(existsSync(hashPath)).toBe(false);
});
