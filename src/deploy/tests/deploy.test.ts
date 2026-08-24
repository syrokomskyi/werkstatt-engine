/*
<MODULE_CONTRACT>
  <purpose>RFC-0566: unit tests for deploy commands — atomicity, hash verification, first-deploy, rollback, immutability.</purpose>
  <keywords>deploy, test, atomic, swap, rollback, verify, gc, immutability</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy unit tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import { existsSync, symlinkSync, readlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

import {
  artifactDir,
  atomicSymlinkSwap,
  currentSymlinkPath,
  previousSymlinkPath,
  hashArtifactDir,
  listArtifactHashes,
  distPath,
  platformArtifactsBase,
  writeManifest,
  readSymlinkBasename,
} from "../deploy-utils.ts";
import { runDeployArtifactVerify } from "../artifact-verify.ts";
import { runDeployAtomicSwap } from "../atomic-swap.ts";
import { runDeployAtomicRollback } from "../atomic-rollback.ts";
import { runDeployArtifactGc } from "../artifact-gc.ts";
import { runDeployStatus } from "../deploy-status.ts";
import type { ArtifactManifest } from "../types.ts";

let tmpDir: string;

function mockContext(workspaceRoot: string): KernelRuntimeContext {
  return {
    workspaceRoot,
    logger: {
      info: () => {},
      success: () => {},
      error: () => {},
      warn: () => {},
      event: () => {},
      getEvents: () => [],
    },
  } as unknown as KernelRuntimeContext;
}

function mockInput(flags: Record<string, boolean | string | string[]> = {}): KernelCommandInput {
  return { argv: [], flags } as KernelCommandInput;
}

async function createArtifact(
  workspaceRoot: string,
  _label: string,
  files: Record<string, string> = {},
): Promise<string> {
  const stagingDir = path.join(
    platformArtifactsBase(workspaceRoot),
    `.staging-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const stagingDist = path.join(stagingDir, "dist");
  await fs.mkdir(stagingDist, { recursive: true });

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(stagingDist, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
  }

  const { treeHash, files: fileRecords, totalSize } = await hashArtifactDir(stagingDist);
  const finalDir = artifactDir(workspaceRoot, treeHash);

  if (!existsSync(finalDir)) {
    await fs.mkdir(path.dirname(finalDir), { recursive: true });
    await fs.rename(stagingDir, finalDir);
  } else {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }

  const manifest: ArtifactManifest = {
    hash: treeHash,
    files: fileRecords,
    totalSize,
    builtAt: new Date().toISOString(),
    gitSha: "abc123",
    buildHost: "test",
    signature: "",
    signatureAlgorithm: "Ed25519",
  };
  await writeManifest(workspaceRoot, treeHash, manifest);
  return treeHash;
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deploy-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("hashArtifactDir: empty directory returns empty file list", async () => {
  const emptyDir = path.join(tmpDir, "empty");
  await fs.mkdir(emptyDir, { recursive: true });
  const result = await hashArtifactDir(emptyDir);
  expect(result.files).toEqual([]);
  expect(result.totalSize).toBe(0);
});

test("hashArtifactDir: produces deterministic hash for same content", async () => {
  const dir1 = path.join(tmpDir, "dir1");
  const dir2 = path.join(tmpDir, "dir2");
  await fs.mkdir(path.join(dir1, "pkg"), { recursive: true });
  await fs.mkdir(path.join(dir2, "pkg"), { recursive: true });
  await fs.writeFile(path.join(dir1, "pkg", "index.js"), "hello");
  await fs.writeFile(path.join(dir2, "pkg", "index.js"), "hello");

  const r1 = await hashArtifactDir(dir1);
  const r2 = await hashArtifactDir(dir2);
  expect(r1.treeHash).toBe(r2.treeHash);
  expect(r1.files).toHaveLength(1);
});

test("atomicSymlinkSwap: creates symlink atomically", async () => {
  const targetDir = path.join(tmpDir, "target");
  await fs.mkdir(targetDir, { recursive: true });
  const symlinkPath = path.join(tmpDir, "link");
  await atomicSymlinkSwap(symlinkPath, targetDir);
  expect(existsSync(symlinkPath)).toBe(true);
  expect(readlinkSync(symlinkPath)).toBe(targetDir);
});

test("atomicSymlinkSwap: replaces existing symlink", async () => {
  const target1 = path.join(tmpDir, "t1");
  const target2 = path.join(tmpDir, "t2");
  await fs.mkdir(target1, { recursive: true });
  await fs.mkdir(target2, { recursive: true });
  const symlinkPath = path.join(tmpDir, "link");
  await atomicSymlinkSwap(symlinkPath, target1);
  await atomicSymlinkSwap(symlinkPath, target2);
  expect(readlinkSync(symlinkPath)).toBe(target2);
});

test("deploy.artifact.verify: passes for valid artifact", async () => {
  const hash = await createArtifact(tmpDir, "test", { "pkg/index.js": "content" });

  const result = await runDeployArtifactVerify(mockInput({ hash }), mockContext(tmpDir));
  expect(result.data?.verified).toBe(true);
  expect(result.exitCode).toBeUndefined();
});

test("deploy.artifact.verify: fails for corrupted artifact", async () => {
  const hash = await createArtifact(tmpDir, "test", { "pkg/index.js": "content" });

  const distDir = distPath(tmpDir, hash);
  await fs.writeFile(path.join(distDir, "pkg/index.js"), "corrupted");

  const result = await runDeployArtifactVerify(mockInput({ hash }), mockContext(tmpDir));
  expect(result.data?.verified).toBe(false);
  expect(result.exitCode).toBe(1);
});

test("deploy.artifact.verify: fails for missing artifact", async () => {
  const result = await runDeployArtifactVerify(
    mockInput({ hash: "sha256:nonexistent" }),
    mockContext(tmpDir),
  );
  expect(result.data?.verified).toBe(false);
  expect(result.exitCode).toBe(1);
});

test("deploy.atomic.swap: first deploy creates current symlink, no previous", async () => {
  const hash = await createArtifact(tmpDir, "test", { "pkg/index.js": "v1" });

  const result = await runDeployAtomicSwap(mockInput({ hash }), mockContext(tmpDir));

  expect(result.data?.swapped).toBe(true);
  expect(result.data?.newHash).toBe(hash);
  expect(result.data?.previousHash).toBeNull();
  expect(readSymlinkBasename(currentSymlinkPath(tmpDir))).toBe(hash);
  expect(readSymlinkBasename(previousSymlinkPath(tmpDir))).toBeNull();
});

test("deploy.atomic.swap: second deploy updates current and creates previous", async () => {
  const hash1 = await createArtifact(tmpDir, "v1", { "pkg/index.js": "v1" });
  await runDeployAtomicSwap(mockInput({ hash: hash1 }), mockContext(tmpDir));

  const hash2 = await createArtifact(tmpDir, "v2", { "pkg/index.js": "v2" });

  const result = await runDeployAtomicSwap(mockInput({ hash: hash2 }), mockContext(tmpDir));

  expect(result.data?.swapped).toBe(true);
  expect(result.data?.newHash).toBe(hash2);
  expect(result.data?.previousHash).toBe(hash1);
  expect(readSymlinkBasename(currentSymlinkPath(tmpDir))).toBe(hash2);
  expect(readSymlinkBasename(previousSymlinkPath(tmpDir))).toBe(hash1);
});

test("deploy.atomic.swap: rejects corrupted artifact with hash-mismatch", async () => {
  const hash = await createArtifact(tmpDir, "test", { "pkg/index.js": "content" });

  const distDir = distPath(tmpDir, hash);
  await fs.writeFile(path.join(distDir, "pkg/index.js"), "corrupted");

  await expect(runDeployAtomicSwap(mockInput({ hash }), mockContext(tmpDir))).rejects.toThrow(
    "hash-mismatch",
  );
});

test("deploy.atomic.rollback: rolls back to previous artifact", async () => {
  const hash1 = await createArtifact(tmpDir, "v1", { "pkg/index.js": "v1" });
  await runDeployAtomicSwap(mockInput({ hash: hash1 }), mockContext(tmpDir));

  const hash2 = await createArtifact(tmpDir, "v2", { "pkg/index.js": "v2" });
  await runDeployAtomicSwap(mockInput({ hash: hash2 }), mockContext(tmpDir));

  const result = await runDeployAtomicRollback(mockInput(), mockContext(tmpDir));

  expect(result.data?.swapped).toBe(true);
  expect(result.data?.newHash).toBe(hash1);
  expect(readSymlinkBasename(currentSymlinkPath(tmpDir))).toBe(hash1);
});

test("deploy.atomic.rollback: fails with no-previous-artifact on first deploy", async () => {
  const hash1 = await createArtifact(tmpDir, "v1", { "pkg/index.js": "v1" });
  await runDeployAtomicSwap(mockInput({ hash: hash1 }), mockContext(tmpDir));

  const result = await runDeployAtomicRollback(mockInput(), mockContext(tmpDir));

  expect(result.data?.swapped).toBe(false);
  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("no-previous-artifact");
});

test("deploy.artifact.gc: dry-run reports candidates without deleting", async () => {
  const base = platformArtifactsBase(tmpDir);
  await fs.mkdir(base, { recursive: true });

  for (let i = 0; i < 7; i++) {
    const dir = path.join(base, `sha256:fake${i}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "manifest.json"), "{}");
  }

  const result = await runDeployArtifactGc(
    mockInput({ "dry-run": true, retain: "3" }),
    mockContext(tmpDir),
  );

  expect(result.data?.dryRun).toBe(true);
  expect(result.data?.deleted).toBe(0);
  expect(result.data?.candidates.length).toBeGreaterThan(0);
});

test("deploy.artifact.gc: never deletes artifacts referenced by symlinks", async () => {
  const hash1 = await createArtifact(tmpDir, "v1", { "pkg/index.js": "v1" });
  await runDeployAtomicSwap(mockInput({ hash: hash1 }), mockContext(tmpDir));

  const hash2 = await createArtifact(tmpDir, "v2", { "pkg/index.js": "v2" });
  await runDeployAtomicSwap(mockInput({ hash: hash2 }), mockContext(tmpDir));

  for (let i = 0; i < 5; i++) {
    const dir = path.join(platformArtifactsBase(tmpDir), `sha256:fake${i}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "manifest.json"), "{}");
  }

  const result = await runDeployArtifactGc(mockInput({ retain: "2" }), mockContext(tmpDir));

  expect(result.data?.deleted).toBeGreaterThan(0);
  expect(existsSync(artifactDir(tmpDir, hash1))).toBe(true);
  expect(existsSync(artifactDir(tmpDir, hash2))).toBe(true);
});

test("deploy.status: reports current and previous hashes", async () => {
  const hash1 = await createArtifact(tmpDir, "v1", { "pkg/index.js": "v1" });
  await runDeployAtomicSwap(mockInput({ hash: hash1 }), mockContext(tmpDir));

  const hash2 = await createArtifact(tmpDir, "v2", { "pkg/index.js": "v2" });
  await runDeployAtomicSwap(mockInput({ hash: hash2 }), mockContext(tmpDir));

  const result = await runDeployStatus(mockInput(), mockContext(tmpDir));

  expect(result.data?.currentHash).toBe(hash2);
  expect(result.data?.previousHash).toBe(hash1);
  expect(result.data?.currentGitSha).toBe("abc123");
  expect(result.data?.deployedAt).toBeTruthy();
});

test("deploy.status: returns nulls when no artifacts deployed", async () => {
  const result = await runDeployStatus(mockInput(), mockContext(tmpDir));

  expect(result.data?.currentHash).toBeNull();
  expect(result.data?.previousHash).toBeNull();
  expect(result.data?.currentGitSha).toBeNull();
  expect(result.data?.deployedAt).toBeNull();
});

test("immutability: modifying an artifact directory causes verify to fail", async () => {
  const hash = await createArtifact(tmpDir, "test", { "pkg/index.js": "original" });

  const verifyBefore = await runDeployArtifactVerify(mockInput({ hash }), mockContext(tmpDir));
  expect(verifyBefore.data?.verified).toBe(true);

  const distDir = distPath(tmpDir, hash);
  await fs.writeFile(path.join(distDir, "pkg/index.js"), "tampered");

  const verifyAfter = await runDeployArtifactVerify(mockInput({ hash }), mockContext(tmpDir));
  expect(verifyAfter.data?.verified).toBe(false);
  expect(verifyAfter.exitCode).toBe(1);
});

test("listArtifactHashes: excludes current and previous symlinks", async () => {
  const base = platformArtifactsBase(tmpDir);
  await fs.mkdir(base, { recursive: true });

  const realDir = path.join(base, "sha256:real");
  await fs.mkdir(realDir, { recursive: true });
  symlinkSync(realDir, path.join(base, "current"));
  symlinkSync(realDir, path.join(base, "previous"));

  const hashes = await listArtifactHashes(tmpDir);
  expect(hashes).toEqual(["sha256:real"]);
});
