/*
<MODULE_CONTRACT>
  <purpose>RFC-0652: unit tests for mission.cleanup age-based Axiom evidence cleanup.</purpose>
  <keywords>RFC-0652, mission.cleanup, evidence, retention, axiom, cleanup</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0652: initial tests for age-based Axiom evidence cleanup in mission.cleanup.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { tmpdir } from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-cleanup-0652-"));
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

function writeMissionManifest(
  workspaceRoot: string,
  missionId: string,
  state: string,
  closedAt: string | null,
): void {
  const missionDir = join(workspaceRoot, "missions", missionId);
  mkdirSync(missionDir, { recursive: true });
  const manifest: Record<string, unknown> = {
    schemaVersion: "1.0.0",
    missionId,
    systemId: "test-system",
    state,
    brief: "Test",
    openedAt: "2026-01-01T00:00:00.000Z",
    openedBy: "test-agent",
    closedAt,
    closedBy: null,
    pinAtOpen: "1.0.0",
    materializedAt: "2026-01-01T01:00:00.000Z",
    migratedAt: null,
    reconciledAt: "2026-01-01T02:00:00.000Z",
    releaseId: null,
    rfcId: null,
    operationId: "op-001",
  };
  writeFileSync(join(missionDir, "mission.yaml"), JSON.stringify(manifest, null, 2) + "\n");
}

function writeAxiomEvidence(workspaceRoot: string, missionId: string, runTimestamp: string): void {
  const evidenceDir = join(workspaceRoot, "missions", missionId, "evidence", "axiom");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    join(evidenceDir, "evidence-metadata.json"),
    JSON.stringify({ auditId: missionId, runTimestamp }, null, 2) + "\n",
  );
  writeFileSync(
    join(evidenceDir, "study-run.json"),
    JSON.stringify({ findings: [] }, null, 2) + "\n",
  );
}

function writeNonAxiomEvidence(workspaceRoot: string, missionId: string): void {
  const evidenceDir = join(workspaceRoot, "missions", missionId, "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    join(evidenceDir, "close-report.json"),
    JSON.stringify({ git: {} }, null, 2) + "\n",
  );
}

function createWorkpiece(workspaceRoot: string, missionId: string): void {
  const workpieceDir = join(workspaceRoot, "missions", missionId, "workpiece");
  mkdirSync(workpieceDir, { recursive: true });
  writeFileSync(join(workpieceDir, "index.html"), "<html></html>");
}

test("mission.cleanup removes evidence older than 30 days by default in --mission mode", async () => {
  const missionId = "test-system-m000001";
  writeMissionManifest(tmpDir, missionId, "closed", "2026-01-01T00:00:00.000Z");
  createWorkpiece(tmpDir, missionId);
  const oldTimestamp = "2025-01-01T00:00:00.000Z";
  writeAxiomEvidence(tmpDir, missionId, oldTimestamp);

  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  const result = await runMissionCleanup(makeInput({ mission: missionId }), makeContext());

  const data = result.data as Record<string, unknown> | undefined;
  expect(data?.evidenceCleaned).toBe(true);
  expect(data?.evidenceRetentionDays).toBe(30);
  expect(existsSync(join(tmpDir, "missions", missionId, "evidence", "axiom"))).toBe(false);
});

test("mission.cleanup --evidence-retention-days 7 removes evidence older than 7 days", async () => {
  const missionId = "test-system-m000001";
  writeMissionManifest(tmpDir, missionId, "closed", "2026-01-01T00:00:00.000Z");
  createWorkpiece(tmpDir, missionId);
  const oldTimestamp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  writeAxiomEvidence(tmpDir, missionId, oldTimestamp);

  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  const result = await runMissionCleanup(
    makeInput({ mission: missionId, "evidence-retention-days": "7" }),
    makeContext(),
  );

  const data = result.data as Record<string, unknown> | undefined;
  expect(data?.evidenceCleaned).toBe(true);
  expect(data?.evidenceRetentionDays).toBe(7);
  expect(existsSync(join(tmpDir, "missions", missionId, "evidence", "axiom"))).toBe(false);
});

test("mission.cleanup --evidence-retention-days 0 preserves all evidence", async () => {
  const missionId = "test-system-m000001";
  writeMissionManifest(tmpDir, missionId, "closed", "2026-01-01T00:00:00.000Z");
  createWorkpiece(tmpDir, missionId);
  const oldTimestamp = "2025-01-01T00:00:00.000Z";
  writeAxiomEvidence(tmpDir, missionId, oldTimestamp);

  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  const result = await runMissionCleanup(
    makeInput({ mission: missionId, "evidence-retention-days": "0" }),
    makeContext(),
  );

  const data = result.data as Record<string, unknown> | undefined;
  expect(data?.evidenceCleaned).toBe(false);
  expect(data?.evidenceRetentionDays).toBe(0);
  expect(existsSync(join(tmpDir, "missions", missionId, "evidence", "axiom"))).toBe(true);
});

test("mission.cleanup preserves evidence when evidence-metadata.json is missing", async () => {
  const missionId = "test-system-m000001";
  writeMissionManifest(tmpDir, missionId, "closed", "2026-01-01T00:00:00.000Z");
  createWorkpiece(tmpDir, missionId);
  const axiomDir = join(tmpDir, "missions", missionId, "evidence", "axiom");
  mkdirSync(axiomDir, { recursive: true });
  writeFileSync(join(axiomDir, "study-run.json"), "{}");

  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  const result = await runMissionCleanup(makeInput({ mission: missionId }), makeContext());

  const data = result.data as Record<string, unknown> | undefined;
  expect(data?.evidenceCleaned).toBe(false);
  expect(existsSync(axiomDir)).toBe(true);
});

test("mission.cleanup preserves non-Axiom evidence (close-report.json)", async () => {
  const missionId = "test-system-m000001";
  writeMissionManifest(tmpDir, missionId, "closed", "2026-01-01T00:00:00.000Z");
  createWorkpiece(tmpDir, missionId);
  const oldTimestamp = "2025-01-01T00:00:00.000Z";
  writeAxiomEvidence(tmpDir, missionId, oldTimestamp);
  writeNonAxiomEvidence(tmpDir, missionId);

  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  await runMissionCleanup(makeInput({ mission: missionId }), makeContext());

  expect(existsSync(join(tmpDir, "missions", missionId, "evidence", "axiom"))).toBe(false);
  expect(existsSync(join(tmpDir, "missions", missionId, "evidence", "close-report.json"))).toBe(
    true,
  );
});

test("mission.cleanup --older-than applies age-based evidence cleanup", async () => {
  const missionId = "test-system-m000001";
  writeMissionManifest(tmpDir, missionId, "closed", "2020-01-01T00:00:00.000Z");
  createWorkpiece(tmpDir, missionId);
  const oldTimestamp = "2020-01-01T00:00:00.000Z";
  writeAxiomEvidence(tmpDir, missionId, oldTimestamp);

  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  const result = await runMissionCleanup(
    makeInput({ "older-than": "1d", "evidence-retention-days": "1" }),
    makeContext(),
  );

  const data = result.data as Record<string, unknown> | undefined;
  expect(data?.evidenceCleaned).toBe(true);
  expect(existsSync(join(tmpDir, "missions", missionId, "evidence", "axiom"))).toBe(false);
});

test("mission.cleanup --json includes evidenceCleaned and evidenceRetentionDays fields", async () => {
  const missionId = "test-system-m000001";
  writeMissionManifest(tmpDir, missionId, "closed", "2026-01-01T00:00:00.000Z");
  createWorkpiece(tmpDir, missionId);

  const { runMissionCleanup } = await import("../mission/mission-cleanup.ts");
  const result = await runMissionCleanup(makeInput({ mission: missionId }), makeContext());

  const data = result.data as Record<string, unknown> | undefined;
  expect(data).toHaveProperty("evidenceCleaned");
  expect(data).toHaveProperty("evidenceRetentionDays");
  expect(data?.evidenceRetentionDays).toBe(30);
});
