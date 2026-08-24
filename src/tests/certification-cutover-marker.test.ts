import { describe, it, expect } from "vitest";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import type { ResolvedComponentSetV1 } from "../component/contracts.ts";
import {
  verifyCutover,
  buildCutoverMarker,
  checkLegacyStateProhibition,
  isBootstrapExceptionClosed,
  isRollbackTargetProtected,
  verifyMarkerIntegrity,
  type CutoverVerificationInputV1,
  type LegacyStateRead,
} from "../certification/cutover/marker.ts";

const D = "sha256:0000000000000000000000000000000000000000000000000000000000000000" as string as Sha256Digest;
const D1 = "sha256:1111111111111111111111111111111111111111111111111111111111111111" as string as Sha256Digest;
const D2 = "sha256:2222222222222222222222222222222222222222222222222222222222222222" as string as Sha256Digest;
const D3 = "sha256:3333333333333333333333333333333333333333333333333333333333333333" as string as Sha256Digest;
const TS = "2026-08-15T12:00:00Z";

function mkComponentSet(): ResolvedComponentSetV1 {
  return {
    schema: "werkstatt/resolved-component-set@1",
    profileId: "astro-typescript-turborepo",
    components: [
      { componentId: "engine/kernel", version: "1.0.0", artifactHash: D },
      { componentId: "site/astro", version: "1.0.0", artifactHash: D1 },
    ],
    dependencyGraphHash: D2,
    grantSetHash: D3,
    effectPolicyHash: D,
    isolationPolicyHash: D1,
    setHash: D2,
  };
}

function mkCutoverInput(
  overrides: Partial<CutoverVerificationInputV1> = {},
): CutoverVerificationInputV1 {
  return {
    candidateId: "cand-001",
    devDecisionId: "dec-dev-001",
    altDecisionId: "dec-alt-001",
    mainVerificationDecisionId: "dec-main-001",
    evaluatorDecisionIds: ["eval-001", "eval-002"],
    dossierRoot: D,
    resolvedComponentSet: mkComponentSet(),
    healthState: "current",
    healthDecisionId: "health-001",
    rollbackCandidateId: "cand-000",
    rollbackArtifactHash: D1,
    continuousHealthWindowCompleted: true,
    legacyStateReads: [],
    ...overrides,
  };
}

