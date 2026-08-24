/*
<MODULE_CONTRACT>
<purpose>RFC-0585: tests for release.ready distTreeHash guard and dist directory check.</purpose>
<keywords>RFC-0585, release.ready, distTreeHash, dist guard, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0585: add unit tests for release.ready distTreeHash pending guard and missing dist directory guard.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { runReleaseReady } from "../release/release-commands.ts";
import type { KernelRuntimeContext, KernelCommandInput } from "@warpgogol/werkstatt-engine/kernel";
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
    missionId: "test-sys-m000001",
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
  };
  const merged = { ...defaults, ...fields };
  writeFileSync(join(releaseDir, "release.yaml"), stringifyYaml(merged));
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tmp-release-guard-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("release.ready refuses when distTreeHash is sha256:pending", async () => {
  const releaseId = "test-sys-r000001";
  writeReleaseManifest(tmpDir, releaseId, {
    distTreeHash: "sha256:pending",
  });

  await expect(
    runReleaseReady(makeInput({ release: releaseId }), makeContext(tmpDir)),
  ).rejects.toThrow(/distTreeHash is pending or missing/);
});

test("release.ready refuses when distTreeHash is missing", async () => {
  const releaseId = "test-sys-r000002";
  writeReleaseManifest(tmpDir, releaseId, {
    distTreeHash: "",
  });

  await expect(
    runReleaseReady(makeInput({ release: releaseId }), makeContext(tmpDir)),
  ).rejects.toThrow(/distTreeHash is pending or missing/);
});

test("release.ready refuses when dist directory is missing", async () => {
  const releaseId = "test-sys-r000003";
  writeReleaseManifest(tmpDir, releaseId, {});

  await expect(
    runReleaseReady(makeInput({ release: releaseId }), makeContext(tmpDir)),
  ).rejects.toThrow(/no dist\/ directory/);
});

test("release.ready refuses when snapshotDiffVerdict is fail", async () => {
  const releaseId = "test-sys-r000004";
  const releaseDir = join(tmpDir, "releases", releaseId);
  writeReleaseManifest(tmpDir, releaseId, {
    snapshotDiffVerdict: "fail",
  });
  mkdirSync(join(releaseDir, "dist"), { recursive: true });

  await expect(
    runReleaseReady(makeInput({ release: releaseId }), makeContext(tmpDir)),
  ).rejects.toThrow(/snapshot diff verdict is fail/);
});
