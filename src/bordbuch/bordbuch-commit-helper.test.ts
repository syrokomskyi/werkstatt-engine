/*
<MODULE_CONTRACT>
  <purpose>RFC-0750: unit tests for bordbuch-commit-helper — appendAndCommitBordbuch and appendBatchAndCommitBordbuch.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0750: initial bordbuch-commit-helper unit tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock the bordbuch-io and registry-io modules
vi.mock("./bordbuch-io.ts", () => ({
  appendBordbuchEntry: vi.fn(),
  commitAndPushBordbuch: vi.fn(),
}));

vi.mock("../sternsystem/registry-io.ts", () => ({
  resolveCacheClonePath: vi.fn(),
}));

import { appendAndCommitBordbuch, appendBatchAndCommitBordbuch } from "./bordbuch-commit-helper.ts";
import { appendBordbuchEntry, commitAndPushBordbuch } from "./bordbuch-io.ts";
import { resolveCacheClonePath } from "../sternsystem/registry-io.ts";
import type { BordbuchEntry } from "@warpgogol/werkstatt-engine/schemas";

const mockAppendBordbuchEntry = vi.mocked(appendBordbuchEntry);
const mockCommitAndPushBordbuch = vi.mocked(commitAndPushBordbuch);
const mockResolveCachePath = vi.mocked(resolveCacheClonePath);

let tmpDir: string;
const systemId = "test-system";

beforeEach(() => {
  tmpDir = path.join(
    os.tmpdir(),
    `bordbuch-helper-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
  vi.clearAllMocks();
  mockResolveCachePath.mockResolvedValue(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("appendAndCommitBordbuch appends entry and commits with default message", async () => {
  const mockEntry = {
    id: "evt-001",
    kind: "mission-open",
    systemId,
    summary: "test",
  } as BordbuchEntry;
  const mockCommitResult = { commitSha: "abc123", pushed: true, error: null };
  mockAppendBordbuchEntry.mockResolvedValue(mockEntry);
  mockCommitAndPushBordbuch.mockResolvedValue(mockCommitResult);

  const result = await appendAndCommitBordbuch(
    tmpDir,
    systemId,
    "mission-open",
    "test summary",
    "agent",
    { writerRole: "mission" },
  );

  expect(result.entry).toEqual(mockEntry);
  expect(result.commitResult).toEqual(mockCommitResult);
  expect(mockAppendBordbuchEntry).toHaveBeenCalledWith(
    tmpDir,
    systemId,
    "mission-open",
    "test summary",
    "agent",
    { writerRole: "mission" },
  );
  expect(mockCommitAndPushBordbuch).toHaveBeenCalledWith(
    tmpDir,
    "Bordbuch: mission-open test-system",
  );
});

test("appendAndCommitBordbuch uses custom commit message when provided", async () => {
  const mockEntry = {
    id: "evt-002",
    kind: "mission-close",
    systemId,
    summary: "test",
  } as BordbuchEntry;
  const mockCommitResult = { commitSha: "def456", pushed: true, error: null };
  mockAppendBordbuchEntry.mockResolvedValue(mockEntry);
  mockCommitAndPushBordbuch.mockResolvedValue(mockCommitResult);

  const result = await appendAndCommitBordbuch(
    tmpDir,
    systemId,
    "mission-close",
    "test close",
    "agent",
    undefined,
    "Custom commit message",
  );

  expect(result.entry).toEqual(mockEntry);
  expect(mockCommitAndPushBordbuch).toHaveBeenCalledWith(tmpDir, "Custom commit message");
});

test("appendAndCommitBordbuch does not throw on commit failure", async () => {
  const mockEntry = {
    id: "evt-003",
    kind: "mission-abort",
    systemId,
    summary: "test",
  } as BordbuchEntry;
  const mockCommitResult = { commitSha: null, pushed: false, error: "git error" };
  mockAppendBordbuchEntry.mockResolvedValue(mockEntry);
  mockCommitAndPushBordbuch.mockResolvedValue(mockCommitResult);

  const result = await appendAndCommitBordbuch(
    tmpDir,
    systemId,
    "mission-abort",
    "test abort",
    "agent",
  );

  expect(result.commitResult.commitSha).toBe(null);
  expect(result.commitResult.pushed).toBe(false);
});

test("appendBatchAndCommitBordbuch appends all entries and commits once", async () => {
  const mockEntry1 = {
    id: "evt-004",
    kind: "nachweis-consent",
    systemId,
    summary: "consent",
  } as BordbuchEntry;
  const mockEntry2 = {
    id: "evt-005",
    kind: "nachweis-record",
    systemId,
    summary: "record",
  } as BordbuchEntry;
  const mockCommitResult = { commitSha: "ghi789", pushed: true, error: null };
  mockAppendBordbuchEntry.mockResolvedValueOnce(mockEntry1).mockResolvedValueOnce(mockEntry2);
  mockCommitAndPushBordbuch.mockResolvedValue(mockCommitResult);

  const result = await appendBatchAndCommitBordbuch(
    tmpDir,
    systemId,
    [
      {
        kind: "nachweis-consent",
        summary: "consent revoked",
        actor: "agent",
        options: { writerRole: "nachweis", metadata: { action: "withdraw" } },
      },
      {
        kind: "nachweis-record",
        summary: "record withdrawn",
        actor: "agent",
        options: { writerRole: "nachweis", metadata: { action: "withdraw" } },
      },
    ],
    "Bordbuch: nachweis-withdraw test-system test-slug",
  );

  expect(result.entries).toHaveLength(2);
  expect(result.entries[0]).toEqual(mockEntry1);
  expect(result.entries[1]).toEqual(mockEntry2);
  expect(result.commitResult).toEqual(mockCommitResult);
  expect(mockAppendBordbuchEntry).toHaveBeenCalledTimes(2);
  expect(mockCommitAndPushBordbuch).toHaveBeenCalledTimes(1);
  expect(mockCommitAndPushBordbuch).toHaveBeenCalledWith(
    tmpDir,
    "Bordbuch: nachweis-withdraw test-system test-slug",
  );
});

test("appendBatchAndCommitBordbuch with empty entries still commits", async () => {
  const mockCommitResult = { commitSha: "empty-commit", pushed: true, error: null };
  mockCommitAndPushBordbuch.mockResolvedValue(mockCommitResult);

  const result = await appendBatchAndCommitBordbuch(
    tmpDir,
    systemId,
    [],
    "Bordbuch: empty-batch test-system",
  );

  expect(result.entries).toHaveLength(0);
  expect(mockAppendBordbuchEntry).not.toHaveBeenCalled();
  expect(mockCommitAndPushBordbuch).toHaveBeenCalledTimes(1);
});
