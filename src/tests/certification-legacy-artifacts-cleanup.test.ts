import { describe, it, expect } from "vitest";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import type { CleanCutoverMarkerV1 } from "../certification/cutover/marker.ts";
import {
  verifyCleanupPrerequisites,
  buildInventory,
  buildPlan,
  validatePlan,
  buildTombstone,
  buildReport,
  isSafeNoOp,
  verifyReportIntegrity,
  checkPathSafety,
  type CleanupPrerequisitesV1,
  type LegacyArtifactEntryV1,
  type ProtectedArtifactEntryV1,
  type PathSafetyCheckV1,
} from "../certification/cleanup/legacy-artifacts.ts";

const D = "sha256:0000000000000000000000000000000000000000000000000000000000000000" as string as Sha256Digest;
const D1 = "sha256:1111111111111111111111111111111111111111111111111111111111111111" as string as Sha256Digest;
const D2 = "sha256:2222222222222222222222222222222222222222222222222222222222222222" as string as Sha256Digest;
const D3 = "sha256:3333333333333333333333333333333333333333333333333333333333333333" as string as Sha256Digest;
const TS = "2026-08-15T12:00:00Z";

function mkCutoverMarker(
  overrides: Partial<CleanCutoverMarkerV1> = {},
): CleanCutoverMarkerV1 {
  return {
    schema: "werkstatt/clean-cutover-marker@1",
    markerId: "cutover-sys-001-cand-001",
    systemId: "sys-001",
    candidateId: "cand-001",
    releaseId: "rel-001",
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
    markerHash: D3,
    committedAt: TS,
    ...overrides,
  };
}

function mkPrereqs(
  overrides: Partial<CleanupPrerequisitesV1> = {},
): CleanupPrerequisitesV1 {
  return {
    cutoverMarker: mkCutoverMarker(),
    mainCertifiedCandidateId: "cand-001",
    durableDossierVerified: true,
    mirrorsVerified: true,
    rollbackReferencesVerified: true,
    ...overrides,
  };
}

function mkLegacyArtifact(
  overrides: Partial<LegacyArtifactEntryV1> = {},
): LegacyArtifactEntryV1 {
  return {
    path: "legacy/workpiece-1",
    category: "superseded-workpiece",
    sizeBytes: 1024,
    digest: D,
    allowedForDeletion: true,
    ...overrides,
  };
}

function mkProtectedArtifact(
  overrides: Partial<ProtectedArtifactEntryV1> = {},
): ProtectedArtifactEntryV1 {
  return {
    path: "git/repo",
    category: "git-repository",
    sizeBytes: 512,
    reason: "git history preserved",
    ...overrides,
  };
}

