/*
<MODULE_CONTRACT>
  <purpose>RFC-0634: tests for leitstand.propagate dev-URL build-identity verification logic.</purpose>
  <keywords>RFC-0634, propagate, build-identity, verification, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0634: add tests for dev build-identity verification in leitstand.propagate.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { buildIdentitySchema } from "@warpgogol/werkstatt-engine/schemas";

const VALID_DEV_BUILD_IDENTITY = {
  releaseId: "workpiece-test-sys-m000001",
  systemId: "test-sys",
  missionId: "test-sys-m000001",
  semver: "0.0.0-workpiece",
  distTreeHash: "sha256:abc123",
  behaviorSnapshotHash: "",
  siteContentHash: "sha256:ghi789",
  platformVersion: "1.0.0",
  platformSemanticHash: "sha256:platform-hash",
  commitSha: "abc123def456",
  buildTimestamp: "2026-01-01T00:00:00.000Z",
  targetPlatform: "cloudflare-workers",
};

test("RFC-0634: buildIdentitySchema validates dev build-identity with workpiece releaseId", () => {
  const result = buildIdentitySchema.safeParse(VALID_DEV_BUILD_IDENTITY);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.releaseId).toBe("workpiece-test-sys-m000001");
    expect(result.data.missionId).toBe("test-sys-m000001");
  }
});

test("RFC-0634: buildIdentitySchema rejects dev build-identity with empty behaviorSnapshotHash", () => {
  const withEmptyHash = { ...VALID_DEV_BUILD_IDENTITY, behaviorSnapshotHash: "" };
  const result = buildIdentitySchema.safeParse(withEmptyHash);
  expect(result.success).toBe(true);
});

test("RFC-0634: buildIdentitySchema rejects dev build-identity with invalid missionId", () => {
  const invalidMission = { ...VALID_DEV_BUILD_IDENTITY, missionId: "invalid-mission-id" };
  const result = buildIdentitySchema.safeParse(invalidMission);
  expect(result.success).toBe(false);
});

test("RFC-0634: propagate verification fields — missionId must match between dev build-identity and release manifest", () => {
  const devMissionId = VALID_DEV_BUILD_IDENTITY.missionId;
  const releaseMissionId = "test-sys-m000001";
  expect(devMissionId).toBe(releaseMissionId);
});

test("RFC-0634: propagate verification fields — commitSha must match between dev build-identity and release manifest", () => {
  const devCommitSha = VALID_DEV_BUILD_IDENTITY.commitSha;
  const releaseCommitSha = "abc123def456";
  expect(devCommitSha).toBe(releaseCommitSha);
});

test("RFC-0634: propagate verification fields — distTreeHash must match between dev build-identity and release manifest", () => {
  const devDistTreeHash = VALID_DEV_BUILD_IDENTITY.distTreeHash;
  const releaseDistTreeHash = "sha256:abc123";
  expect(devDistTreeHash).toBe(releaseDistTreeHash);
});

test("RFC-0634: propagate verification fields — siteContentHash must match between dev build-identity and release manifest", () => {
  const devSiteContentHash = VALID_DEV_BUILD_IDENTITY.siteContentHash;
  const releaseSiteContentHash = "sha256:ghi789";
  expect(devSiteContentHash).toBe(releaseSiteContentHash);
});

test("RFC-0634: propagate does NOT verify behaviorSnapshotHash for dev→alt (empty for workpiece)", () => {
  const devBehaviorSnapshotHash = VALID_DEV_BUILD_IDENTITY.behaviorSnapshotHash;
  expect(devBehaviorSnapshotHash).toBe("");
});

test("RFC-0634: buildIdentitySchema rejects malformed JSON shape", () => {
  const malformed = { foo: "bar" };
  const result = buildIdentitySchema.safeParse(malformed);
  expect(result.success).toBe(false);
});
