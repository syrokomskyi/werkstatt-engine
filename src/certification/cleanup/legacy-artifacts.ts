import type { Sha256Digest } from "../../fingerprint/primitives.ts";
import { byteHash } from "../../fingerprint/primitives.ts";
import type { CleanCutoverMarkerV1 } from "../cutover/marker.ts";

export type CleanupMode = "dry-run" | "apply";

export type LegacyCategory =
  | "superseded-workpiece"
  | "build-output"
  | "staging-payload"
  | "snapshot"
  | "cached-build";

export type ProtectedCategory =
  | "git-repository"
  | "bordbuch-record"
  | "specification"
  | "rfc"
  | "adr"
  | "session-transcript"
  | "manifest"
  | "material-report"
  | "cutover-record"
  | "current-artifact"
  | "rollback-artifact";

export interface LegacyArtifactEntryV1 {
  path: string;
  category: LegacyCategory;
  sizeBytes: number;
  digest: Sha256Digest;
  allowedForDeletion: boolean;
}

export interface ProtectedArtifactEntryV1 {
  path: string;
  category: ProtectedCategory;
  sizeBytes: number;
  reason: string;
}

export interface CleanupInventoryV1 {
  schema: "werkstatt/legacy-cleanup-inventory@1";
  inventoryId: string;
  systemId: string;
  cutoverMarkerId: string;
  legacyArtifacts: LegacyArtifactEntryV1[];
  protectedArtifacts: ProtectedArtifactEntryV1[];
  totalLegacyBytes: number;
  totalProtectedBytes: number;
  inventoryHash: Sha256Digest;
  inventoriedAt: string;
}

export interface CleanupPlanV1 {
  schema: "werkstatt/legacy-cleanup-plan@1";
  planId: string;
  inventoryHash: Sha256Digest;
  pathsToDelete: string[];
  pathsToProtect: string[];
  totalBytesToFree: number;
  planHash: Sha256Digest;
  createdAt: string;
}

export interface CleanupTombstoneV1 {
  schema: "werkstatt/legacy-cleanup-tombstone@1";
  tombstoneId: string;
  path: string;
  category: LegacyCategory;
  digest: Sha256Digest;
  sizeBytes: number;
  deletedAt: string;
  reason: string;
}

export interface CleanupReportV1 {
  schema: "werkstatt/legacy-cleanup-report@1";
  reportId: string;
  systemId: string;
  planHash: Sha256Digest;
  mode: CleanupMode;
  tombstones: CleanupTombstoneV1[];
  freedBytes: number;
  remainingProtectedCount: number;
  mirrorsVerified: boolean;
  recoveryPossible: boolean;
  completedAt: string;
}

export interface CleanupPrerequisitesV1 {
  cutoverMarker: CleanCutoverMarkerV1;
  mainCertifiedCandidateId: string;
  durableDossierVerified: boolean;
  mirrorsVerified: boolean;
  rollbackReferencesVerified: boolean;
}

export interface CleanupPrerequisiteResultV1 {
  ok: true;
  verified: boolean;
}

export interface CleanupPrerequisiteFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
}

export type CleanupPrerequisiteOutcomeV1 =
  | CleanupPrerequisiteResultV1
  | CleanupPrerequisiteFailureV1;

export function verifyCleanupPrerequisites(
  prereqs: CleanupPrerequisitesV1,
): CleanupPrerequisiteOutcomeV1 {
  if (!prereqs.cutoverMarker) {
    return {
      ok: false,
      ruleId: "CERT-CLEANUP-01",
      message: "clean-cutover marker is required before legacy cleanup",
    };
  }

  if (!prereqs.cutoverMarker.bootstrapExceptionClosed) {
    return {
      ok: false,
      ruleId: "CERT-CLEANUP-02",
      message: "bootstrap exception must be closed before legacy cleanup — cutover marker shows open exception",
    };
  }

  if (!prereqs.mainCertifiedCandidateId) {
    return {
      ok: false,
      ruleId: "CERT-CLEANUP-03",
      message: "current main-certified candidate ID is required before legacy cleanup",
    };
  }

  if (prereqs.mainCertifiedCandidateId !== prereqs.cutoverMarker.candidateId) {
    return {
      ok: false,
      ruleId: "CERT-CLEANUP-04",
      message: `main-certified candidate "${prereqs.mainCertifiedCandidateId}" does not match cutover marker candidate "${prereqs.cutoverMarker.candidateId}"`,
    };
  }

  if (!prereqs.durableDossierVerified) {
    return {
      ok: false,
      ruleId: "CERT-CLEANUP-05",
      message: "durable dossier must be verified before legacy cleanup",
    };
  }

  if (!prereqs.mirrorsVerified) {
    return {
      ok: false,
      ruleId: "CERT-CLEANUP-06",
      message: "mirrors must be verified before legacy cleanup",
    };
  }

  if (!prereqs.rollbackReferencesVerified) {
    return {
      ok: false,
      ruleId: "CERT-CLEANUP-07",
      message: "protected rollback references must be verified before legacy cleanup",
    };
  }

  return { ok: true, verified: true };
}

