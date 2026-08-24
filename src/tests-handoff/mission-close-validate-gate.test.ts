/*
<MODULE_CONTRACT>
<purpose>RFC-0593: unit test verifying mission.validate inline gate in mission.close and state re-check inside locks.</purpose>
<keywords>RFC-0593, mission.close, validation, gate, lock, re-check</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0593: initial test for mission.validate inline gate in mission.close.</item>
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
  onValidate: null as (() => Promise<void> | void) | null,
}));

vi.mock("../mission/mission-materialization-commands.ts", () => ({
  runMissionValidate: vi.fn(async () => {
    if (mockState.onValidate) await mockState.onValidate();
    return mockState.validateResult;
  }),
  runMissionMaterialize: vi.fn(),
  runMissionMigrate: vi.fn(),
  runMissionReconcile: vi.fn(),
}));

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
  tmpWorkspace = mkdtempSync(join(tmpdir(), "tmp-close-validate-gate-"));
  mockState.validateResult = { data: null, exitCode: 0, summary: "" };
  mockState.onValidate = null;
});

afterEach(() => {
  rmSync(tmpWorkspace, { recursive: true, force: true });
});

function setupWorkspace(): void {
  gitInit(tmpWorkspace);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommit(tmpWorkspace, "initial");

  mkdirSync(join(tmpWorkspace, "systems"), { recursive: true });
  const registryContent = `schemaVersion: "1.0.0"
systems:
  - id: test-system
    cosmicStar: Vega
    mirrors:
      - path: "./systems/test-system"
        storageType: non-bare
    pinnedPlatform: "4.5.0"
    currentMission: test-system-m000001
    lastRelease: null
    status: active
    registeredAt: "2026-01-01T00:00:00Z"
    notes: ""
`;
  writeFileSync(join(tmpWorkspace, "systems", "registry.yaml"), registryContent);
  gitCommit(tmpWorkspace, "add registry");

  mkdirSync(join(tmpWorkspace, "systems", "test-system"), { recursive: true });
  writeFileSync(
    join(tmpWorkspace, "systems", "test-system", "system.pin.json"),
    JSON.stringify({ platform: { version: "1.0.0" } }, null, 2) + "\n",
  );

  mkdirSync(join(tmpWorkspace, "systems", "test-system", "bordbuch"), { recursive: true });
  gitCommit(tmpWorkspace, "add system");

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
}

test("mission.close refuses when validation fails", async () => {
  setupWorkspace();

  mockState.validateResult = {
    data: {
      missionId: "test-system-m000001",
      contractFull: {
        passed: false,
        validators: [{ name: "semantic.targets.validate", status: "fail", exitCode: 1 }],
      },
      build: { succeeded: false, routeCount: 0, sitemapHash: "", error: "build failed" },
    },
    exitCode: 1,
    summary: "Validation failed",
  };

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;

  await expect(runMissionClose(input, context)).rejects.toThrow(
    /validation failed for mission 'test-system-m000001'/,
  );

  const manifestRaw = await import("node:fs/promises").then((fs) =>
    fs.readFile(join(tmpWorkspace, "missions", "test-system-m000001", "mission.yaml"), "utf8"),
  );
  const manifest = JSON.parse(manifestRaw);
  expect(manifest.state).toBe("open");
});

test("mission.close refuses when state changed during validation (re-check inside lock)", async () => {
  setupWorkspace();

  mockState.validateResult = {
    data: {
      missionId: "test-system-m000001",
      contractFull: { passed: true, validators: [] },
      build: { succeeded: true, routeCount: 5, sitemapHash: "abc" },
    },
    exitCode: 0,
    summary: "Validation passed",
  };

  mockState.onValidate = async () => {
    const { readMissionManifest, writeMissionManifest } = await import("../mission/mission-io.ts");
    const manifest = await readMissionManifest(tmpWorkspace, "test-system-m000001");
    manifest.state = "aborted";
    await writeMissionManifest(tmpWorkspace, manifest);
  };

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as KernelRuntimeContext;

  await expect(runMissionClose(input, context)).rejects.toThrow(
    /state changed to 'aborted' during validation/,
  );
});
