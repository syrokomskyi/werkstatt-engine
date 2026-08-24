/*
<MODULE_CONTRACT>
<purpose>RFC-0615: unit tests for dist/ cleanup before astro build in mission.validate.</purpose>
<keywords>RFC-0615, mission.validate, dist cleanup, stale artifacts, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0615: initial tests for dist/ cleanup before astro build.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { tmpdir } from "node:os";

const mockPipeline = vi.hoisted(() => ({
  prepareResult: { ok: true, steps: [{ ok: true, commandName: "config.regenerate", exitCode: 0 }] },
  checkResult: { ok: true, steps: [{ ok: true, commandName: "content.validate", exitCode: 0 }] },
  postResult: { ok: true, steps: [{ ok: true, commandName: "text.normalize.apply", exitCode: 0 }] },
  execSyncCalled: false,
}));

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...actual,
    executeKernelPipeline: vi.fn(async (opts: { pipelineName: string }) => {
      if (opts.pipelineName === "build.prepare") return [mockPipeline.prepareResult] as never;
      if (opts.pipelineName === "build.check") return [mockPipeline.checkResult] as never;
      if (opts.pipelineName === "build.post") return [mockPipeline.postResult] as never;
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
        mockPipeline.execSyncCalled = true;
        return "10 page(s)";
      }
      return actual.execSync(cmd, opts as never);
    }),
  };
});

function gitInit(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

let tmpWorkspace: string;

beforeEach(() => {
  tmpWorkspace = mkdtempSync(join(tmpdir(), "tmp-validate-dist-"));
  mockPipeline.execSyncCalled = false;
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

test("mission.validate removes stale dist/ before astro build", async () => {
  const workpieceDir = setupWorkspace();

  // Create stale dist/ directory with old artifacts
  mkdirSync(join(workpieceDir, "dist", "client", "old-route"), { recursive: true });
  writeFileSync(
    join(workpieceDir, "dist", "client", "old-route", "index.html"),
    "<html>stale</html>",
  );
  expect(existsSync(join(workpieceDir, "dist"))).toBe(true);

  const { runMissionValidate } = await import("../mission/mission-materialization-commands.ts");

  const input: KernelCommandInput = {
    flags: { mission: "test-system-m000001" },
    argv: [],
  };
  const context: KernelRuntimeContext = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;

  await runMissionValidate(input, context);

  // dist/ should have been removed before build (the mock build doesn't recreate it)
  expect(existsSync(join(workpieceDir, "dist"))).toBe(false);
  expect(mockPipeline.execSyncCalled).toBe(true);
});