export function buildInventory(
  systemId: string,
  cutoverMarker: CleanCutoverMarkerV1,
  legacyArtifacts: LegacyArtifactEntryV1[],
  protectedArtifacts: ProtectedArtifactEntryV1[],
  inventoriedAt: string,
): CleanupInventoryV1 {
  const inventoryId = `inv-${systemId}-${cutoverMarker.markerId}`;
  const totalLegacyBytes = legacyArtifacts.reduce((sum, a) => sum + a.sizeBytes, 0);
  const totalProtectedBytes = protectedArtifacts.reduce((sum, a) => sum + a.sizeBytes, 0);

  const inventoryData = {
    systemId,
    cutoverMarkerId: cutoverMarker.markerId,
    legacyArtifacts: legacyArtifacts.map((a) => ({
      path: a.path,
      category: a.category,
      sizeBytes: a.sizeBytes,
      digest: a.digest,
      allowedForDeletion: a.allowedForDeletion,
    })),
    protectedArtifacts: protectedArtifacts.map((a) => ({
      path: a.path,
      category: a.category,
      sizeBytes: a.sizeBytes,
      reason: a.reason,
    })),
    totalLegacyBytes,
    totalProtectedBytes,
    inventoriedAt,
  };
  const inventoryHash = byteHash(JSON.stringify(inventoryData)) as Sha256Digest;

  return {
    schema: "werkstatt/legacy-cleanup-inventory@1",
    inventoryId,
    ...inventoryData,
    inventoryHash,
  };
}

export function buildPlan(
  inventory: CleanupInventoryV1,
  createdAt: string,
): CleanupPlanV1 {
  const pathsToDelete = inventory.legacyArtifacts
    .filter((a) => a.allowedForDeletion)
    .map((a) => a.path);
  const pathsToProtect = inventory.protectedArtifacts.map((a) => a.path);
  const totalBytesToFree = inventory.legacyArtifacts
    .filter((a) => a.allowedForDeletion)
    .reduce((sum, a) => sum + a.sizeBytes, 0);

  const planData = {
    inventoryHash: inventory.inventoryHash,
    pathsToDelete,
    pathsToProtect,
    totalBytesToFree,
    createdAt,
  };
  const planHash = byteHash(JSON.stringify(planData)) as Sha256Digest;

  return {
    schema: "werkstatt/legacy-cleanup-plan@1",
    planId: `plan-${inventory.inventoryId}`,
    ...planData,
    planHash,
  };
}

export interface PlanValidationInputV1 {
  plan: CleanupPlanV1;
  expectedPlanHash: Sha256Digest;
  currentInventory: CleanupInventoryV1;
}

export interface PlanValidationResultV1 {
  ok: true;
  valid: boolean;
}

export interface PlanValidationFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
}

export type PlanValidationOutcomeV1 =
  | PlanValidationResultV1
  | PlanValidationFailureV1;

export function validatePlan(
  input: PlanValidationInputV1,
): PlanValidationOutcomeV1 {
  if (input.plan.planHash !== input.expectedPlanHash) {
    return {
      ok: false,
      ruleId: "CERT-CLEANUP-08",
      message: "plan hash drift — expected plan hash does not match actual plan hash",
    };
  }

  const inventoryHashMatch = input.plan.inventoryHash === input.currentInventory.inventoryHash;
  if (!inventoryHashMatch) {
    return {
      ok: false,
      ruleId: "CERT-CLEANUP-09",
      message: "inventory hash drift — plan was built against a different inventory",
    };
  }

  for (const path of input.plan.pathsToDelete) {
    const entry = input.currentInventory.legacyArtifacts.find((a) => a.path === path);
    if (!entry) {
      return {
        ok: false,
        ruleId: "CERT-CLEANUP-10",
        message: `unknown path in deletion plan: "${path}" — path not in current inventory`,
      };
    }
    if (!entry.allowedForDeletion) {
      return {
        ok: false,
        ruleId: "CERT-CLEANUP-11",
        message: `protected path in deletion plan: "${path}" — path is not allowed for deletion`,
      };
    }
  }

  return { ok: true, valid: true };
}

export function buildTombstone(
  entry: LegacyArtifactEntryV1,
  deletedAt: string,
  reason: string,
): CleanupTombstoneV1 {
  return {
    schema: "werkstatt/legacy-cleanup-tombstone@1",
    tombstoneId: `tomb-${entry.digest}`,
    path: entry.path,
    category: entry.category,
    digest: entry.digest,
    sizeBytes: entry.sizeBytes,
    deletedAt,
    reason,
  };
}

export function buildReport(
  systemId: string,
  plan: CleanupPlanV1,
  mode: CleanupMode,
  tombstones: CleanupTombstoneV1[],
  remainingProtectedCount: number,
  mirrorsVerified: boolean,
  recoveryPossible: boolean,
  completedAt: string,
): CleanupReportV1 {
  const freedBytes = tombstones.reduce((sum, t) => sum + t.sizeBytes, 0);
  return {
    schema: "werkstatt/legacy-cleanup-report@1",
    reportId: `rpt-${systemId}-${plan.planId}`,
    systemId,
    planHash: plan.planHash,
    mode,
    tombstones,
    freedBytes,
    remainingProtectedCount,
    mirrorsVerified,
    recoveryPossible,
    completedAt,
  };
}

export function isSafeNoOp(
  report: CleanupReportV1,
): boolean {
  return report.mode === "apply" && report.tombstones.length === 0 && report.freedBytes === 0;
}

export function verifyReportIntegrity(
  report: CleanupReportV1,
): boolean {
  const expectedFreed = report.tombstones.reduce((sum, t) => sum + t.sizeBytes, 0);
  return expectedFreed === report.freedBytes;
}

export interface PathSafetyCheckV1 {
  path: string;
  isSymlink: boolean;
  symlinkTarget: string | null;
  withinAllowedRoot: boolean;
}

export function checkPathSafety(
  check: PathSafetyCheckV1,
  allowedRoots: string[],
): boolean {
  if (check.isSymlink && check.symlinkTarget) {
    const targetWithinAllowed = allowedRoots.some((root) =>
      check.symlinkTarget!.startsWith(root)
    );
    if (!targetWithinAllowed) return false;
  }
  return check.withinAllowedRoot;
}
