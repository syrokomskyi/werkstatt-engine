import { describe, it, expect } from "vitest";
import {
  releaseArtifactStateSchema,
  releaseStateSchema,
  releaseManifestSchema,
  legacyReleaseStateSchema,
  legacyReleaseDiagnosticSchema,
} from "../schemas/release.ts";

describe("releaseArtifactStateSchema (RFC-0851)", () => {
  it("accepts prepared", () => {
    expect(releaseArtifactStateSchema.safeParse("prepared").success).toBe(true);
  });

  it("accepts ready", () => {
    expect(releaseArtifactStateSchema.safeParse("ready").success).toBe(true);
  });

  it("rejects legacy states", () => {
    const legacy = ["published", "dev-deployed", "alt-deployed", "promoted", "main-deployed", "rolled-back"];
    for (const state of legacy) {
      expect(releaseArtifactStateSchema.safeParse(state).success).toBe(false);
    }
  });

  it("releaseStateSchema is an alias for releaseArtifactStateSchema", () => {
    expect(releaseStateSchema).toBe(releaseArtifactStateSchema);
  });
});

describe("releaseManifestSchema (RFC-0851)", () => {
  const validManifest = {
    schemaVersion: "1",
    releaseId: "warpgogol-com-r000001",
    systemId: "warpgogol-com",
    missionId: "warpgogol-com-m000001",
    semver: "5.20.0",
    platformVersion: "5.20.0",
    createdAt: "2026-01-01T00:00:00.000Z",
    readyAt: null,
    state: "prepared",
    commitSha: "abc123",
    platformSemanticHash: "hash",
    siteContentHash: "hash",
    distTreeHash: "hash",
    distArtifactHash: null,
    artifact: null,
    behaviorSnapshotHash: "hash",
    readableSnapshotHash: "hash",
    qualityReportHash: null,
    snapshotDiffVerdict: "pass",
    migratorVerdict: "pass",
    versionCompareVerdict: "in-sync",
  };

  it("accepts a valid prepared manifest", () => {
    expect(releaseManifestSchema.safeParse(validManifest).success).toBe(true);
  });

  it("accepts a valid ready manifest with readyAt", () => {
    const ready = { ...validManifest, state: "ready", readyAt: "2026-01-02T00:00:00.000Z" };
    expect(releaseManifestSchema.safeParse(ready).success).toBe(true);
  });

  it("rejects legacy state 'promoted'", () => {
    const legacy = { ...validManifest, state: "promoted" };
    expect(releaseManifestSchema.safeParse(legacy).success).toBe(false);
  });

  it("rejects legacy state 'alt-deployed'", () => {
    const legacy = { ...validManifest, state: "alt-deployed" };
    expect(releaseManifestSchema.safeParse(legacy).success).toBe(false);
  });

  it("rejects legacy state 'rolled-back'", () => {
    const legacy = { ...validManifest, state: "rolled-back" };
    expect(releaseManifestSchema.safeParse(legacy).success).toBe(false);
  });

  it("rejects manifest with publishedAt (removed field)", () => {
    const withPublishedAt = { ...validManifest, publishedAt: "2026-01-01T00:00:00.000Z" };
    expect(releaseManifestSchema.safeParse(withPublishedAt).success).toBe(false);
  });

  it("rejects manifest with cSurfaceVerdict (removed field)", () => {
    const withCSurface = { ...validManifest, cSurfaceVerdict: "pass" };
    expect(releaseManifestSchema.safeParse(withCSurface).success).toBe(false);
  });
});

describe("legacyReleaseStateSchema", () => {
  it("accepts all legacy states", () => {
    const legacy = ["published", "dev-deployed", "alt-deployed", "promoted", "main-deployed", "rolled-back"];
    for (const state of legacy) {
      expect(legacyReleaseStateSchema.safeParse(state).success).toBe(true);
    }
  });

  it("rejects artifact-only states", () => {
    expect(legacyReleaseStateSchema.safeParse("prepared").success).toBe(false);
    expect(legacyReleaseStateSchema.safeParse("ready").success).toBe(false);
  });
});

describe("legacyReleaseDiagnosticSchema", () => {
  it("accepts a valid legacy diagnostic", () => {
    const diag = {
      schema: "werkstatt/legacy-release-diagnostic@1",
      releaseId: "warpgogol-com-r000001",
      legacyState: "promoted",
      ruleId: "CERT-LEGACY-STATE-01",
      message: "Release uses legacy state 'promoted' which is no longer valid.",
      fixHint: "Migrate to artifact-only states (prepared/ready) per RFC-0851.",
    };
    expect(legacyReleaseDiagnosticSchema.safeParse(diag).success).toBe(true);
  });

  it("rejects diagnostic with wrong ruleId", () => {
    const diag = {
      schema: "werkstatt/legacy-release-diagnostic@1",
      releaseId: "warpgogol-com-r000001",
      legacyState: "promoted",
      ruleId: "OTHER-01",
      message: "test",
      fixHint: "test",
    };
    expect(legacyReleaseDiagnosticSchema.safeParse(diag).success).toBe(false);
  });

  it("rejects diagnostic with wrong schema literal", () => {
    const diag = {
      schema: "werkstatt/other@1",
      releaseId: "warpgogol-com-r000001",
      legacyState: "promoted",
      ruleId: "CERT-LEGACY-STATE-01",
      message: "test",
      fixHint: "test",
    };
    expect(legacyReleaseDiagnosticSchema.safeParse(diag).success).toBe(false);
  });
});
