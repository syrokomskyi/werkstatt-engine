import type { Sha256Digest } from "../../fingerprint/primitives.ts";
import { byteHash } from "../../fingerprint/primitives.ts";
import type { ResolvedComponentSetV1 } from "../../component/contracts.ts";
import type { CertificationHealth } from "../health/monitor.ts";

export interface CleanCutoverMarkerV1 {
  schema: "werkstatt/clean-cutover-marker@1";
  markerId: string;
  systemId: string;
  candidateId: string;
  releaseId: string;
  devDecisionId: string;
  altDecisionId: string;
  mainVerificationDecisionId: string;
  evaluatorDecisionIds: string[];
  dossierRoot: Sha256Digest;
  mainIdentity: {
    candidateId: string;
    artifactHash: Sha256Digest;
    deployedAt: string;
    deploymentUrl: string | null;
  };
  healthState: CertificationHealth;
  healthDecisionId: string | null;
  rollbackTarget: {
    candidateId: string;
    artifactHash: Sha256Digest;
    protectedReason: "bootstrap" | "prior-certified";
  };
  bootstrapExceptionClosed: boolean;
  continuousHealthWindowCompleted: boolean;
  markerHash: Sha256Digest;
  committedAt: string;
}

export interface CutoverVerificationInputV1 {
  candidateId: string;
  devDecisionId: string;
  altDecisionId: string;
  mainVerificationDecisionId: string;
  evaluatorDecisionIds: string[];
  dossierRoot: Sha256Digest;
  resolvedComponentSet: ResolvedComponentSetV1;
  healthState: CertificationHealth;
  healthDecisionId: string | null;
  rollbackCandidateId: string;
  rollbackArtifactHash: Sha256Digest;
  continuousHealthWindowCompleted: boolean;
  legacyStateReads: LegacyStateRead[];
}

export interface LegacyStateRead {
  command: string;
  artifactPath: string;
  artifactType: "release-certification" | "grace" | "mission-artifact";
  usedForSuccess: boolean;
}

export interface CutoverVerificationResultV1 {
  ok: true;
  verified: boolean;
  marker: CleanCutoverMarkerV1;
}

export interface CutoverVerificationFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
}

export type CutoverVerificationOutcomeV1 =
  | CutoverVerificationResultV1
  | CutoverVerificationFailureV1;

export function verifyCutover(
  input: CutoverVerificationInputV1,
  systemId: string,
  releaseId: string,
  deployedAt: string,
  deploymentUrl: string | null,
): CutoverVerificationOutcomeV1 {
  if (input.legacyStateReads.length > 0) {
    const legacyForSuccess = input.legacyStateReads.filter((r) => r.usedForSuccess);
    if (legacyForSuccess.length > 0) {
      const first = legacyForSuccess[0]!;
      return {
        ok: false,
        ruleId: "CERT-CUTOVER-01",
        message: `command "${first.command}" reads legacy ${first.artifactType} at ${first.artifactPath} for success — no runtime command may read legacy state for success`,
      };
    }
  }

  if (!input.devDecisionId) {
    return {
      ok: false,
      ruleId: "CERT-CUTOVER-02",
      message: "dev gate decision ID is required for cutover",
    };
  }

  if (!input.altDecisionId) {
    return {
      ok: false,
      ruleId: "CERT-CUTOVER-03",
      message: "alt gate decision ID is required for cutover",
    };
  }

  if (!input.mainVerificationDecisionId) {
    return {
      ok: false,
      ruleId: "CERT-CUTOVER-04",
      message: "main verification decision ID is required for cutover",
    };
  }

  if (input.evaluatorDecisionIds.length === 0) {
    return {
      ok: false,
      ruleId: "CERT-CUTOVER-05",
      message: "at least one evaluator decision ID is required for cutover",
    };
  }

  if (!input.continuousHealthWindowCompleted) {
    return {
      ok: false,
      ruleId: "CERT-CUTOVER-06",
      message: "at least one continuous health schedule window must complete successfully before cutover",
    };
  }

  if (input.healthState === "revoked") {
    return {
      ok: false,
      ruleId: "CERT-CUTOVER-07",
      message: "health state is revoked — cutover cannot proceed with revoked health",
    };
  }

  if (input.rollbackCandidateId === input.candidateId) {
    return {
      ok: false,
      ruleId: "CERT-CUTOVER-08",
      message: "rollback target candidate must differ from the new cutover candidate",
    };
  }

  if (!input.resolvedComponentSet.setHash) {
    return {
      ok: false,
      ruleId: "CERT-CUTOVER-09",
      message: "resolved component set must have a valid set hash",
    };
  }

  const marker = buildCutoverMarker({
    systemId,
    releaseId,
    candidateId: input.candidateId,
    devDecisionId: input.devDecisionId,
    altDecisionId: input.altDecisionId,
    mainVerificationDecisionId: input.mainVerificationDecisionId,
    evaluatorDecisionIds: input.evaluatorDecisionIds,
    dossierRoot: input.dossierRoot,
    mainIdentity: {
      candidateId: input.candidateId,
      artifactHash: input.resolvedComponentSet.setHash as string as Sha256Digest,
      deployedAt,
      deploymentUrl,
    },
    healthState: input.healthState,
    healthDecisionId: input.healthDecisionId,
    rollbackTarget: {
      candidateId: input.rollbackCandidateId,
      artifactHash: input.rollbackArtifactHash,
      protectedReason: "bootstrap",
    },
    bootstrapExceptionClosed: true,
    continuousHealthWindowCompleted: input.continuousHealthWindowCompleted,
    committedAt: deployedAt,
  });

  return {
    ok: true,
    verified: true,
    marker,
  };
}

