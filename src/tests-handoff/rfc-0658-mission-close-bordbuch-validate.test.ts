/*
<MODULE_CONTRACT>
  <purpose>RFC-0658: unit test verifying mission.close validates bordbuch before appending close event.</purpose>
  <keywords>RFC-0658, mission.close, bordbuch, validate, defense-in-depth</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0658: initial test for bordbuch validation in mission.close.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { expectData } from "./helpers/kernel-result-helpers.ts";
import { tmpdir } from "node:os";

const mockState = vi.hoisted(() => ({
  validateResult: {
    data: null as Record<string, unknown> | null,
    exitCode: 0,
    summary: "",
  },
}));

vi.mock("../bordbuch/bordbuch-commit-helper.ts", () => ({
  appendAndCommitBordbuch: vi.fn(async () => ({
    entry: { id: "event-000001", kind: "mission-close" },
    commitResult: { commitSha: "abc123", pushed: true, error: null },
  })),
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

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
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
  testRoot = mkdtempSync(join(tmpdir(), "tmp-close-bordbuch-validate-"));
  tmpWorkspace = join(testRoot, "workspace");
  mkdirSync(tmpWorkspace, { recursive: true });
  mockState.validateResult = {
    data: {
      missionId: "test-system-m000001",
      contractFull: { passed: true, validators: [] },
      build: { succeeded: true, routeCount: 5, sitemapHash: "abc" },
    },
    exitCode: 0,
    summary: "Validation passed",
  };
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setupWorkspace(): void {
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

  // RFC-0820: Create workpiece git repo with materialize + operator commit
  gitInit(join(missionDir, "workpiece"));
  mkdirSync(join(missionDir, "workpiece", "src"), { recursive: true });
  writeFileSync(join(missionDir, "workpiece", "src", "test.md"), "# test\n");
  execSync("git add -A", { cwd: join(missionDir, "workpiece"), stdio: "pipe" });
  execSync('git commit -m "materialize from pin 1.0.0"', {
    cwd: join(missionDir, "workpiece"),
    stdio: "pipe",
  });
  writeFileSync(join(missionDir, "workpiece", "src", "test.md"), "# changed\n");
  gitCommit(join(missionDir, "workpiece"), "operator: test changes");

  const workpieceHead = execSync("git rev-parse HEAD", {
    cwd: join(missionDir, "workpiece"),
    stdio: "pipe",
    encoding: "utf-8",
  }).trim();
  writeFileSync(
    join(missionDir, "evidence", "reconciliation-report.json"),
    JSON.stringify({ workpieceHeadAtReconcile: workpieceHead }) + "\n",
  );

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

  gitCommit(testRoot, "add mission");
}

function computeHash(entry: Record<string, unknown>): string {
  const stable = JSON.stringify(entry, Object.keys(entry).sort());
  return `sha256:${createHash("sha256").update(stable).digest("hex")}`;
}

function makeBordbuchEntry(opts: {
  id: string;
  kind: string;
  systemId: string;
  summary: string;
  actor: string;
  missionId?: string | null;
  previousHash?: string | null;
}): string {
  const { id, kind, systemId, summary, actor, missionId = null, previousHash = null } = opts;
  const entryWithoutHash = {
    schemaVersion: "1.0.0",
    id,
    systemId,
    occurredAt: "2026-07-30T00:00:00.000Z",
    kind,
    status: "done",
    missionId,
    releaseId: null,
    actor,
    summary,
    previousHash,
  };
  const hash = computeHash(entryWithoutHash);
  return JSON.stringify({ ...entryWithoutHash, hash });
}

test("mission.close fails when bordbuch has orphan-mission-close violation", async () => {
  setupWorkspace();

  // Write a bordbuch with an orphan mission-close (no preceding mission-open)
  const bordbuchPath = join(testRoot, "systems-cache", "test-system", "bordbuch", "events.ndjson");
  const orphanLine = makeBordbuchEntry({
    id: "event-000001",
    kind: "mission-close",
    systemId: "test-system",
    summary: "Mission closed without open",
    actor: "test-agent",
    missionId: "test-system-m000099",
  });
  writeFileSync(bordbuchPath, orphanLine + "\n");

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: { mission: "test-system-m000001", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {}, success: () => {} },
  } as unknown as KernelRuntimeContext;

  await expect(runMissionClose(input, context)).rejects.toThrow(
    /bordbuch for system 'test-system' has.*violation.*run bordbuch.repair/,
  );
});

test("mission.close succeeds when bordbuch is valid", async () => {
  setupWorkspace();

  // Write a valid (empty) bordbuch — no unmatched entries
  const bordbuchPath = join(testRoot, "systems-cache", "test-system", "bordbuch", "events.ndjson");
  writeFileSync(bordbuchPath, "");

  const { runMissionClose } = await import("../mission/mission-close.ts");

  const input = {
    flags: {
      mission: "test-system-m000001",
      actor: "test-agent",
      "skip-evidence-sync": true,
      "allow-no-op": true,
    },
  } as unknown as KernelCommandInput;
  const context = {
    workspaceRoot: tmpWorkspace,
    logger: { info: () => {}, warn: () => {}, error: () => {}, success: () => {} },
  } as unknown as KernelRuntimeContext;

  const result = await runMissionClose(input, context);

  expect(expectData(result).bordbuchValidation).toBeDefined();
  expect(expectData(result).bordbuchValidation.checked).toBe(true);
  expect(expectData(result).bordbuchValidation.violations).toHaveLength(0);
});
