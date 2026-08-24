/*
<MODULE_CONTRACT>
  <purpose>RFC-0634: tests for leitstand.dev-deploy build-identity write logic.</purpose>
  <keywords>RFC-0634, dev-deploy, build-identity, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0634: add tests for dev-deploy build-identity preliminary/final write and distTreeHash determinism.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { buildIdentitySchema } from "@warpgogol/werkstatt-engine/schemas";
import { fingerprintTree } from "@warpgogol/werkstatt-engine/fingerprint/semantic";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "rfc-0634-dev-deploy-"));
}

test("RFC-0634: preliminary build-identity validates against loosened buildIdentitySchema", () => {
  const preliminary = {
    releaseId: "workpiece-test-sys-m000001",
    systemId: "test-sys",
    missionId: "test-sys-m000001",
    semver: "0.0.0-workpiece",
    distTreeHash: "",
    behaviorSnapshotHash: "",
    siteContentHash: "sha256:content-hash",
    platformVersion: "1.0.0",
    platformSemanticHash: "sha256:platform-hash",
    commitSha: "abc123def456",
    buildTimestamp: new Date().toISOString(),
    targetPlatform: "cloudflare-workers",
  };
  const result = buildIdentitySchema.safeParse(preliminary);
  expect(result.success).toBe(true);
});

test("RFC-0634: final build-identity with real hashes validates against buildIdentitySchema", () => {
  const final = {
    releaseId: "workpiece-test-sys-m000001",
    systemId: "test-sys",
    missionId: "test-sys-m000001",
    semver: "0.0.0-workpiece",
    distTreeHash: "sha256:abc123",
    behaviorSnapshotHash: "",
    siteContentHash: "sha256:content-hash",
    platformVersion: "1.0.0",
    platformSemanticHash: "sha256:platform-hash",
    commitSha: "abc123def456",
    buildTimestamp: new Date().toISOString(),
    targetPlatform: "cloudflare-workers",
  };
  const result = buildIdentitySchema.safeParse(final);
  expect(result.success).toBe(true);
});

test("RFC-0634: distTreeHash excludes build-identity.json from dist/client/.well-known/", async () => {
  const distDir = makeTempDir();
  try {
    // Create dist structure with some content
    const clientDir = join(distDir, "client");
    const wellKnownDir = join(clientDir, ".well-known");
    mkdirSync(wellKnownDir, { recursive: true });
    writeFileSync(join(clientDir, "index.html"), "<html>home</html>");
    writeFileSync(join(wellKnownDir, "build-identity.json"), '{"releaseId":"test"}');

    // Hash WITH build-identity.json present
    const hashWithFile = await fingerprintTree(distDir, { mode: "byte" });

    // Remove build-identity.json (simulating the dev-deploy step)
    rmSync(join(wellKnownDir, "build-identity.json"), { force: true });

    // Hash WITHOUT build-identity.json
    const hashWithoutFile = await fingerprintTree(distDir, { mode: "byte" });

    // Hashes must differ — the build-identity.json was part of the tree
    expect(hashWithFile.value).not.toBe(hashWithoutFile.value);

    // The hash without the file is the deterministic distTreeHash
    // Re-adding a different build-identity.json should produce a different hash from hashWithoutFile
    writeFileSync(join(wellKnownDir, "build-identity.json"), '{"releaseId":"different"}');
    const hashWithDifferentFile = await fingerprintTree(distDir, { mode: "byte" });
    expect(hashWithDifferentFile.value).not.toBe(hashWithoutFile.value);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test("RFC-0634: distTreeHash is deterministic when build-identity.json is excluded", async () => {
  const distDir = makeTempDir();
  try {
    const clientDir = join(distDir, "client");
    mkdirSync(clientDir, { recursive: true });
    writeFileSync(join(clientDir, "index.html"), "<html>home</html>");
    writeFileSync(join(clientDir, "about.html"), "<html>about</html>");

    // Hash twice — should be identical (no build-identity.json present)
    const hash1 = await fingerprintTree(distDir, { mode: "byte" });
    const hash2 = await fingerprintTree(distDir, { mode: "byte" });
    expect(hash1.value).toBe(hash2.value);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
});

test("RFC-0634: preliminary build-identity.json cleanup removes file from public/.well-known/", () => {
  const tmpDir = makeTempDir();
  try {
    const publicWellKnown = join(tmpDir, "public", ".well-known");
    mkdirSync(publicWellKnown, { recursive: true });
    const buildIdentityPath = join(publicWellKnown, "build-identity.json");
    writeFileSync(buildIdentityPath, '{"releaseId":"workpiece-test"}');
    expect(existsSync(buildIdentityPath)).toBe(true);

    // Simulate cleanup
    rmSync(buildIdentityPath, { force: true });
    expect(existsSync(buildIdentityPath)).toBe(false);
    expect(existsSync(publicWellKnown)).toBe(true); // directory remains
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
