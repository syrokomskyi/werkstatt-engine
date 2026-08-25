/*
<MODULE_CONTRACT>
<purpose>RFC-0947: unit tests for sichtpass.generate — composite hash, deduplication, missing data handling.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0947: initial sichtpass-generate unit tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock bordbuch-io and bordbuch-commit-helper
vi.mock("../bordbuch/bordbuch-io.ts", () => ({
  readBordbuch: vi.fn(),
  resolveBordbuchProjectionDir: vi.fn(),
}));

vi.mock("../bordbuch/bordbuch-commit-helper.ts", () => ({
  appendAndCommitBordbuch: vi.fn(),
}));

// Mock registry-io
vi.mock("../sternsystem/registry-io.ts", () => ({
  resolveCacheClonePath: vi.fn(),
  resolveActiveWorkpieceDir: vi.fn(),
  readSystemState: vi.fn(),
  readSystemConfig: vi.fn(),
}));

// Mock nachweis-io
vi.mock("../nachweis/nachweis-io.ts", () => ({
  resolveNachweisCachePath: vi.fn(),
}));

// Mock werkstatt lock/operation
vi.mock("../werkstatt/index.ts", () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  generateOperationId: vi.fn(),
}));

import { runSichtpassGenerate } from "./sichtpass-generate.ts";
import { readBordbuch } from "../bordbuch/bordbuch-io.ts";
import { appendAndCommitBordbuch } from "../bordbuch/bordbuch-commit-helper.ts";
import {
  resolveCacheClonePath,
  resolveActiveWorkpieceDir,
  readSystemState,
  readSystemConfig,
} from "../sternsystem/registry-io.ts";
import { resolveNachweisCachePath } from "../nachweis/nachweis-io.ts";
import { acquireLock, releaseLock, generateOperationId } from "../werkstatt/index.ts";
import type { BordbuchEntry } from "@warpgogol/werkstatt-engine/schemas";

const mockReadBordbuch = vi.mocked(readBordbuch);
const mockAppendAndCommit = vi.mocked(appendAndCommitBordbuch);
const mockResolveCacheClone = vi.mocked(resolveCacheClonePath);
const mockResolveWorkpiece = vi.mocked(resolveActiveWorkpieceDir);
const mockReadSystemState = vi.mocked(readSystemState);
const mockReadSystemConfig = vi.mocked(readSystemConfig);
const mockResolveNachweisCache = vi.mocked(resolveNachweisCachePath);
const mockAcquireLock = vi.mocked(acquireLock);
const mockReleaseLock = vi.mocked(releaseLock);
const mockGenerateOpId = vi.mocked(generateOperationId);

let tmpDir: string;
let cachePath: string;
const systemId = "test-system";
const workspaceRoot = "/fake/workspace";

function makeContext() {
  return {
    workspaceRoot,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      debug: vi.fn(),
    },
    site: { name: systemId },
  } as any;
}

function makeInput(flags: Record<string, unknown> = {}) {
  return { flags } as any;
}

function makeBordbuchEntry(
  kind: string,
  metadata: Record<string, unknown>,
  id = "evt-001",
): BordbuchEntry {
  return {
    schemaVersion: "1.0.0",
    id,
    systemId,
    occurredAt: "2025-01-01T00:00:00.000Z",
    kind: kind as BordbuchEntry["kind"],
    status: "done",
    missionId: null,
    releaseId: null,
    actor: "agent",
    summary: "test",
    metadata,
    previousHash: null,
    hash: "sha256:abc",
  } as BordbuchEntry;
}

beforeEach(() => {
  tmpDir = path.join(
    os.tmpdir(),
    `sichtpass-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  cachePath = path.join(tmpDir, "cache");
  mkdirSync(cachePath, { recursive: true });

  vi.clearAllMocks();

  mockResolveCacheClone.mockResolvedValue(cachePath);
  mockResolveWorkpiece.mockResolvedValue(null);
  mockResolveNachweisCache.mockResolvedValue(cachePath);
  mockReadSystemState.mockResolvedValue({
    schemaVersion: "1.0.0",
    systemId,
    currentMission: null,
    lastRelease: null,
    lastPropagated: {},
    accessPin: null,
  } as any);
  mockReadSystemConfig.mockResolvedValue({
    deployment: {
      adapter: "cloudflare-workers",
      channels: {
        dev: { workerName: "w-dev", url: "https://dev.example.com" },
        alt: { workerName: "w-alt", url: "https://alt.example.com" },
        main: { workerName: "w-main", url: "https://main.example.com" },
      },
    },
  } as any);
  mockReadBordbuch.mockResolvedValue([]);
  mockAppendAndCommit.mockResolvedValue({
    entry: {} as BordbuchEntry,
    commitResult: { commitSha: "abc", pushed: true, error: null },
  } as any);
  mockAcquireLock.mockResolvedValue(undefined as any);
  mockReleaseLock.mockResolvedValue(undefined as any);
  mockGenerateOpId.mockReturnValue("op-test");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("computes composite hash and appends Bordbuch entry on first run", async () => {
  const result = await runSichtpassGenerate(makeInput(), makeContext());

  expect(result.exitCode).toBe(0);
  const data = result.data as any;
  expect(data).toHaveProperty("compositeHash");
  expect(data.compositeHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(mockAppendAndCommit).toHaveBeenCalledOnce();
});

test("deduplicates — skips Bordbuch append when composite hash is unchanged", async () => {
  // First run to get the composite hash
  const result1 = await runSichtpassGenerate(makeInput(), makeContext());
  const compositeHash = (result1.data as any).compositeHash;

  // Second run: bordbuch now has the last sichtpass __site__ entry with same hash
  mockReadBordbuch.mockResolvedValue([
    makeBordbuchEntry("sichtpass", {
      slug: "__site__",
      recordHash: compositeHash,
    }),
  ]);

  vi.clearAllMocks();
  mockReadBordbuch.mockResolvedValue([
    makeBordbuchEntry("sichtpass", {
      slug: "__site__",
      recordHash: compositeHash,
    }),
  ]);

  const result2 = await runSichtpassGenerate(makeInput(), makeContext());

  expect(result2.exitCode).toBe(0);
  expect(mockAppendAndCommit).not.toHaveBeenCalled();
  expect(result2.summary).toContain("deduplicated=true");
});

test("appends Bordbuch entry when composite hash differs from last entry", async () => {
  mockReadBordbuch.mockResolvedValue([
    makeBordbuchEntry("sichtpass", {
      slug: "__site__",
      recordHash: "sha256:different-hash-1234567890abcdef",
    }),
  ]);

  const result = await runSichtpassGenerate(makeInput(), makeContext());

  expect(result.exitCode).toBe(0);
  expect(mockAppendAndCommit).toHaveBeenCalledOnce();
});

test("handles missing data sources gracefully", async () => {
  // No files exist in cachePath — all data sources should return defaults
  const result = await runSichtpassGenerate(makeInput(), makeContext());

  expect(result.exitCode).toBe(0);
  const data = result.data as any;
  expect(data.contentHash).toBeNull();
  expect(data.routeCount).toBe(0);
  expect(data.behaviorRouteCount).toBe(0);
  expect(data.nachweisCount).toBe(0);
  expect(data.nachweisSlugs).toEqual([]);
  expect(data.pseoModules).toEqual([]);
  expect(data.coverageAtoms).toBe(0);
  expect(data.coveragePages).toEqual([]);
});

test("reads nachweis manifest when present", async () => {
  const manifestDir = path.join(cachePath, "public", "nachweise");
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(
    path.join(manifestDir, "manifest.json"),
    JSON.stringify({
      records: [{ slug: "record-a" }, { slug: "record-b" }],
    }),
  );

  const result = await runSichtpassGenerate(makeInput(), makeContext());
  const data = result.data as any;

  expect(data.nachweisCount).toBe(2);
  expect(data.nachweisSlugs).toEqual(["record-a", "record-b"]);
});

test("reads coverage ledger when present", async () => {
  const ledgerDir = path.join(cachePath, "provenance");
  await fs.mkdir(ledgerDir, { recursive: true });
  await fs.writeFile(
    path.join(ledgerDir, "coverage-ledger.yaml"),
    [
      "version: 1",
      "atoms:",
      "  - atomId: a1",
      "    sourceId: s1",
      "    version: '1.0'",
      "    atomHash: sha256:abc",
      "    batch: batch-1",
      "    pageId: page-a",
      "    acceptedAt: '2025-01-01'",
      "  - atomId: a2",
      "    sourceId: s2",
      "    version: '1.0'",
      "    atomHash: sha256:def",
      "    batch: batch-1",
      "    pageId: page-b",
      "    acceptedAt: '2025-01-01'",
      "  - atomId: a3",
      "    sourceId: s3",
      "    version: '1.0'",
      "    atomHash: sha256:ghi",
      "    batch: batch-1",
      "    pageId: page-a",
      "    acceptedAt: '2025-01-01'",
      "    supersededBy: a1",
    ].join("\n"),
  );

  const result = await runSichtpassGenerate(makeInput(), makeContext());
  const data = result.data as any;

  // a3 is superseded, so only 2 active atoms, 2 unique pages
  expect(data.coverageAtoms).toBe(2);
  expect(data.coveragePages).toEqual(["page-a", "page-b"]);
});

test("reads bordbuch status.generated.yaml pseo modules when present", async () => {
  const bordbuchDir = path.join(cachePath, "bordbuch");
  await fs.mkdir(bordbuchDir, { recursive: true });
  await fs.writeFile(
    path.join(bordbuchDir, "status.generated.yaml"),
    [
      "site: test-system",
      "pseo:",
      "  modules:",
      "    - id: mod-a",
      "      entitlement: nachweis",
      "      masterLocale: de",
      "      publishedLocales: [de, en]",
      "      blueprints: [bp-1]",
    ].join("\n"),
  );

  const result = await runSichtpassGenerate(makeInput(), makeContext());
  const data = result.data as any;

  expect(data.pseoModules).toHaveLength(1);
  expect(data.pseoModules[0]).toEqual({
    id: "mod-a",
    masterLocale: "de",
    publishedLocales: ["de", "en"],
  });
});

test("composite hash is deterministic for same input", async () => {
  const result1 = await runSichtpassGenerate(makeInput(), makeContext());
  const result2 = await runSichtpassGenerate(makeInput(), makeContext());

  const hash1 = (result1.data as any).compositeHash;
  const hash2 = (result2.data as any).compositeHash;

  expect(hash1).toBe(hash2);
});

test("composite hash changes when nachweis count changes", async () => {
  const result1 = await runSichtpassGenerate(makeInput(), makeContext());
  const hash1 = (result1.data as any).compositeHash;

  // Add nachweis manifest
  const manifestDir = path.join(cachePath, "public", "nachweise");
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(
    path.join(manifestDir, "manifest.json"),
    JSON.stringify({ records: [{ slug: "record-a" }] }),
  );

  const result2 = await runSichtpassGenerate(makeInput(), makeContext());
  const hash2 = (result2.data as any).compositeHash;

  expect(hash1).not.toBe(hash2);
});

test("fail-open: Bordbuch read failure does not prevent append", async () => {
  mockReadBordbuch.mockRejectedValue(new Error("bordbuch read failed"));

  const result = await runSichtpassGenerate(makeInput(), makeContext());

  expect(result.exitCode).toBe(0);
  expect(mockAppendAndCommit).toHaveBeenCalledOnce();
});

test("fail-open: Bordbuch append failure is non-fatal", async () => {
  mockAppendAndCommit.mockRejectedValue(new Error("bordbuch append failed"));

  const result = await runSichtpassGenerate(makeInput(), makeContext());

  expect(result.exitCode).toBe(0);
  expect(result.summary).toContain("warning=");
});

test("acquires and releases system and bordbuch locks", async () => {
  await runSichtpassGenerate(makeInput(), makeContext());

  expect(mockAcquireLock).toHaveBeenCalledTimes(2);
  expect(mockReleaseLock).toHaveBeenCalledTimes(2);

  const lockCalls = mockAcquireLock.mock.calls.map((c) => c[1]);
  expect(lockCalls).toContain(`system:${systemId}`);
  expect(lockCalls).toContain(`bordbuch:${systemId}`);
});

test("uses --system flag when provided", async () => {
  const customSystem = "custom-sys";
  const result = await runSichtpassGenerate(makeInput({ system: customSystem }), makeContext());

  expect(result.exitCode).toBe(0);
  const data = result.data as any;
  expect(data.systemId).toBe(customSystem);
});
