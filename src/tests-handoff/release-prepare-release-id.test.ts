/*
<MODULE_CONTRACT>
<purpose>RFC-0522: tests for releaseId write to mission manifest in release.prepare.</purpose>
<keywords>RFC-0522, release.prepare, releaseId, mission manifest, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0522: add unit tests for releaseId write to mission.yaml.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { writeMissionManifest, readMissionManifest } from "../mission/mission-io.ts";
import type { MissionManifest } from "@warpgogol/werkstatt-engine/schemas";
import { tmpdir } from "node:os";

function makeManifest(missionId: string, systemId: string): MissionManifest {
  return {
    schemaVersion: "1.0.0",
    missionId,
    systemId,
    state: "open",
    brief: "test mission",
    openedAt: new Date().toISOString(),
    openedBy: "test",
    closedAt: null,
    closedBy: null,
    pinAtOpen: "test-pin",
    materializedAt: new Date().toISOString(),
    reconciledAt: null,
    migratedAt: null,
    releaseId: null,
    rfcId: null,
    operationId: "op-test",
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-release-id-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("writeMissionManifest persists releaseId to mission.yaml", async () => {
  const missionId = "test-sys-m000001";
  const systemId = "test-sys";
  const missionDir = join(tmpDir, "missions", missionId);
  mkdirSync(missionDir, { recursive: true });

  const manifest = makeManifest(missionId, systemId);
  await writeMissionManifest(tmpDir, manifest);

  const manifestPath = join(missionDir, "mission.yaml");
  expect(existsSync(manifestPath)).toBe(true);

  const content = readFileSync(manifestPath, "utf-8");
  expect(content).toContain("releaseId: null");

  // Now write releaseId
  manifest.releaseId = "test-sys-r000001";
  await writeMissionManifest(tmpDir, manifest);

  const updated = await readMissionManifest(tmpDir, missionId);
  expect(updated.releaseId).toBe("test-sys-r000001");
});

test("writeMissionManifest overwrites previous releaseId on re-run", async () => {
  const missionId = "test-sys-m000002";
  const systemId = "test-sys";
  const missionDir = join(tmpDir, "missions", missionId);
  mkdirSync(missionDir, { recursive: true });

  const manifest = makeManifest(missionId, systemId);
  manifest.releaseId = "test-sys-r000001";
  await writeMissionManifest(tmpDir, manifest);

  // Overwrite with new releaseId
  manifest.releaseId = "test-sys-r000002";
  await writeMissionManifest(tmpDir, manifest);

  const updated = await readMissionManifest(tmpDir, missionId);
  expect(updated.releaseId).toBe("test-sys-r000002");
});
