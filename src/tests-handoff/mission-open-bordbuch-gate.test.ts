/*
<MODULE_CONTRACT>
<purpose>RFC-0593: unit test verifying bordbuch.validate pre-flight gate in mission.open.</purpose>
<keywords>RFC-0593, bordbuch, validation, gate, mission.open</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0593: initial test for bordbuch.validate pre-flight gate in mission.open.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";
import { runMissionOpen } from "../mission/mission-open.ts";
import { computeEntryHash } from "../bordbuch/bordbuch-io.ts";
import type { BordbuchEntry } from "@warpgogol/werkstatt-engine/schemas";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { tmpdir } from "node:os";

// RFC-0951: mock runMissionMaterializeInternal so mission.open doesn't require a real system
vi.mock("../mission/mission-materialize.ts", () => ({
  runMissionMaterializeInternal: vi.fn(async () => ({
    data: { materializedAt: "2026-01-01T00:00:00.000Z" },
    summary: "materialized",
    nextSteps: [],
  })),
  runMissionMaterialize: vi.fn(),
}));

function gitInit(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
}

function setupBareOrigin(workspaceDir: string): string {
  const bareDirName = `${basename(workspaceDir)}.git`;
  const bareDir = join(workspaceDir, bareDirName);
  writeFileSync(join(workspaceDir, ".gitignore"), `${bareDirName}/\n`);
  execSync("git add .gitignore", { cwd: workspaceDir, stdio: "pipe" });
  execSync('git commit -m "add .gitignore"', { cwd: workspaceDir, stdio: "pipe" });
  execSync(`git init --bare ${JSON.stringify(bareDir)}`, { stdio: "pipe" });
  execSync(`git remote add origin ${JSON.stringify(bareDir)}`, {
    cwd: workspaceDir,
    stdio: "pipe",
  });
  execSync("git push -u origin HEAD", { cwd: workspaceDir, stdio: "pipe" });
  return bareDir;
}

function gitCommit(dir: string, msg: string): void {
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: dir, stdio: "pipe" });
}

function makeBordbuchEntry(
  id: string,
  kind: BordbuchEntry["kind"],
  systemId: string,
  missionId: string | null,
  summary: string,
  previousHash: string | null,
  actor: string,
): BordbuchEntry {
  const base: Omit<BordbuchEntry, "hash"> = {
    schemaVersion: "1.0.0",
    id,
    systemId,
    occurredAt: new Date().toISOString(),
    kind,
    status: "done",
    missionId,
    releaseId: null,
    actor,
    summary,
    previousHash,
  };
  return { ...base, hash: computeEntryHash(base) };
}

function writeBordbuch(dir: string, entries: BordbuchEntry[]): void {
  const ndjson = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(join(dir, "bordbuch", "events.ndjson"), ndjson);
}

let testRoot: string;
let tmpWorkspace: string;
let cacheDir: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "tmp-bordbuch-gate-"));
  tmpWorkspace = join(testRoot, "workspace");
  cacheDir = join(testRoot, "systems-cache", "test-system");
  mkdirSync(tmpWorkspace, { recursive: true });
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function setupWorkspace(): void {
  gitInit(testRoot);
  writeFileSync(join(tmpWorkspace, "README.md"), "# test\n");
  gitCommit(testRoot, "initial");

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

  // ADR-0030: commitAndPushBordbuch now verifies push succeeded — set up bare origin
  setupBareOrigin(testRoot);
}

test("mission.open refuses when bordbuch has orphan-mission-close violation", async () => {
  setupWorkspace();

  // Write a bordbuch with an orphan mission-close (no preceding mission-open)
  const closeEntry = makeBordbuchEntry(
    "event-000001",
    "mission-close",
    "test-system",
    "test-system-m000001",
    "Mission closed",
    null,
    "test-agent",
  );
  writeBordbuch(cacheDir, [closeEntry]);

  const input = {
    flags: { system: "test-system", brief: "Test mission", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = { workspaceRoot: tmpWorkspace } as unknown as KernelRuntimeContext;

  await expect(runMissionOpen(input, context)).rejects.toThrow(
    /bordbuch for system 'test-system' has 1.*violation/,
  );

  // Verify no side effects — no mission directory created
  expect(existsSync(join(tmpWorkspace, "missions"))).toBe(false);
});

test("mission.open proceeds when bordbuch is clean (0 violations)", async () => {
  setupWorkspace();

  // Write a clean bordbuch with a proper mission-open + mission-close pair
  const openEntry = makeBordbuchEntry(
    "event-000001",
    "mission-open",
    "test-system",
    "test-system-m000001",
    "Mission opened",
    null,
    "test-agent",
  );
  const closeEntry = makeBordbuchEntry(
    "event-000002",
    "mission-close",
    "test-system",
    "test-system-m000001",
    "Mission closed",
    openEntry.hash,
    "test-agent",
  );
  writeBordbuch(cacheDir, [openEntry, closeEntry]);

  const input = {
    flags: { system: "test-system", brief: "Test mission 2", actor: "test-agent" },
  } as unknown as KernelCommandInput;
  const context = { workspaceRoot: tmpWorkspace } as unknown as KernelRuntimeContext;

  const result = await runMissionOpen(input, context);
  expect(result.data?.state).toBe("open");
  expect(result.data?.missionId).toBe("test-system-m000002");
});
