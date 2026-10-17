/*
<MODULE_CONTRACT>
<purpose>RFC-1264 AC-1/AC-6: mission.close runs the mission-digest step pre-bordbuch,
links the artifact path into the close bordbuch event, and surfaces it in the
close report; --skip-digest is the audited escape hatch.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1264: initial test file.</item>
  <item>RFC-1264</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";

import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { createDefaultIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

import { runMissionClose } from "./mission-close.ts";

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockExecuteKernelCommand = vi.hoisted(() => vi.fn());
const mockRunMissionValidate = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    data: { contractFull: { passed: true, validators: [] } },
    summary: "Validation passed",
  })),
);
const mockAppendBordbuch = vi.hoisted(() =>
  vi.fn(async () => ({
    entry: { id: "event-000001", kind: "mission-close" },
    commitResult: { commitSha: "abc123", pushed: true, error: null },
  })),
);

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return { ...actual, executeKernelCommand: mockExecuteKernelCommand };
});

vi.mock("../mission/mission-materialization-commands.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../mission/mission-materialization-commands.ts")>();
  return { ...actual, runMissionValidate: mockRunMissionValidate };
});

vi.mock("../bordbuch/bordbuch-io.ts", () => ({
  validateBordbuch: vi.fn(async () => ({ entries: 0, violations: [] })),
  readBordbuch: vi.fn(async () => []),
  commitAndPushBordbuch: vi.fn(async () => ({ commitSha: "abc123", pushed: true, error: null })),
}));

vi.mock("../bordbuch/bordbuch-commit-helper.ts", () => ({
  appendAndCommitBordbuch: mockAppendBordbuch,
}));

// ─── fixture ─────────────────────────────────────────────────────────────────

const SITE = "test-sys";
const MISSION = `${SITE}-m000001`;
const DIGEST_PATH = `missions/${MISSION}/evidence/mission-digest/digest.md`;

let testRoot: string;
let workspaceRoot: string;
let cacheClone: string;
let workpiece: string;

function write(base: string, rel: string, content: string): void {
  const abs = join(base, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function gitInit(dir: string): void {
  execSync("git init -b main", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function gitCommitAll(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

function seedMission(): void {
  const missionDir = join(workspaceRoot, "missions", MISSION);
  mkdirSync(join(missionDir, "evidence"), { recursive: true });
  workpiece = join(missionDir, "workpiece");
  mkdirSync(workpiece, { recursive: true });
  write(workpiece, "src/content/system.md", "---\napp: x\n---\n");
  gitInit(workpiece);
  gitCommitAll(workpiece, "materialize");
  write(workpiece, "src/content/pages/de/test.md", "---\ntitle: Neu\nlang: de\n---\n");
  gitCommitAll(workpiece, "mission change");

  const manifest = {
    schemaVersion: "1.0.0",
    missionId: MISSION,
    systemId: SITE,
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
}

function seedCacheClone(): void {
  write(
    cacheClone,
    "system-config.yaml",
    `schemaVersion: system-config/v1\nid: ${SITE}\ncosmicStar: Vega\nmirrors:\n  - path: "../systems-cache/${SITE}"\n    storageType: non-bare\npinnedPlatform: "1.0.0"\nstatus: active\nregisteredAt: "2026-01-01T00:00:00Z"\nnotes: ""\n`,
  );
  write(
    cacheClone,
    "system-state.yaml",
    `schemaVersion: "1.0.0"\nsystemId: ${SITE}\ncurrentMission: ${MISSION}\n`,
  );
  write(cacheClone, "system.pin.json", JSON.stringify({ platform: { version: "1.0.0" } }));
  mkdirSync(join(cacheClone, "bordbuch"), { recursive: true });
  write(cacheClone, "bordbuch/events.ndjson", "");
}

function makeInput(flags: Record<string, string | boolean>): KernelCommandInput {
  return { argv: [], flags } as unknown as KernelCommandInput;
}

function makeContext(): KernelRuntimeContext {
  return {
    io: createDefaultIO().io,
    workspaceRoot,
    logger: { info: () => {}, warn: () => {}, error: () => {}, success: () => {}, debug: () => {} },
    dryRun: false,
    siteExplicit: false,
    outputFormat: "json",
  } as unknown as KernelRuntimeContext;
}

function closeFlags(extra: Record<string, boolean> = {}): Record<string, string | boolean> {
  return {
    mission: MISSION,
    actor: "test-agent",
    "allow-no-op": true,
    "skip-reconcile-check": true,
    "skip-auto-sync": true,
    "skip-evidence-sync": true,
    ...extra,
  };
}

beforeEach(() => {
  mockExecuteKernelCommand.mockReset();
  mockRunMissionValidate.mockClear();
  mockAppendBordbuch.mockClear();
  testRoot = mkdtempSync(join(tmpdir(), "tmp-close-digest-"));
  workspaceRoot = join(testRoot, "workspace");
  cacheClone = join(testRoot, "systems-cache", SITE);
  mkdirSync(workspaceRoot, { recursive: true });
  mkdirSync(cacheClone, { recursive: true });
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

// ─── AC-1/AC-6: close emits + links the digest ───────────────────────────────

test("AC-6: close invokes mission.digest.generate and surfaces the path", async () => {
  seedMission();
  seedCacheClone();
  gitInit(testRoot);
  gitCommitAll(testRoot, "fixture baseline");

  const calls: string[] = [];
  mockExecuteKernelCommand.mockImplementation(async ({ commandName }: { commandName: string }) => {
    calls.push(commandName);
    if (commandName === "mission.digest.generate") {
      return { exitCode: 0, data: { artifacts: [DIGEST_PATH] } };
    }
    return { exitCode: 0, data: {} };
  });

  const res = await runMissionClose(makeInput(closeFlags()), makeContext());
  expect(res.exitCode).toBe(0);
  expect(res.data?.state).toBe("closed");

  // AC-6: close report surfaces the digest path.
  expect(res.data?.closeReport.digest).toEqual({ path: DIGEST_PATH, skipped: false });
  const report = JSON.parse(
    readFileSync(join(workspaceRoot, "missions", MISSION, "evidence", "close-report.json"), "utf8"),
  ) as { digest: { path: string | null; skipped: boolean } };
  expect(report.digest.path).toBe(DIGEST_PATH);

  // AC-1: the close bordbuch event links the digest artifact.
  const closeCall = (mockAppendBordbuch.mock.calls as unknown as unknown[][]).find(
    (c) => c[2] === "mission-close" && (c[3] as string).includes("closed"),
  );
  expect(closeCall).toBeDefined();
  const metadata = (closeCall![5] as { metadata?: Record<string, unknown> }).metadata;
  expect(metadata?.digestPath).toBe(DIGEST_PATH);
  expect(metadata?.digestSkipped).toBeUndefined();
});

test("close warns but proceeds when digest generation fails (advisory)", async () => {
  seedMission();
  seedCacheClone();
  gitInit(testRoot);
  gitCommitAll(testRoot, "fixture baseline");

  mockExecuteKernelCommand.mockImplementation(async ({ commandName }: { commandName: string }) => {
    if (commandName === "mission.digest.generate") {
      return { exitCode: 1, data: {}, summary: "workpiece missing" };
    }
    return { exitCode: 0, data: {} };
  });

  const res = await runMissionClose(makeInput(closeFlags()), makeContext());
  expect(res.exitCode).toBe(0);
  expect(res.data?.closeReport.digest).toEqual({ path: null, skipped: false });
});

test("--skip-digest records the audited escape hatch and skips generation", async () => {
  seedMission();
  seedCacheClone();
  gitInit(testRoot);
  gitCommitAll(testRoot, "fixture baseline");

  const calls: string[] = [];
  mockExecuteKernelCommand.mockImplementation(async ({ commandName }: { commandName: string }) => {
    calls.push(commandName);
    return { exitCode: 0, data: {} };
  });

  const res = await runMissionClose(makeInput(closeFlags({ "skip-digest": true })), makeContext());
  expect(res.exitCode).toBe(0);
  expect(calls).not.toContain("mission.digest.generate");
  expect(res.data?.closeReport.digest).toEqual({ path: null, skipped: true });

  const closeCall = (mockAppendBordbuch.mock.calls as unknown as unknown[][]).find(
    (c) => c[2] === "mission-close" && (c[3] as string).includes("closed"),
  );
  const metadata = (closeCall![5] as { metadata?: Record<string, unknown> }).metadata;
  expect(metadata?.digestSkipped).toBe(true);
  expect(metadata?.digestPath).toBeUndefined();
});