describe("verifyCutover", () => {
  it("verifies a complete cutover with all decisions and health", () => {
    const result = verifyCutover(
      mkCutoverInput(),
      "sys-001",
      "rel-001",
      TS,
      "https://example.com",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(true);
      expect(result.marker.schema).toBe("werkstatt/clean-cutover-marker@1");
      expect(result.marker.candidateId).toBe("cand-001");
      expect(result.marker.systemId).toBe("sys-001");
    }
  });

  it("rejects legacy state reads for success", () => {
    const legacyRead: LegacyStateRead = {
      command: "release.prepare",
      artifactPath: "legacy/cert.json",
      artifactType: "release-certification",
      usedForSuccess: true,
    };
    const result = verifyCutover(
      mkCutoverInput({ legacyStateReads: [legacyRead] }),
      "sys-001",
      "rel-001",
      TS,
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CUTOVER-01");
    }
  });

  it("allows legacy state reads not used for success", () => {
    const legacyRead: LegacyStateRead = {
      command: "release.list",
      artifactPath: "legacy/cert.json",
      artifactType: "release-certification",
      usedForSuccess: false,
    };
    const result = verifyCutover(
      mkCutoverInput({ legacyStateReads: [legacyRead] }),
      "sys-001",
      "rel-001",
      TS,
      null,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects missing dev decision", () => {
    const result = verifyCutover(
      mkCutoverInput({ devDecisionId: "" }),
      "sys-001",
      "rel-001",
      TS,
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CUTOVER-02");
    }
  });

  it("rejects missing alt decision", () => {
    const result = verifyCutover(
      mkCutoverInput({ altDecisionId: "" }),
      "sys-001",
      "rel-001",
      TS,
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CUTOVER-03");
    }
  });

  it("rejects missing main verification decision", () => {
    const result = verifyCutover(
      mkCutoverInput({ mainVerificationDecisionId: "" }),
      "sys-001",
      "rel-001",
      TS,
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CUTOVER-04");
    }
  });

  it("rejects missing evaluator decisions", () => {
    const result = verifyCutover(
      mkCutoverInput({ evaluatorDecisionIds: [] }),
      "sys-001",
      "rel-001",
      TS,
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CUTOVER-05");
    }
  });

  it("rejects incomplete continuous health window", () => {
    const result = verifyCutover(
      mkCutoverInput({ continuousHealthWindowCompleted: false }),
      "sys-001",
      "rel-001",
      TS,
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CUTOVER-06");
    }
  });

  it("rejects revoked health state", () => {
    const result = verifyCutover(
      mkCutoverInput({ healthState: "revoked" }),
      "sys-001",
      "rel-001",
      TS,
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CUTOVER-07");
    }
  });

  it("rejects same rollback and cutover candidate", () => {
    const result = verifyCutover(
      mkCutoverInput({ rollbackCandidateId: "cand-001" }),
      "sys-001",
      "rel-001",
      TS,
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CUTOVER-08");
    }
  });

  it("allows degraded health state", () => {
    const result = verifyCutover(
      mkCutoverInput({ healthState: "degraded" }),
      "sys-001",
      "rel-001",
      TS,
      null,
    );
    expect(result.ok).toBe(true);
  });
});

describe("buildCutoverMarker", () => {
  it("builds a marker with correct schema and fields", () => {
    const marker = buildCutoverMarker({
      systemId: "sys-001",
      releaseId: "rel-001",
      candidateId: "cand-001",
      devDecisionId: "dec-dev-001",
      altDecisionId: "dec-alt-001",
      mainVerificationDecisionId: "dec-main-001",
      evaluatorDecisionIds: ["eval-001"],
      dossierRoot: D,
      mainIdentity: {
        candidateId: "cand-001",
        artifactHash: D1,
        deployedAt: TS,
        deploymentUrl: "https://example.com",
      },
      healthState: "current",
      healthDecisionId: "health-001",
      rollbackTarget: {
        candidateId: "cand-000",
        artifactHash: D2,
        protectedReason: "bootstrap",
      },
      bootstrapExceptionClosed: true,
      continuousHealthWindowCompleted: true,
      committedAt: TS,
    });
    expect(marker.schema).toBe("werkstatt/clean-cutover-marker@1");
    expect(marker.markerId).toBe("cutover-sys-001-cand-001");
    expect(marker.systemId).toBe("sys-001");
    expect(marker.candidateId).toBe("cand-001");
    expect(marker.healthState).toBe("current");
    expect(marker.bootstrapExceptionClosed).toBe(true);
    expect(marker.markerHash).toBeTruthy();
  });

  it("produces deterministic marker hash", () => {
    const input = {
      systemId: "sys-001",
      releaseId: "rel-001",
      candidateId: "cand-001",
      devDecisionId: "dec-dev-001",
      altDecisionId: "dec-alt-001",
      mainVerificationDecisionId: "dec-main-001",
      evaluatorDecisionIds: ["eval-001"],
      dossierRoot: D,
      mainIdentity: {
        candidateId: "cand-001",
        artifactHash: D1,
        deployedAt: TS,
        deploymentUrl: null,
      },
      healthState: "current" as const,
      healthDecisionId: null,
      rollbackTarget: {
        candidateId: "cand-000",
        artifactHash: D2,
        protectedReason: "bootstrap" as const,
      },
      bootstrapExceptionClosed: true,
      continuousHealthWindowCompleted: true,
      committedAt: TS,
    };
    const m1 = buildCutoverMarker(input);
    const m2 = buildCutoverMarker(input);
    expect(m1.markerHash).toBe(m2.markerHash);
  });

  it("produces different hash for different input", () => {
    const baseInput = {
      systemId: "sys-001",
      releaseId: "rel-001",
      candidateId: "cand-001",
      devDecisionId: "dec-dev-001",
      altDecisionId: "dec-alt-001",
      mainVerificationDecisionId: "dec-main-001",
      evaluatorDecisionIds: ["eval-001"],
      dossierRoot: D,
      mainIdentity: {
        candidateId: "cand-001",
        artifactHash: D1,
        deployedAt: TS,
        deploymentUrl: null,
      },
      healthState: "current" as const,
      healthDecisionId: null,
      rollbackTarget: {
        candidateId: "cand-000",
        artifactHash: D2,
        protectedReason: "bootstrap" as const,
      },
      bootstrapExceptionClosed: true,
      continuousHealthWindowCompleted: true,
      committedAt: TS,
    };
    const m1 = buildCutoverMarker(baseInput);
    const m2 = buildCutoverMarker({ ...baseInput, candidateId: "cand-002" });
    expect(m1.markerHash).not.toBe(m2.markerHash);
  });
});

describe("checkLegacyStateProhibition", () => {
  it("returns clean when no reads", () => {
    const result = checkLegacyStateProhibition([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clean).toBe(true);
    }
  });

  it("returns clean when reads are not for success", () => {
    const result = checkLegacyStateProhibition([
      {
        command: "release.list",
        artifactPath: "legacy/cert.json",
        artifactType: "release-certification",
        usedForSuccess: false,
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clean).toBe(true);
    }
  });

  it("fails when reads are for success", () => {
    const result = checkLegacyStateProhibition([
      {
        command: "release.prepare",
        artifactPath: "legacy/cert.json",
        artifactType: "release-certification",
        usedForSuccess: true,
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CUTOVER-01");
      expect(result.violations).toHaveLength(1);
    }
  });

  it("fails for grace artifacts used for success", () => {
    const result = checkLegacyStateProhibition([
      {
        command: "leitstand.dev-deploy",
        artifactPath: "legacy/grace.json",
        artifactType: "grace",
        usedForSuccess: true,
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it("fails for mission artifacts used for success", () => {
    const result = checkLegacyStateProhibition([
      {
        command: "release.certify",
        artifactPath: "missions/xyz/workpiece/legacy.json",
        artifactType: "mission-artifact",
        usedForSuccess: true,
      },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("isBootstrapExceptionClosed", () => {
  it("returns true when bootstrap exception is closed", () => {
    const marker = buildCutoverMarker({
      systemId: "sys-001",
      releaseId: "rel-001",
      candidateId: "cand-001",
      devDecisionId: "dec-dev-001",
      altDecisionId: "dec-alt-001",
      mainVerificationDecisionId: "dec-main-001",
      evaluatorDecisionIds: ["eval-001"],
      dossierRoot: D,
      mainIdentity: {
        candidateId: "cand-001",
        artifactHash: D1,
        deployedAt: TS,
        deploymentUrl: null,
      },
      healthState: "current",
      healthDecisionId: null,
      rollbackTarget: {
        candidateId: "cand-000",
        artifactHash: D2,
        protectedReason: "bootstrap",
      },
      bootstrapExceptionClosed: true,
      continuousHealthWindowCompleted: true,
      committedAt: TS,
    });
    expect(isBootstrapExceptionClosed(marker)).toBe(true);
  });

  it("returns false when bootstrap exception is open", () => {
    const marker = buildCutoverMarker({
      systemId: "sys-001",
      releaseId: "rel-001",
      candidateId: "cand-001",
      devDecisionId: "dec-dev-001",
      altDecisionId: "dec-alt-001",
      mainVerificationDecisionId: "dec-main-001",
      evaluatorDecisionIds: ["eval-001"],
      dossierRoot: D,
      mainIdentity: {
        candidateId: "cand-001",
        artifactHash: D1,
        deployedAt: TS,
        deploymentUrl: null,
      },
      healthState: "current",
      healthDecisionId: null,
      rollbackTarget: {
        candidateId: "cand-000",
        artifactHash: D2,
        protectedReason: "bootstrap",
      },
      bootstrapExceptionClosed: false,
      continuousHealthWindowCompleted: true,
      committedAt: TS,
    });
    expect(isBootstrapExceptionClosed(marker)).toBe(false);
  });
});

describe("isRollbackTargetProtected", () => {
  it("protects bootstrap target when exception is open", () => {
    const marker = buildCutoverMarker({
      systemId: "sys-001",
      releaseId: "rel-001",
      candidateId: "cand-001",
      devDecisionId: "dec-dev-001",
      altDecisionId: "dec-alt-001",
      mainVerificationDecisionId: "dec-main-001",
      evaluatorDecisionIds: ["eval-001"],
      dossierRoot: D,
      mainIdentity: {
        candidateId: "cand-001",
        artifactHash: D1,
        deployedAt: TS,
        deploymentUrl: null,
      },
      healthState: "current",
      healthDecisionId: null,
      rollbackTarget: {
        candidateId: "cand-000",
        artifactHash: D2,
        protectedReason: "bootstrap",
      },
      bootstrapExceptionClosed: false,
      continuousHealthWindowCompleted: true,
      committedAt: TS,
    });
    expect(isRollbackTargetProtected(marker)).toBe(true);
  });

  it("does not protect bootstrap target when exception is closed", () => {
    const marker = buildCutoverMarker({
      systemId: "sys-001",
      releaseId: "rel-001",
      candidateId: "cand-001",
      devDecisionId: "dec-dev-001",
      altDecisionId: "dec-alt-001",
      mainVerificationDecisionId: "dec-main-001",
      evaluatorDecisionIds: ["eval-001"],
      dossierRoot: D,
      mainIdentity: {
        candidateId: "cand-001",
        artifactHash: D1,
        deployedAt: TS,
        deploymentUrl: null,
      },
      healthState: "current",
      healthDecisionId: null,
      rollbackTarget: {
        candidateId: "cand-000",
        artifactHash: D2,
        protectedReason: "bootstrap",
      },
      bootstrapExceptionClosed: true,
      continuousHealthWindowCompleted: true,
      committedAt: TS,
    });
    expect(isRollbackTargetProtected(marker)).toBe(false);
  });

  it("always protects prior-certified rollback target", () => {
    const marker = buildCutoverMarker({
      systemId: "sys-001",
      releaseId: "rel-001",
      candidateId: "cand-001",
      devDecisionId: "dec-dev-001",
      altDecisionId: "dec-alt-001",
      mainVerificationDecisionId: "dec-main-001",
      evaluatorDecisionIds: ["eval-001"],
      dossierRoot: D,
      mainIdentity: {
        candidateId: "cand-001",
        artifactHash: D1,
        deployedAt: TS,
        deploymentUrl: null,
      },
      healthState: "current",
      healthDecisionId: null,
      rollbackTarget: {
        candidateId: "cand-000",
        artifactHash: D2,
        protectedReason: "prior-certified",
      },
      bootstrapExceptionClosed: true,
      continuousHealthWindowCompleted: true,
      committedAt: TS,
    });
    expect(isRollbackTargetProtected(marker)).toBe(true);
  });
});

describe("verifyMarkerIntegrity", () => {
  it("verifies a valid marker", () => {
    const marker = buildCutoverMarker({
      systemId: "sys-001",
      releaseId: "rel-001",
      candidateId: "cand-001",
      devDecisionId: "dec-dev-001",
      altDecisionId: "dec-alt-001",
      mainVerificationDecisionId: "dec-main-001",
      evaluatorDecisionIds: ["eval-001"],
      dossierRoot: D,
      mainIdentity: {
        candidateId: "cand-001",
        artifactHash: D1,
        deployedAt: TS,
        deploymentUrl: null,
      },
      healthState: "current",
      healthDecisionId: null,
      rollbackTarget: {
        candidateId: "cand-000",
        artifactHash: D2,
        protectedReason: "bootstrap",
      },
      bootstrapExceptionClosed: true,
      continuousHealthWindowCompleted: true,
      committedAt: TS,
    });
    expect(verifyMarkerIntegrity(marker)).toBe(true);
  });

  it("rejects a tampered marker", () => {
    const marker = buildCutoverMarker({
      systemId: "sys-001",
      releaseId: "rel-001",
      candidateId: "cand-001",
      devDecisionId: "dec-dev-001",
      altDecisionId: "dec-alt-001",
      mainVerificationDecisionId: "dec-main-001",
      evaluatorDecisionIds: ["eval-001"],
      dossierRoot: D,
      mainIdentity: {
        candidateId: "cand-001",
        artifactHash: D1,
        deployedAt: TS,
        deploymentUrl: null,
      },
      healthState: "current",
      healthDecisionId: null,
      rollbackTarget: {
        candidateId: "cand-000",
        artifactHash: D2,
        protectedReason: "bootstrap",
      },
      bootstrapExceptionClosed: true,
      continuousHealthWindowCompleted: true,
      committedAt: TS,
    });
    const tampered = { ...marker, candidateId: "cand-tampered" };
    expect(verifyMarkerIntegrity(tampered)).toBe(false);
  });
});
