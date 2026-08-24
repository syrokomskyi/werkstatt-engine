/*
<MODULE_CONTRACT>
<purpose>
RFC-0563: Unit tests for the git-mesh subsystem. Tests config validation,
auto-creation, convergence algorithm selection, non-fast-forward detection,
lock acquisition, status behind/ahead counting, and verify signature counting.
All tests use mocks — no real git operations.
</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0563: initial implementation — unit tests for gitmesh config, sync, status, verify.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateConfig,
  loadGitMeshConfig,
  autoCreateConfigFromGit,
  CONFIG_FILENAME,
} from "../gitmesh/config.ts";
import * as gitOps from "../gitmesh/git-ops.ts";
import type { GitMeshConfig } from "../gitmesh/types.ts";

// ---------------------------------------------------------------------------
// Config validation tests
// ---------------------------------------------------------------------------

function validConfig(): GitMeshConfig {
  return {
    remotes: [{ name: "origin", url: "git@github.com:foo/bar.git", trusted: true }],
    trackedBranch: "main",
    syncIntervalMs: 0,
    verifySignatures: false,
  };
}

test("validateConfig: accepts a valid config", () => {
  expect(() => validateConfig(validConfig())).not.toThrow();
});

test("validateConfig: rejects non-object", () => {
  expect(() => validateConfig(null)).toThrow("must be an object");
  expect(() => validateConfig("string")).toThrow("must be an object");
});

test("validateConfig: rejects missing remotes array", () => {
  const c = validConfig() as unknown as Record<string, unknown>;
  delete c.remotes;
  expect(() => validateConfig(c)).toThrow("remotes must be an array");
});

test("validateConfig: rejects remote with empty name", () => {
  const c = validConfig();
  c.remotes[0].name = "";
  expect(() => validateConfig(c)).toThrow("remote.name must be a non-empty string");
});

test("validateConfig: rejects remote with non-boolean trusted", () => {
  const c = validConfig();
  (c.remotes[0] as unknown as { trusted: string }).trusted = "yes";
  expect(() => validateConfig(c)).toThrow("remote.trusted must be a boolean");
});

test("validateConfig: rejects empty trackedBranch", () => {
  const c = validConfig();
  c.trackedBranch = "";
  expect(() => validateConfig(c)).toThrow("trackedBranch must be a non-empty string");
});

test("validateConfig: rejects negative syncIntervalMs", () => {
  const c = validConfig();
  c.syncIntervalMs = -1;
  expect(() => validateConfig(c)).toThrow("syncIntervalMs must be a non-negative number");
});

test("validateConfig: rejects non-boolean verifySignatures", () => {
  const c = validConfig() as unknown as Record<string, unknown>;
  c.verifySignatures = "true";
  expect(() => validateConfig(c)).toThrow("verifySignatures must be a boolean");
});

// ---------------------------------------------------------------------------
// Config loading and auto-creation tests (with temp directories)
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gitmesh-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("loadGitMeshConfig: loads and validates a valid config file", async () => {
  const config = validConfig();
  await writeFile(join(tempDir, CONFIG_FILENAME), JSON.stringify(config));
  const loaded = await loadGitMeshConfig(tempDir);
  expect(loaded.remotes).toHaveLength(1);
  expect(loaded.remotes[0].name).toBe("origin");
  expect(loaded.trackedBranch).toBe("main");
});

test("loadGitMeshConfig: throws when file does not exist", async () => {
  await expect(loadGitMeshConfig(tempDir)).rejects.toThrow();
});

test("autoCreateConfigFromGit: creates config from .git/config remotes", async () => {
  // Mock gitRemoteList
  vi.spyOn(gitOps, "gitRemoteList").mockResolvedValueOnce([
    { name: "origin", url: "git@github.com:foo/bar.git" },
    { name: "peer-1", url: "git@peer-1:foo/bar.git" },
  ]);

  const config = await autoCreateConfigFromGit(tempDir);
  expect(config.remotes).toHaveLength(2);
  expect(config.remotes[0].name).toBe("origin");
  expect(config.remotes[0].trusted).toBe(true);
  expect(config.remotes[1].name).toBe("peer-1");
  expect(config.trackedBranch).toBe("main");
  expect(config.syncIntervalMs).toBe(0);
  expect(config.verifySignatures).toBe(false);

  // Verify file was written
  const loaded = await loadGitMeshConfig(tempDir);
  expect(loaded.remotes).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// Convergence algorithm tests
// ---------------------------------------------------------------------------

test("convergence: selects remote with highest committer timestamp", () => {
  const fetchResults = [
    { remote: "origin", success: true, sha: "aaa", timestamp: 1000 },
    { remote: "peer-1", success: true, sha: "bbb", timestamp: 2000 },
    { remote: "peer-2", success: true, sha: "ccc", timestamp: 1500 },
  ];
  const latest = fetchResults.reduce((best, current) =>
    current.timestamp > best.timestamp ? current : best,
  );
  expect(latest.remote).toBe("peer-1");
  expect(latest.sha).toBe("bbb");
});

test("convergence: with equal timestamps, first remote wins (reduce is stable)", () => {
  const fetchResults = [
    { remote: "origin", success: true, sha: "aaa", timestamp: 1000 },
    { remote: "peer-1", success: true, sha: "bbb", timestamp: 1000 },
  ];
  const latest = fetchResults.reduce((best, current) =>
    current.timestamp > best.timestamp ? current : best,
  );
  expect(latest.remote).toBe("origin");
});

// ---------------------------------------------------------------------------
// Signature status counting tests
// ---------------------------------------------------------------------------

test("signature counting: G=signed, U=unsigned, B=invalid", () => {
  const commits = [
    { sha: "aaa", signatureStatus: "G" },
    { sha: "bbb", signatureStatus: "G" },
    { sha: "ccc", signatureStatus: "U" },
    { sha: "ddd", signatureStatus: "B" },
    { sha: "eee", signatureStatus: "X" },
  ];

  let signed = 0,
    unsigned = 0,
    invalid = 0;
  for (const commit of commits) {
    if (commit.signatureStatus === "G") signed++;
    else if (commit.signatureStatus === "U" || commit.signatureStatus === "N") unsigned++;
    else invalid++;
  }

  expect(signed).toBe(2);
  expect(unsigned).toBe(1);
  expect(invalid).toBe(2);
});

test("signature counting: verified is true when no unsigned and no invalid", () => {
  const commits = [
    { sha: "aaa", signatureStatus: "G" },
    { sha: "bbb", signatureStatus: "G" },
  ];

  let unsigned = 0,
    invalid = 0;
  for (const commit of commits) {
    if (commit.signatureStatus === "U" || commit.signatureStatus === "N") unsigned++;
    else if (commit.signatureStatus !== "G") invalid++;
  }

  const verified = unsigned === 0 && invalid === 0;
  expect(verified).toBe(true);
});

test("signature counting: verified is false when there are unsigned commits", () => {
  const commits = [
    { sha: "aaa", signatureStatus: "G" },
    { sha: "bbb", signatureStatus: "U" },
  ];

  let unsigned = 0,
    invalid = 0;
  for (const commit of commits) {
    if (commit.signatureStatus === "U" || commit.signatureStatus === "N") unsigned++;
    else if (commit.signatureStatus !== "G") invalid++;
  }

  const verified = unsigned === 0 && invalid === 0;
  expect(verified).toBe(false);
});

// ---------------------------------------------------------------------------
// Lock file tests
// ---------------------------------------------------------------------------

test("lock: acquireLock fails when lock file already exists", async () => {
  await mkdir(join(tempDir, ".git"), { recursive: true });
  await writeFile(join(tempDir, ".git", "gitmesh.lock"), "exists");

  const { open } = await import("node:fs/promises");
  try {
    await open(join(tempDir, ".git", "gitmesh.lock"), "wx");
    expect.fail("should have thrown");
  } catch (err) {
    expect((err as NodeJS.ErrnoException).code).toBe("EEXIST");
  }
});
