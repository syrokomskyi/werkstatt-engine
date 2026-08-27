/*
<MODULE_CONTRACT>
  <purpose>Test RFC-0958: mission.resume and mission.journal.show command handlers.</purpose>
</MODULE_CONTRACT>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

vi.mock("../mission-io.ts", () => ({
  readMissionManifest: vi.fn(),
  writeMissionManifest: vi.fn(),
  resolveMissionDir: vi.fn((workspaceRoot: string, missionId: string) =>
    path.join(workspaceRoot, "missions", missionId),
  ),
}));

vi.mock("../../werkstatt/index.ts", () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  isLockStale: vi.fn().mockReturnValue(false),
  removeStaleLock: vi.fn(),
  readAllLocks: vi.fn().mockResolvedValue([]),
  commitWerkstattSideEffects: vi.fn(),
}));

vi.mock("../steps/index.ts", () => ({
  resolveOperationSteps: vi.fn(),
}));

import { runMissionResume } from "../mission-resume.ts";
import { runMissionJournalShow } from "../mission-journal-show.ts";
import { readMissionManifest } from "../mission-io.ts";
import { resolveOperationSteps } from "../steps/index.ts";
import { appendRecord } from "../../journal/index.ts";
import type { OperationStep } from "../../journal/index.ts";

let tmpDir: string;
let missionDir: string;
let journalPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "mission-resume-"));
  missionDir = path.join(tmpDir, "missions", "m-test");
  journalPath = path.join(missionDir, "journal.jsonl");
  mkdirSync(missionDir, { recursive: true });
  vi.mocked(readMissionManifest).mockResolvedValue({
    missionId: "m-test",
    systemId: "test-system",
    operationId: "op-test-123",
    state: "open",
    brief: "test",
    createdAt: "2026-08-27",
    operator: "agent",
  } as any);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

test("mission.resume with no incomplete operation returns nothing to resume", async () => {
  const result = await runMissionResume(
    { argv: [], flags: { mission: "m-test" } },
    {
      workspaceRoot: tmpDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        success: () => {},
        section: () => {},
        event: () => {},
        getEvents: () => [],
      } as any,
      dryRun: false,
      siteExplicit: false,
      outputFormat: "pretty",
      io: {} as any,
      registry: undefined as never,
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.summary).toContain("nothing to resume");
});

test("mission.resume with incomplete operation calls resolveOperationSteps and runs", async () => {
  await appendRecord(journalPath, {
    kind: "op-started",
    opId: "op-1",
    op: "mission.close",
    missionId: "m-test",
    at: "2026-08-27T00:00:00.000Z",
    platformVersion: "1.0.0",
  });
  await appendRecord(journalPath, {
    kind: "step-started",
    opId: "op-1",
    step: "s0",
    seq: 0,
    at: "t1",
  });
  await appendRecord(journalPath, {
    kind: "step-done",
    opId: "op-1",
    step: "s0",
    seq: 0,
    at: "t2",
  });
  await appendRecord(journalPath, {
    kind: "step-started",
    opId: "op-1",
    step: "s1",
    seq: 1,
    at: "t3",
  });

  const steps: OperationStep<unknown>[] = [
    {
      name: "s0",
      run: async () => {},
      verify: async () => true,
    },
    {
      name: "s1",
      run: async () => {},
      verify: async () => true,
    },
  ];
  vi.mocked(resolveOperationSteps).mockResolvedValue(steps);

  const result = await runMissionResume(
    { argv: [], flags: { mission: "m-test" } },
    {
      workspaceRoot: tmpDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        success: () => {},
        section: () => {},
        event: () => {},
        getEvents: () => [],
      } as any,
      dryRun: false,
      siteExplicit: false,
      outputFormat: "pretty",
      io: {} as any,
      registry: undefined as never,
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.data?.completed).toBe(true);
  expect(result.data?.resumedOp).toBe("mission.close");
});

test("mission.resume --abandon without --force returns error", async () => {
  const result = await runMissionResume(
    { argv: [], flags: { mission: "m-test", abandon: true } },
    {
      workspaceRoot: tmpDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        success: () => {},
        section: () => {},
        event: () => {},
        getEvents: () => [],
      } as any,
      dryRun: false,
      siteExplicit: false,
      outputFormat: "pretty",
      io: {} as any,
      registry: undefined as never,
    },
  );

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("--abandon requires --force");
});

test("mission.resume --abandon --force appends op-abandoned", async () => {
  await appendRecord(journalPath, {
    kind: "op-started",
    opId: "op-1",
    op: "mission.close",
    missionId: "m-test",
    at: "2026-08-27T00:00:00.000Z",
    platformVersion: "1.0.0",
  });

  const result = await runMissionResume(
    { argv: [], flags: { mission: "m-test", abandon: true, force: true } },
    {
      workspaceRoot: tmpDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        success: () => {},
        section: () => {},
        event: () => {},
        getEvents: () => [],
      } as any,
      dryRun: false,
      siteExplicit: false,
      outputFormat: "pretty",
      io: {} as any,
      registry: undefined as never,
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.data?.abandoned).toBe(true);
});

test("mission.resume without --mission returns error", async () => {
  const result = await runMissionResume(
    { argv: [], flags: {} },
    {
      workspaceRoot: tmpDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        success: () => {},
        section: () => {},
        event: () => {},
        getEvents: () => [],
      } as any,
      dryRun: false,
      siteExplicit: false,
      outputFormat: "pretty",
      io: {} as any,
      registry: undefined as never,
    },
  );

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("--mission is required");
});

test("mission.journal.show returns records and incomplete operation info", async () => {
  await appendRecord(journalPath, {
    kind: "op-started",
    opId: "op-1",
    op: "mission.close",
    missionId: "m-test",
    at: "2026-08-27T00:00:00.000Z",
    platformVersion: "1.0.0",
  });
  await appendRecord(journalPath, {
    kind: "step-started",
    opId: "op-1",
    step: "s0",
    seq: 0,
    at: "t1",
  });

  const result = await runMissionJournalShow(
    { argv: [], flags: { mission: "m-test" } },
    {
      workspaceRoot: tmpDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        success: () => {},
        section: () => {},
        event: () => {},
        getEvents: () => [],
      } as any,
      dryRun: false,
      siteExplicit: false,
      outputFormat: "pretty",
      io: {} as any,
      registry: undefined as never,
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.data?.records).toHaveLength(2);
  expect(result.data?.incompleteOperation).toEqual({
    opId: "op-1",
    op: "mission.close",
    lastSeq: 0,
  });
});

test("mission.journal.show with --op filter returns only matching records", async () => {
  await appendRecord(journalPath, {
    kind: "op-started",
    opId: "op-1",
    op: "mission.close",
    missionId: "m-test",
    at: "2026-08-27T00:00:00.000Z",
    platformVersion: "1.0.0",
  });
  await appendRecord(journalPath, {
    kind: "op-started",
    opId: "op-2",
    op: "mission.reconcile",
    missionId: "m-test",
    at: "2026-08-27T00:00:01.000Z",
    platformVersion: "1.0.0",
  });

  const result = await runMissionJournalShow(
    { argv: [], flags: { mission: "m-test", op: "op-2" } },
    {
      workspaceRoot: tmpDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        success: () => {},
        section: () => {},
        event: () => {},
        getEvents: () => [],
      } as any,
      dryRun: false,
      siteExplicit: false,
      outputFormat: "pretty",
      io: {} as any,
      registry: undefined as never,
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.data?.records).toHaveLength(1);
});

test("mission.journal.show with no journal returns empty records", async () => {
  const result = await runMissionJournalShow(
    { argv: [], flags: { mission: "m-test" } },
    {
      workspaceRoot: tmpDir,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        success: () => {},
        section: () => {},
        event: () => {},
        getEvents: () => [],
      } as any,
      dryRun: false,
      siteExplicit: false,
      outputFormat: "pretty",
      io: {} as any,
      registry: undefined as never,
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.data?.records).toEqual([]);
  expect(result.data?.incompleteOperation).toBeNull();
});