describe("verifyCleanupPrerequisites", () => {
  it("verifies all prerequisites met", () => {
    const result = verifyCleanupPrerequisites(mkPrereqs());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(true);
    }
  });

  it("rejects missing cutover marker", () => {
    const result = verifyCleanupPrerequisites(
      mkPrereqs({ cutoverMarker: null as unknown as CleanCutoverMarkerV1 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CLEANUP-01");
    }
  });

  it("rejects open bootstrap exception", () => {
    const result = verifyCleanupPrerequisites(
      mkPrereqs({
        cutoverMarker: mkCutoverMarker({ bootstrapExceptionClosed: false }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CLEANUP-02");
    }
  });

  it("rejects missing main-certified candidate", () => {
    const result = verifyCleanupPrerequisites(
      mkPrereqs({ mainCertifiedCandidateId: "" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CLEANUP-03");
    }
  });

  it("rejects candidate mismatch", () => {
    const result = verifyCleanupPrerequisites(
      mkPrereqs({ mainCertifiedCandidateId: "cand-different" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CLEANUP-04");
    }
  });

  it("rejects unverified durable dossier", () => {
    const result = verifyCleanupPrerequisites(
      mkPrereqs({ durableDossierVerified: false }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CLEANUP-05");
    }
  });

  it("rejects unverified mirrors", () => {
    const result = verifyCleanupPrerequisites(
      mkPrereqs({ mirrorsVerified: false }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CLEANUP-06");
    }
  });

  it("rejects unverified rollback references", () => {
    const result = verifyCleanupPrerequisites(
      mkPrereqs({ rollbackReferencesVerified: false }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CLEANUP-07");
    }
  });
});

describe("buildInventory", () => {
  it("builds inventory with correct schema and totals", () => {
    const legacy = [
      mkLegacyArtifact({ path: "a", sizeBytes: 100 }),
      mkLegacyArtifact({ path: "b", sizeBytes: 200, digest: D1 }),
    ];
    const protected_ = [
      mkProtectedArtifact({ path: "c", sizeBytes: 50 }),
    ];
    const inv = buildInventory(
      "sys-001",
      mkCutoverMarker(),
      legacy,
      protected_,
      TS,
    );
    expect(inv.schema).toBe("werkstatt/legacy-cleanup-inventory@1");
    expect(inv.legacyArtifacts).toHaveLength(2);
    expect(inv.protectedArtifacts).toHaveLength(1);
    expect(inv.totalLegacyBytes).toBe(300);
    expect(inv.totalProtectedBytes).toBe(50);
    expect(inv.inventoryHash).toBeTruthy();
  });

  it("produces deterministic inventory hash", () => {
    const legacy = [mkLegacyArtifact()];
    const protected_ = [mkProtectedArtifact()];
    const i1 = buildInventory("sys-001", mkCutoverMarker(), legacy, protected_, TS);
    const i2 = buildInventory("sys-001", mkCutoverMarker(), legacy, protected_, TS);
    expect(i1.inventoryHash).toBe(i2.inventoryHash);
  });

  it("produces different hash for different artifacts", () => {
    const i1 = buildInventory("sys-001", mkCutoverMarker(), [mkLegacyArtifact()], [], TS);
    const i2 = buildInventory("sys-001", mkCutoverMarker(), [mkLegacyArtifact({ path: "different" })], [], TS);
    expect(i1.inventoryHash).not.toBe(i2.inventoryHash);
  });
});

describe("buildPlan", () => {
  it("builds plan with only allowed-for-deletion paths", () => {
    const legacy = [
      mkLegacyArtifact({ path: "delete-me", allowedForDeletion: true }),
      mkLegacyArtifact({ path: "keep-me", allowedForDeletion: false }),
    ];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, [], TS);
    const plan = buildPlan(inv, TS);
    expect(plan.schema).toBe("werkstatt/legacy-cleanup-plan@1");
    expect(plan.pathsToDelete).toEqual(["delete-me"]);
    expect(plan.pathsToProtect).toEqual([]);
    expect(plan.totalBytesToFree).toBe(1024);
    expect(plan.planHash).toBeTruthy();
  });

  it("includes protected paths in plan", () => {
    const legacy = [mkLegacyArtifact({ path: "delete-me" })];
    const protected_ = [mkProtectedArtifact({ path: "protect-me" })];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, protected_, TS);
    const plan = buildPlan(inv, TS);
    expect(plan.pathsToProtect).toEqual(["protect-me"]);
  });

  it("produces deterministic plan hash", () => {
    const inv = buildInventory("sys-001", mkCutoverMarker(), [mkLegacyArtifact()], [], TS);
    const p1 = buildPlan(inv, TS);
    const p2 = buildPlan(inv, TS);
    expect(p1.planHash).toBe(p2.planHash);
  });
});

describe("validatePlan", () => {
  it("validates a correct plan", () => {
    const legacy = [mkLegacyArtifact({ path: "a" })];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, [], TS);
    const plan = buildPlan(inv, TS);
    const result = validatePlan({
      plan,
      expectedPlanHash: plan.planHash,
      currentInventory: inv,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valid).toBe(true);
    }
  });

  it("rejects plan hash drift", () => {
    const legacy = [mkLegacyArtifact({ path: "a" })];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, [], TS);
    const plan = buildPlan(inv, TS);
    const result = validatePlan({
      plan,
      expectedPlanHash: D as string as Sha256Digest,
      currentInventory: inv,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CLEANUP-08");
    }
  });

  it("rejects inventory hash drift", () => {
    const legacy = [mkLegacyArtifact({ path: "a" })];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, [], TS);
    const plan = buildPlan(inv, TS);
    const staleInv = buildInventory("sys-001", mkCutoverMarker(), [mkLegacyArtifact({ path: "b" })], [], TS);
    const result = validatePlan({
      plan,
      expectedPlanHash: plan.planHash,
      currentInventory: staleInv,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CLEANUP-09");
    }
  });

  it("rejects unknown path in deletion plan", () => {
    const legacy = [mkLegacyArtifact({ path: "a" })];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, [], TS);
    const plan = buildPlan(inv, TS);
    const tamperedPlan = { ...plan, pathsToDelete: ["a", "unknown-path"] };
    const result = validatePlan({
      plan: tamperedPlan,
      expectedPlanHash: tamperedPlan.planHash,
      currentInventory: inv,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CLEANUP-10");
    }
  });

  it("rejects protected path in deletion plan", () => {
    const legacy = [
      mkLegacyArtifact({ path: "a", allowedForDeletion: true }),
      mkLegacyArtifact({ path: "b", allowedForDeletion: false }),
    ];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, [], TS);
    const plan = buildPlan(inv, TS);
    const tamperedPlan = { ...plan, pathsToDelete: ["a", "b"] };
    const result = validatePlan({
      plan: tamperedPlan,
      expectedPlanHash: tamperedPlan.planHash,
      currentInventory: inv,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-CLEANUP-11");
    }
  });
});

describe("buildTombstone", () => {
  it("builds a tombstone for a deleted artifact", () => {
    const entry = mkLegacyArtifact();
    const tomb = buildTombstone(entry, TS, "superseded by cutover");
    expect(tomb.schema).toBe("werkstatt/legacy-cleanup-tombstone@1");
    expect(tomb.path).toBe(entry.path);
    expect(tomb.digest).toBe(entry.digest);
    expect(tomb.sizeBytes).toBe(entry.sizeBytes);
    expect(tomb.reason).toBe("superseded by cutover");
  });
});

describe("buildReport", () => {
  it("builds a report with freed bytes", () => {
    const legacy = [mkLegacyArtifact({ sizeBytes: 1024 })];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, [], TS);
    const plan = buildPlan(inv, TS);
    const tomb = buildTombstone(legacy[0]!, TS, "superseded");
    const report = buildReport("sys-001", plan, "apply", [tomb], 0, true, true, TS);
    expect(report.schema).toBe("werkstatt/legacy-cleanup-report@1");
    expect(report.freedBytes).toBe(1024);
    expect(report.tombstones).toHaveLength(1);
    expect(report.mirrorsVerified).toBe(true);
    expect(report.recoveryPossible).toBe(true);
  });

  it("builds a dry-run report with zero freed bytes", () => {
    const legacy = [mkLegacyArtifact()];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, [], TS);
    const plan = buildPlan(inv, TS);
    const report = buildReport("sys-001", plan, "dry-run", [], 1, true, true, TS);
    expect(report.mode).toBe("dry-run");
    expect(report.freedBytes).toBe(0);
    expect(report.tombstones).toHaveLength(0);
  });
});

describe("isSafeNoOp", () => {
  it("returns true for apply with no deletions", () => {
    const legacy = [mkLegacyArtifact({ allowedForDeletion: false })];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, [], TS);
    const plan = buildPlan(inv, TS);
    const report = buildReport("sys-001", plan, "apply", [], 0, true, true, TS);
    expect(isSafeNoOp(report)).toBe(true);
  });

  it("returns false for apply with deletions", () => {
    const legacy = [mkLegacyArtifact()];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, [], TS);
    const plan = buildPlan(inv, TS);
    const tomb = buildTombstone(legacy[0]!, TS, "superseded");
    const report = buildReport("sys-001", plan, "apply", [tomb], 0, true, true, TS);
    expect(isSafeNoOp(report)).toBe(false);
  });

  it("returns false for dry-run", () => {
    const legacy = [mkLegacyArtifact()];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, [], TS);
    const plan = buildPlan(inv, TS);
    const report = buildReport("sys-001", plan, "dry-run", [], 0, true, true, TS);
    expect(isSafeNoOp(report)).toBe(false);
  });
});

describe("verifyReportIntegrity", () => {
  it("verifies freed bytes match tombstone sum", () => {
    const legacy = [
      mkLegacyArtifact({ sizeBytes: 100, digest: D }),
      mkLegacyArtifact({ sizeBytes: 200, digest: D1 }),
    ];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, [], TS);
    const plan = buildPlan(inv, TS);
    const tombs = [
      buildTombstone(legacy[0]!, TS, "r"),
      buildTombstone(legacy[1]!, TS, "r"),
    ];
    const report = buildReport("sys-001", plan, "apply", tombs, 0, true, true, TS);
    expect(verifyReportIntegrity(report)).toBe(true);
  });

  it("rejects mismatched freed bytes", () => {
    const legacy = [mkLegacyArtifact({ sizeBytes: 100 })];
    const inv = buildInventory("sys-001", mkCutoverMarker(), legacy, [], TS);
    const plan = buildPlan(inv, TS);
    const tomb = buildTombstone(legacy[0]!, TS, "r");
    const report = buildReport("sys-001", plan, "apply", [tomb], 0, true, true, TS);
    const tampered = { ...report, freedBytes: 999 };
    expect(verifyReportIntegrity(tampered)).toBe(false);
  });
});

describe("checkPathSafety", () => {
  it("allows regular path within allowed root", () => {
    const check: PathSafetyCheckV1 = {
      path: "/workspace/legacy/file",
      isSymlink: false,
      symlinkTarget: null,
      withinAllowedRoot: true,
    };
    expect(checkPathSafety(check, ["/workspace/"])).toBe(true);
  });

  it("rejects path outside allowed root", () => {
    const check: PathSafetyCheckV1 = {
      path: "/etc/passwd",
      isSymlink: false,
      symlinkTarget: null,
      withinAllowedRoot: false,
    };
    expect(checkPathSafety(check, ["/workspace/"])).toBe(false);
  });

  it("allows symlink within allowed root", () => {
    const check: PathSafetyCheckV1 = {
      path: "/workspace/link",
      isSymlink: true,
      symlinkTarget: "/workspace/real",
      withinAllowedRoot: true,
    };
    expect(checkPathSafety(check, ["/workspace/"])).toBe(true);
  });

  it("rejects symlink outside allowed root", () => {
    const check: PathSafetyCheckV1 = {
      path: "/workspace/link",
      isSymlink: true,
      symlinkTarget: "/etc/passwd",
      withinAllowedRoot: true,
    };
    expect(checkPathSafety(check, ["/workspace/"])).toBe(false);
  });
});
