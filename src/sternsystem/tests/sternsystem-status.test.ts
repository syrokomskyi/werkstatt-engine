/*
<MODULE_CONTRACT>
  <purpose>Tests for sternsystem.status currentMission field (RFC-1063).</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1063: behavioral tests for currentMission null and non-null cases.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runSternsystemStatus } from "../sternsystem-status.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

let testRoot: string;
let workspaceRoot: string;
let cacheRoot: string;
const systemId = "test-system";

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sternsystem-status-test-"));
  workspaceRoot = path.join(testRoot, "workspace");
  cacheRoot = path.join(testRoot, "systems-cache");
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(path.join(cacheRoot, systemId), { recursive: true });
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

function makeInput(flags: Record<string, boolean | string | string[]> = {}): KernelCommandInput {
  return { flags, argv: [] };
}

function makeContext(): KernelRuntimeContext {
  return { workspaceRoot, logger: console } as unknown as KernelRuntimeContext;
}

async function writeSystemState(state: Record<string, unknown>): Promise<void> {
  const filePath = path.join(cacheRoot, systemId, "system-state.yaml");
  const yaml =
    [
      `schemaVersion: "1.0.0"`,
      `systemId: "${systemId}"`,
      `currentMission: ${state.currentMission === null ? "null" : `"${state.currentMission}"`}`,
      `lastRelease: null`,
      `lastPropagated: {}`,
      `accessPin: null`,
      `passportRequired: false`,
      `ownershipRequired: false`,
    ].join("\n") + "\n";
  await fs.writeFile(filePath, yaml, "utf8");
}

async function writeBordbuchEmpty(): Promise<void> {
  const dir = path.join(cacheRoot, systemId, "bordbuch");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "events.ndjson"), "", "utf8");
}

async function writeMissionManifest(
  missionId: string,
  brief: string,
  state: string,
): Promise<void> {
  const missionDir = path.join(workspaceRoot, "missions", missionId);
  await fs.mkdir(missionDir, { recursive: true });
  const manifest =
    [
      `schemaVersion: "1.0.0"`,
      `missionId: "${missionId}"`,
      `systemId: "${systemId}"`,
      `state: "${state}"`,
      `brief: "${brief}"`,
      `openedAt: "2026-09-10T10:00:00.000Z"`,
      `openedBy: "agent"`,
      `closedAt: null`,
      `closedBy: null`,
      `pinAtOpen: "pin-123"`,
      `materializedAt: null`,
      `reconciledAt: null`,
      `migratedAt: null`,
      `releaseId: null`,
      `operationId: "op-001"`,
    ].join("\n") + "\n";
  await fs.writeFile(path.join(missionDir, "mission.yaml"), manifest, "utf8");
}

test("AC-2: currentMission is null when system-state.yaml has currentMission: null", async () => {
  await writeSystemState({ currentMission: null });
  await writeBordbuchEmpty();

  const result = await runSternsystemStatus(makeInput({ id: systemId }), makeContext());

  expect(result.data).toBeDefined();
  const data = result.data as { currentMission: unknown };
  expect(data.currentMission).toBeNull();
});

test("AC-1: currentMission includes missionId, brief, state, openedAt, openedBy when mission is open", async () => {
  const missionId = "test-system-m000001";
  await writeSystemState({ currentMission: missionId });
  await writeBordbuchEmpty();
  await writeMissionManifest(missionId, "Test mission brief", "open");

  const result = await runSternsystemStatus(makeInput({ id: systemId }), makeContext());

  expect(result.data).toBeDefined();
  const data = result.data as {
    currentMission: {
      missionId: string;
      brief: string;
      state: string;
      openedAt: string;
      openedBy: string;
    } | null;
  };
  expect(data.currentMission).not.toBeNull();
  expect(data.currentMission!.missionId).toBe(missionId);
  expect(data.currentMission!.brief).toBe("Test mission brief");
  expect(data.currentMission!.state).toBe("open");
  expect(data.currentMission!.openedAt).toBe("2026-09-10T10:00:00.000Z");
  expect(data.currentMission!.openedBy).toBe("agent");
});

test("AC-3: summary line includes 'no active mission' when currentMission is null", async () => {
  await writeSystemState({ currentMission: null });
  await writeBordbuchEmpty();

  const result = await runSternsystemStatus(makeInput({ id: systemId }), makeContext());

  expect(result.summary).toContain("no active mission");
});

test("AC-3: summary line includes mission ID and state when currentMission is non-null", async () => {
  const missionId = "test-system-m000002";
  await writeSystemState({ currentMission: missionId });
  await writeBordbuchEmpty();
  await writeMissionManifest(missionId, "Another mission", "open");

  const result = await runSternsystemStatus(makeInput({ id: systemId }), makeContext());

  expect(result.summary).toContain(`mission=${missionId}`);
  expect(result.summary).toContain("(open)");
});

test("currentMission has 'unknown' fallback fields when manifest is missing", async () => {
  const missionId = "test-system-m000003";
  await writeSystemState({ currentMission: missionId });
  await writeBordbuchEmpty();
  // No mission manifest written

  const result = await runSternsystemStatus(makeInput({ id: systemId }), makeContext());

  expect(result.data).toBeDefined();
  const data = result.data as {
    currentMission: {
      missionId: string;
      brief: string;
      state: string;
      openedAt: string;
      openedBy: string;
    } | null;
  };
  expect(data.currentMission).not.toBeNull();
  expect(data.currentMission!.missionId).toBe(missionId);
  expect(data.currentMission!.brief).toBe("unknown");
  expect(data.currentMission!.state).toBe("unknown");
});

test("AC-4: --all includes currentMission for each system entry", async () => {
  await writeSystemState({ currentMission: null });
  await writeBordbuchEmpty();

  // Create a minimal system-config.yaml so discoverSystems finds it
  const configPath = path.join(cacheRoot, systemId, "system-config.yaml");
  const config =
    [
      `schemaVersion: "1.0.0"`,
      `id: "${systemId}"`,
      `cosmicStar: Vega`,
      `mirrors:`,
      `  - path: "../systems-cache/${systemId}"`,
      `    storageType: non-bare`,
      `pinnedPlatform: "1.0.0"`,
      `status: active`,
      `registeredAt: "2026-01-01T00:00:00.000Z"`,
    ].join("\n") + "\n";
  await fs.writeFile(configPath, config, "utf8");

  const result = await runSternsystemStatus(makeInput({ all: true }), makeContext());

  expect(Array.isArray(result.data)).toBe(true);
  const entries = result.data as Array<{ currentMission: unknown }>;
  expect(entries.length).toBeGreaterThanOrEqual(1);
  for (const entry of entries) {
    expect(entry).toHaveProperty("currentMission");
  }
});
