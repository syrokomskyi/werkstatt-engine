/*
<MODULE_CONTRACT>
<purpose>RFC-0596: tests for storeArtifactCore extraction, automatic artifact storage in release.ready, and release.validate artifact check.</purpose>
<keywords>RFC-0596, storeArtifactCore, release.ready, artifact storage, release.validate, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0596: add unit tests for storeArtifactCore (lock-free, idempotent, systemId), release.ready artifact-before-transition, and release.validate ready-artifact check.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { storeArtifactCore } from "../artifact-store/artifact-store-commands.ts";
import { runReleaseReady, runReleaseValidate } from "../release/release-commands.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";
import { expectData } from "./helpers/kernel-result-helpers.ts";
import { tmpdir } from "node:os";

function makeContext(workspaceRoot: string): KernelRuntimeContext {
  return {
    workspaceRoot,
    logger: {
      info: () => {},
      success: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    flags: {},
    env: {},
  } as unknown as KernelRuntimeContext;
}

function makeInput(flags: Record<string, string>): KernelCommandInput {
  return { flags, argv: [] };
}

function writeReleaseManifest(
  workspaceRoot: string,
  releaseId: string,
  fields: Record<string, unknown>,
): void {
  const releaseDir = join(workspaceRoot, "releases", releaseId);
  mkdirSync(releaseDir, { recursive: true });
  const defaults: Record<string, unknown> = {
    schemaVersion: "1.0.0",
    releaseId,
    systemId: "test-sys",
    missionId: "test-mission-m000001",
    semver: "0.1.0",
    platformVersion: "1.0.0",
    createdAt: "2026-01-01T00:00:00.000Z",
    readyAt: null,
    state: "prepared",
    commitSha: "0000000",
    platformSemanticHash: "sha256:semantic",
    siteContentHash: "sha256:content",
    distTreeHash: "sha256:abc123def456",
    distArtifactHash: null,
    artifact: null,
    behaviorSnapshotHash: "sha256:behavior",
    readableSnapshotHash: "sha256:readable",
    qualityReportHash: null,
    snapshotDiffVerdict: "pass",
    migratorVerdict: "pass",
    versionCompareVerdict: "in-sync",
    bootSmokeVerdict: "pass",
  };
  const merged = { ...defaults, ...fields };
  writeFileSync(join(releaseDir, "release.yaml"), stringifyYaml(merged));
}

function readReleaseManifestFile(
  workspaceRoot: string,
  releaseId: string,
): Record<string, unknown> {
  const content = readFileSync(join(workspaceRoot, "releases", releaseId, "release.yaml"), "utf8");
  return parseYaml(content) as Record<string, unknown>;
}

function createDistDir(workspaceRoot: string, releaseId: string): string {
  const distDir = join(workspaceRoot, "releases", releaseId, "dist");
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, "index.html"), "<html><body>Hello</body></html>");
  return distDir;
}

function createRegistry(workspaceRoot: string, systemId: string, cachePath: string): void {
  const registryDir = join(workspaceRoot, "systems");
  mkdirSync(registryDir, { recursive: true });
  const registryContent = `schemaVersion: "1.0.0"
systems:
  - id: ${systemId}
    cosmicStar: Acamar
    mirrors:
      - path: ${cachePath}
        storageType: non-bare
    pinnedPlatform: 1.0.0
    currentMission: null
    lastRelease: null
    status: active
    registeredAt: 2026-01-01T00:00:00.000Z
    notes: ""
`;
  writeFileSync(join(registryDir, "registry.yaml"), registryContent);
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-release-0596-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// --- storeArtifactCore tests ---

test("storeArtifactCore stores artifact manifest and returns correct fields", async () => {
  const releaseId = "test-sys-r000001";
  const distDir = join(tmpDir, "releases", releaseId, "dist");
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, "index.html"), "<html></html>");

  const result = await storeArtifactCore(tmpDir, releaseId, distDir, "test-sys");

  expect(result.distArtifactHash).toMatch(/^sha256:/);
  expect(result.uri).toMatch(/^local:\/\//);
  expect(result.distTreeHash).toMatch(/^sha256:/);
  expect(result.byteSize).toBeGreaterThan(0);
  expect(result.fileCount).toBe(1);
  expect(result.createdAt).toBeTruthy();

  // Verify manifest file exists on disk
  const manifestUri = result.uri.replace("local://", "");
  expect(existsSync(manifestUri)).toBe(true);
  const manifest = JSON.parse(readFileSync(manifestUri, "utf8"));
  expect(manifest.releaseId).toBe(releaseId);
  expect(manifest.systemId).toBe("test-sys");
  expect(manifest.distArtifactHash).toBe(result.distArtifactHash);
});

test("storeArtifactCore does not create lock files", async () => {
  const releaseId = "test-sys-r000002";
  const distDir = join(tmpDir, "releases", releaseId, "dist");
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, "index.html"), "<html></html>");

  await storeArtifactCore(tmpDir, releaseId, distDir, "test-sys");

  // Check no lock files were created
  const lockDir = join(tmpDir, ".werkstatt", "locks");
  if (existsSync(lockDir)) {
    const lockFiles = readdirSync(lockDir);
    expect(lockFiles).toHaveLength(0);
  }
});

test("storeArtifactCore uses provided systemId, not releaseId.split", async () => {
  const releaseId = "my-system-r000003";
  const distDir = join(tmpDir, "releases", releaseId, "dist");
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, "index.html"), "<html></html>");

  // Pass a systemId that differs from what releaseId.split("-r")[0] would produce
  const result = await storeArtifactCore(tmpDir, releaseId, distDir, "custom-sys-id");

  const manifestUri = result.uri.replace("local://", "");
  const manifest = JSON.parse(readFileSync(manifestUri, "utf8"));
  expect(manifest.systemId).toBe("custom-sys-id");
  expect(manifest.systemId).not.toBe("my-system");
});

test("storeArtifactCore is idempotent — re-running overwrites manifest", async () => {
  const releaseId = "test-sys-r000004";
  const distDir = join(tmpDir, "releases", releaseId, "dist");
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, "index.html"), "<html>v1</html>");

  const result1 = await storeArtifactCore(tmpDir, releaseId, distDir, "test-sys");

  // Run again with same content — should overwrite, not duplicate
  const result2 = await storeArtifactCore(tmpDir, releaseId, distDir, "test-sys");

  expect(result2.distArtifactHash).toBe(result1.distArtifactHash);
  expect(result2.uri).toBe(result1.uri);
});

// --- release.ready tests ---

test("release.ready stores artifact before state transition", async () => {
  const releaseId = "test-sys-r000010";
  const systemId = "test-sys";
  const cachePath = join(tmpDir, "cache", systemId);
  mkdirSync(cachePath, { recursive: true });

  createRegistry(tmpDir, systemId, cachePath);
  createDistDir(tmpDir, releaseId);

  writeReleaseManifest(tmpDir, releaseId, {
    releaseId,
    systemId,
    state: "prepared",
    distTreeHash: "sha256:abc123def456",
  });

  const result = await runReleaseReady(makeInput({ release: releaseId }), makeContext(tmpDir));

  expect(expectData(result).state).toBe("ready");
  expect(expectData(result).artifactUri).not.toBeNull();
  expect(expectData(result).distArtifactHash).not.toBeNull();
  expect(expectData(result).distArtifactHash).toMatch(/^sha256:/);

  // Verify release.yaml has artifact and distArtifactHash set AND state: ready
  const manifest = readReleaseManifestFile(tmpDir, releaseId);
  expect(manifest.state).toBe("ready");
  expect(manifest.artifact).not.toBeNull();
  expect(manifest.distArtifactHash).not.toBeNull();
  const artifact = manifest.artifact as Record<string, unknown>;
  expect(artifact.uri).toMatch(/^local:\/\//);
});

test("release.ready output includes distArtifactHash field", async () => {
  const releaseId = "test-sys-r000011";
  const systemId = "test-sys";
  const cachePath = join(tmpDir, "cache", systemId);
  mkdirSync(cachePath, { recursive: true });

  createRegistry(tmpDir, systemId, cachePath);
  createDistDir(tmpDir, releaseId);

  writeReleaseManifest(tmpDir, releaseId, {
    releaseId,
    systemId,
    state: "prepared",
    distTreeHash: "sha256:abc123def456",
  });

  const result = await runReleaseReady(makeInput({ release: releaseId }), makeContext(tmpDir));

  expect(result.data).toHaveProperty("distArtifactHash");
  expect(expectData(result).distArtifactHash).not.toBeNull();
  expect(expectData(result).distArtifactHash).toMatch(/^sha256:/);
});

test("release.ready fails on missing dist — state remains prepared", async () => {
  const releaseId = "test-sys-r000012";
  const systemId = "test-sys";

  writeReleaseManifest(tmpDir, releaseId, {
    releaseId,
    systemId,
    state: "prepared",
    distTreeHash: "sha256:abc123def456",
  });

  await expect(
    runReleaseReady(makeInput({ release: releaseId }), makeContext(tmpDir)),
  ).rejects.toThrow(/no dist\/ directory/);

  // Verify state remains prepared
  const manifest = readReleaseManifestFile(tmpDir, releaseId);
  expect(manifest.state).toBe("prepared");
});

// --- release.validate tests ---

test("release.validate flags ready release without artifact", async () => {
  const releaseId = "test-sys-r000020";

  writeReleaseManifest(tmpDir, releaseId, {
    releaseId,
    systemId: "test-sys",
    state: "ready",
    artifact: null,
  });

  const result = await runReleaseValidate(makeInput({ release: releaseId }), makeContext(tmpDir));

  expect(expectData(result).state).toBe("ready");
  expect(expectData(result).artifactPresent).toBe(false);
});

test("release.validate passes ready release with artifact", async () => {
  const releaseId = "test-sys-r000021";

  writeReleaseManifest(tmpDir, releaseId, {
    releaseId,
    systemId: "test-sys",
    state: "ready",
    artifact: {
      uri: "local:///some/path/manifest.json",
      provider: "local",
      distArtifactHash: "sha256:abc",
      distTreeHash: "sha256:def",
      siteContentHash: "sha256:ghi",
      byteSize: 100,
      fileCount: 1,
    },
  });

  const result = await runReleaseValidate(makeInput({ release: releaseId }), makeContext(tmpDir));

  expect(expectData(result).state).toBe("ready");
  expect(expectData(result).artifactPresent).toBe(true);
});