export interface CutoverMarkerBuilderInputV1 {
  systemId: string;
  releaseId: string;
  candidateId: string;
  devDecisionId: string;
  altDecisionId: string;
  mainVerificationDecisionId: string;
  evaluatorDecisionIds: string[];
  dossierRoot: Sha256Digest;
  mainIdentity: {
    candidateId: string;
    artifactHash: Sha256Digest;
    deployedAt: string;
    deploymentUrl: string | null;
  };
  healthState: CertificationHealth;
  healthDecisionId: string | null;
  rollbackTarget: {
    candidateId: string;
    artifactHash: Sha256Digest;
    protectedReason: "bootstrap" | "prior-certified";
  };
  bootstrapExceptionClosed: boolean;
  continuousHealthWindowCompleted: boolean;
  committedAt: string;
}

export function buildCutoverMarker(
  input: CutoverMarkerBuilderInputV1,
): CleanCutoverMarkerV1 {
  const markerId = `cutover-${input.systemId}-${input.candidateId}`;
  const markerData = {
    systemId: input.systemId,
    releaseId: input.releaseId,
    candidateId: input.candidateId,
    devDecisionId: input.devDecisionId,
    altDecisionId: input.altDecisionId,
    mainVerificationDecisionId: input.mainVerificationDecisionId,
    evaluatorDecisionIds: input.evaluatorDecisionIds,
    dossierRoot: input.dossierRoot,
    mainIdentity: input.mainIdentity,
    healthState: input.healthState,
    healthDecisionId: input.healthDecisionId,
    rollbackTarget: input.rollbackTarget,
    bootstrapExceptionClosed: input.bootstrapExceptionClosed,
    continuousHealthWindowCompleted: input.continuousHealthWindowCompleted,
    committedAt: input.committedAt,
  };
  const markerHash = byteHash(JSON.stringify(markerData)) as Sha256Digest;

  return {
    schema: "werkstatt/clean-cutover-marker@1",
    markerId,
    ...markerData,
    markerHash,
  };
}

export interface LegacyProhibitionResultV1 {
  ok: true;
  clean: boolean;
  violations: LegacyStateRead[];
}

export interface LegacyProhibitionFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
  violations: LegacyStateRead[];
}

export type LegacyProhibitionOutcomeV1 =
  | LegacyProhibitionResultV1
  | LegacyProhibitionFailureV1;

export function checkLegacyStateProhibition(
  reads: LegacyStateRead[],
): LegacyProhibitionOutcomeV1 {
  const successReads = reads.filter((r) => r.usedForSuccess);

  if (successReads.length === 0) {
    return {
      ok: true,
      clean: true,
      violations: [],
    };
  }

  return {
    ok: false,
    ruleId: "CERT-CUTOVER-01",
    message: `${successReads.length} runtime command(s) read legacy state for success — no runtime command may read legacy release certification, grace, or mission artifacts for success after cutover`,
    violations: successReads,
  };
}

export function isBootstrapExceptionClosed(
  marker: CleanCutoverMarkerV1,
): boolean {
  return marker.bootstrapExceptionClosed;
}

export function isRollbackTargetProtected(
  marker: CleanCutoverMarkerV1,
): boolean {
  return marker.rollbackTarget.protectedReason === "bootstrap"
    ? !marker.bootstrapExceptionClosed
    : true;
}

export function verifyMarkerIntegrity(
  marker: CleanCutoverMarkerV1,
): boolean {
  const markerData = {
    systemId: marker.systemId,
    releaseId: marker.releaseId,
    candidateId: marker.candidateId,
    devDecisionId: marker.devDecisionId,
    altDecisionId: marker.altDecisionId,
    mainVerificationDecisionId: marker.mainVerificationDecisionId,
    evaluatorDecisionIds: marker.evaluatorDecisionIds,
    dossierRoot: marker.dossierRoot,
    mainIdentity: marker.mainIdentity,
    healthState: marker.healthState,
    healthDecisionId: marker.healthDecisionId,
    rollbackTarget: marker.rollbackTarget,
    bootstrapExceptionClosed: marker.bootstrapExceptionClosed,
    continuousHealthWindowCompleted: marker.continuousHealthWindowCompleted,
    committedAt: marker.committedAt,
  };
  const expectedHash = byteHash(JSON.stringify(markerData)) as Sha256Digest;
  return expectedHash === marker.markerHash;
}
