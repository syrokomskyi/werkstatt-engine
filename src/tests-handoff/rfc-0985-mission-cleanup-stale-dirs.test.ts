/*
<MODULE_CONTRACT>
  <purpose>RFC-0985: unit tests for mission.cleanup --stale-dirs mode (Measure 6).</purpose>
  <keywords>RFC-0985, mission.cleanup, stale-dirs, archive, aborted, stub</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0985: initial tests for --stale-dirs mode archiving aborted missions and removing stubs.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-rfc0985-cleanup-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeInput(flags: Record<string, unknown>): KernelCommandInput {
  return { flags, argv: [] } as unknown as KernelCommandInput;
}

function makeContext(): KernelRuntimeContext {
  return {
    workspaceRoot: tmpDir,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
      debug: () => {},
    },
  } as unknown as KernelRuntimeContext;
}

function writeMissionManifest(workspaceRoot: string, missionId: string, state: string): void {
  const missionDir = join(workspaceRoot, "missions", missionId);
  mkdirSync(missionDir, { recursive: true });
  const manifestYaml = `schemaVersion: "1.0.0"
missionId: "${missionId}"
systemId: "test-system"
state: "${state}"
brief: "Test"
openedAt: "2026-01-01T00:00:00.000Z"
openedBy: "test-agent"
closedAt: null
closedBy: null
pinAtOpen: "1.0.0"
materializedAt: "2026-01-01T01:00:00.000Z"
migratedAt: null
reconciledAt: "2026-01-01T02:00:00.000Z"
releaseId: null
rfcId: null
operationId: "op-001"
`;
  writeFileSync(join(missionDir, "mission.yaml"), manifestYaml);
}

test("Measure 6: --stale-dirs archives aborted missions to archive/aborted/", async () => {
  const missionId = "test-system-m000001";
  writeMissionManifest(tmpDir, missionId, "aborted");

  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  const result = await runMissionCleanup(makeInput({ "stale-dirs": true }), makeContext());

  const data = result.data as Record<string, unknown> | undefined;
  expect(data?.archived).toContain(missionId);
  expect(
    existsSync(join(tmpDir, "missions", "archive", "aborted", missionId)),
    "aborted mission should be moved to archive/aborted/",
  ).toBe(true);
  expect(
    existsSync(join(tmpDir, "missions", missionId)),
    "original mission dir should be gone",
  ).toBe(false);
});

test("Measure 6: --stale-dirs removes stub directories (no mission.yaml)", async () => {
  const stubId = "test-system-m000099";
  mkdirSync(join(tmpDir, "missions", stubId), { recursive: true });
  // No mission.yaml — this is a stub from a failed mission.open

  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  const result = await runMissionCleanup(makeInput({ "stale-dirs": true }), makeContext());

  const data = result.data as Record<string, unknown> | undefined;
  expect(data?.removedPaths).toBeDefined();
  expect(existsSync(join(tmpDir, "missions", stubId)), "stub directory should be removed").toBe(
    false,
  );
});

test("Measure 6: --stale-dirs skips open missions", async () => {
  const openId = "test-system-m000050";
  writeMissionManifest(tmpDir, openId, "open");

  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  const result = await runMissionCleanup(makeInput({ "stale-dirs": true }), makeContext());

  const data = result.data as Record<string, unknown> | undefined;
  expect(data?.archived, "open mission should not be archived").not.toContain(openId);
  expect(existsSync(join(tmpDir, "missions", openId)), "open mission dir should still exist").toBe(
    true,
  );
});

test("Measure 6: --stale-dirs skips closed missions", async () => {
  const closedId = "test-system-m000030";
  writeMissionManifest(tmpDir, closedId, "closed");

  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  const result = await runMissionCleanup(makeInput({ "stale-dirs": true }), makeContext());

  const data = result.data as Record<string, unknown> | undefined;
  expect(data?.archived, "closed mission should not be archived").not.toContain(closedId);
  expect(
    existsSync(join(tmpDir, "missions", closedId)),
    "closed mission dir should still exist",
  ).toBe(true);
});

test("Measure 6: --stale-dirs does not process archive directory itself", async () => {
  const abortedId = "test-system-m000001";
  writeMissionManifest(tmpDir, abortedId, "aborted");
  // Pre-existing archive directory with an already-archived mission
  const archivedId = "test-system-m000002";
  mkdirSync(join(tmpDir, "missions", "archive", "aborted", archivedId), { recursive: true });

  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  await runMissionCleanup(makeInput({ "stale-dirs": true }), makeContext());

  expect(
    existsSync(join(tmpDir, "missions", "archive", "aborted", archivedId)),
    "pre-existing archived mission should still exist",
  ).toBe(true);
  expect(
    existsSync(join(tmpDir, "missions", "archive", "aborted", abortedId)),
    "newly archived mission should also exist",
  ).toBe(true);
});

test("Measure 6: --stale-dirs returns empty result when no missions directory exists", async () => {
  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  const result = await runMissionCleanup(makeInput({ "stale-dirs": true }), makeContext());

  const data = result.data as Record<string, unknown> | undefined;
  expect(data?.archived).toEqual([]);
  expect(data?.removedPaths).toEqual([]);
});

test("Measure 6: --stale-dirs handles both aborted and stub in one run", async () => {
  const abortedId = "test-system-m000001";
  const stubId = "test-system-m000099";
  writeMissionManifest(tmpDir, abortedId, "aborted");
  mkdirSync(join(tmpDir, "missions", stubId), { recursive: true });

  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  const result = await runMissionCleanup(makeInput({ "stale-dirs": true }), makeContext());

  const data = result.data as Record<string, unknown> | undefined;
  expect(data?.archived).toContain(abortedId);
  expect(
    existsSync(join(tmpDir, "missions", "archive", "aborted", abortedId)),
    "aborted mission should be archived",
  ).toBe(true);
  expect(existsSync(join(tmpDir, "missions", stubId)), "stub directory should be removed").toBe(
    false,
  );
});
