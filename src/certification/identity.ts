import {
  snapshotCanonicalJsonObjectV1,
  canonicalJsonHashV1,
  type CanonicalJsonObjectV1,
} from "../fingerprint/canonical-json.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import type {
  ReleaseCandidateV1,
  CertificationPolicyBundleV1,
  EvidenceEnvelopeV1,
  CertificationDossierEventV1,
  GateDecisionV1,
  MainVerificationDecisionV1,
  CertificationHealthDecisionV1,
  CertificationActionPackV1,
  DeploymentOperationEventV1,
} from "./contracts/index.ts";

export type CertificationIdentityDiagnosticV1 = {
  readonly code:
    | "CERT-IDENTITY-01"
    | "CERT-CANONICAL-DOMAIN-01"
    | "CERT-CANONICAL-TRAVERSAL-01"
    | "CERT-CANONICAL-UNICODE-01"
    | "CERT-CANONICAL-LIMIT-01"
    | "CERT-REDACTION-01";
  readonly message: string;
};

export type IdentityBuildResultV1<TPayload> =
  | {
      readonly ok: true;
      readonly payload: TPayload;
      readonly canonical: CanonicalJsonObjectV1;
      readonly digest: Sha256Digest;
    }
  | { readonly ok: false; readonly diagnostic: CertificationIdentityDiagnosticV1 };

function snapshotAndHash(
  payload: unknown,
): IdentityBuildResultV1<unknown> {
  const result = snapshotCanonicalJsonObjectV1(payload);
  if (!result.ok) {
    return {
      ok: false,
      diagnostic: {
        code: result.code as CertificationIdentityDiagnosticV1["code"],
        message: result.message,
      },
    };
  }
  const digest = canonicalJsonHashV1(result.value);
  return { ok: true, payload, canonical: result.value, digest };
}

export type ReleaseCandidateIdentityPayloadV1 = {
  readonly schema: "werkstatt/release-candidate-identity@1";
  readonly systemId: string;
  readonly releaseVersion: string;
  readonly sourceHash: string;
  readonly contentHash: string;
  readonly artifactHash: string;
  readonly buildConfigHash: string;
  readonly deploymentPlanHash: string;
  readonly policyBundleRoot: string;
  readonly toolchainId: string;
};

export function buildReleaseCandidateIdentityV1(
  input: ReleaseCandidateV1,
): IdentityBuildResultV1<ReleaseCandidateIdentityPayloadV1> {
  const payload: ReleaseCandidateIdentityPayloadV1 = {
    schema: "werkstatt/release-candidate-identity@1",
    systemId: input.systemId,
    releaseVersion: input.releaseVersion,
    sourceHash: input.sourceHash,
    contentHash: input.contentHash,
    artifactHash: input.artifactHash,
    buildConfigHash: input.buildConfig.buildConfigHash,
    deploymentPlanHash: input.deploymentPlan.deploymentPlanHash,
    policyBundleRoot: input.policyBundleRoot,
    toolchainId: input.toolchainId,
  };
  const result = snapshotAndHash(payload);
  if (!result.ok) return result;
  return result as IdentityBuildResultV1<ReleaseCandidateIdentityPayloadV1>;
}

export type PolicyBundleIdentityPayloadV1 = {
  readonly schema: "werkstatt/policy-bundle-identity@1";
  readonly policyBundleId: string;
  readonly version: string;
  readonly profileId: string;
  readonly resolvedRequirements: readonly unknown[];
  readonly producerManifests: readonly unknown[];
  readonly rubricManifests: readonly unknown[];
  readonly toolchainManifests: readonly unknown[];
  readonly issuerManifests: readonly unknown[];
  readonly riskPolicy: unknown;
  readonly retention: unknown;
};

export function buildPolicyBundleIdentityV1(
  input: CertificationPolicyBundleV1,
): IdentityBuildResultV1<PolicyBundleIdentityPayloadV1> {
  const payload: PolicyBundleIdentityPayloadV1 = {
    schema: "werkstatt/policy-bundle-identity@1",
    policyBundleId: input.policyBundleId,
    version: input.version,
    profileId: input.profileId,
    resolvedRequirements: input.resolvedRequirements,
    producerManifests: input.producerManifests,
    rubricManifests: input.rubricManifests,
    toolchainManifests: input.toolchainManifests,
    issuerManifests: input.issuerManifests,
    riskPolicy: input.riskPolicy,
    retention: input.retention,
  };
  const result = snapshotAndHash(payload);
  if (!result.ok) return result;
  return result as IdentityBuildResultV1<PolicyBundleIdentityPayloadV1>;
}

export type EvidenceIdentityPayloadV1 = {
  readonly schema: "werkstatt/evidence-identity@1";
  readonly candidateId: string;
  readonly producerId: string;
  readonly producerAttemptId: string;
  readonly producedAt: string;
  readonly result: unknown;
  readonly payloads: readonly unknown[];
  readonly redaction: unknown;
  readonly attestation: unknown;
  readonly authorityAdmission: unknown;
  readonly freshness: unknown;
};

export function buildEvidenceIdentityV1(
  input: EvidenceEnvelopeV1,
): IdentityBuildResultV1<EvidenceIdentityPayloadV1> {
  if (!input.redaction.resolved) {
    return {
      ok: false,
      diagnostic: {
        code: "CERT-REDACTION-01",
        message: "evidence reports unresolved secret or PII exposure",
      },
    };
  }
  const payload: EvidenceIdentityPayloadV1 = {
    schema: "werkstatt/evidence-identity@1",
    candidateId: input.candidateId,
    producerId: input.producerId,
    producerAttemptId: input.producerAttemptId,
    producedAt: input.producedAt,
    result: input.result,
    payloads: input.payloads.map((p) => ({
      payloadDigest: p.payloadDigest,
      mediaType: p.mediaType,
      sizeBytes: p.sizeBytes,
      role: p.role,
    })),
    redaction: input.redaction,
    attestation: input.attestation ?? null,
    authorityAdmission: input.authorityAdmission ?? null,
    freshness: input.freshness,
  };
  const result = snapshotAndHash(payload);
  if (!result.ok) return result;
  return result as IdentityBuildResultV1<EvidenceIdentityPayloadV1>;
}

export type DossierEventIdentityPayloadV1 = {
  readonly schema: "werkstatt/dossier-event-identity@1";
  readonly eventKind: string;
  readonly candidateId: string;
  readonly authoritySequence: number;
  readonly previousEventHash: string | null;
  readonly eventPayloadRef: string;
};

export function buildDossierEventIdentityV1(
  input: CertificationDossierEventV1,
): IdentityBuildResultV1<DossierEventIdentityPayloadV1> {
  const payload: DossierEventIdentityPayloadV1 = {
    schema: "werkstatt/dossier-event-identity@1",
    eventKind: input.eventKind,
    candidateId: input.candidateId,
    authoritySequence: input.authoritySequence,
    previousEventHash: input.previousEventHash,
    eventPayloadRef: input.eventPayloadRef,
  };
  const result = snapshotAndHash(payload);
  if (!result.ok) return result;
  return result as IdentityBuildResultV1<DossierEventIdentityPayloadV1>;
}

export type GateDecisionIdentityPayloadV1 = {
  readonly schema: "werkstatt/gate-decision-identity@1";
  readonly candidateId: string;
  readonly policyBundleRoot: string;
  readonly gate: string;
  readonly evaluationCut: number;
  readonly selectedEvidence: readonly unknown[];
  readonly status: string;
  readonly coverage: unknown;
  readonly reasons: readonly string[];
  readonly actionPackRef: string | null;
};

export function buildGateDecisionIdentityV1(
  input: GateDecisionV1,
): IdentityBuildResultV1<GateDecisionIdentityPayloadV1> {
  const payload: GateDecisionIdentityPayloadV1 = {
    schema: "werkstatt/gate-decision-identity@1",
    candidateId: input.candidateId,
    policyBundleRoot: input.policyBundleRoot,
    gate: input.gate,
    evaluationCut: input.evaluationCut,
    selectedEvidence: input.selectedEvidence,
    status: input.status,
    coverage: input.coverage,
    reasons: input.reasons,
    actionPackRef: input.actionPackRef,
  };
  const result = snapshotAndHash(payload);
  if (!result.ok) return result;
  return result as IdentityBuildResultV1<GateDecisionIdentityPayloadV1>;
}

export type MainVerificationIdentityPayloadV1 = {
  readonly schema: "werkstatt/main-verification-identity@1";
  readonly candidateId: string;
  readonly policyBundleRoot: string;
  readonly gate: string;
  readonly evaluationCut: number;
  readonly selectedEvidence: readonly unknown[];
  readonly status: string;
  readonly coverage: unknown;
  readonly reasons: readonly string[];
  readonly actionPackRef: string | null;
  readonly rootDossierRef: string;
  readonly priorOperationRef: string | null;
};

export function buildMainVerificationIdentityV1(
  input: MainVerificationDecisionV1,
): IdentityBuildResultV1<MainVerificationIdentityPayloadV1> {
  const payload: MainVerificationIdentityPayloadV1 = {
    schema: "werkstatt/main-verification-identity@1",
    candidateId: input.candidateId,
    policyBundleRoot: input.policyBundleRoot,
    gate: input.gate,
    evaluationCut: input.evaluationCut,
    selectedEvidence: input.selectedEvidence,
    status: input.status,
    coverage: input.coverage,
    reasons: input.reasons,
    actionPackRef: input.actionPackRef,
    rootDossierRef: input.rootDossierRef,
    priorOperationRef: input.priorOperationRef,
  };
  const result = snapshotAndHash(payload);
  if (!result.ok) return result;
  return result as IdentityBuildResultV1<MainVerificationIdentityPayloadV1>;
}

export type HealthDecisionIdentityPayloadV1 = {
  readonly schema: "werkstatt/health-decision-identity@1";
  readonly candidateId: string;
  readonly currentStatus: string;
  readonly lastDecisionId: string | null;
  readonly lastDecisionAt: string | null;
  readonly staleEvidenceCount: number;
  readonly incompleteCount: number;
};

export function buildHealthDecisionIdentityV1(
  input: CertificationHealthDecisionV1,
): IdentityBuildResultV1<HealthDecisionIdentityPayloadV1> {
  const payload: HealthDecisionIdentityPayloadV1 = {
    schema: "werkstatt/health-decision-identity@1",
    candidateId: input.candidateId,
    currentStatus: input.currentStatus,
    lastDecisionId: input.lastDecisionId,
    lastDecisionAt: input.lastDecisionAt,
    staleEvidenceCount: input.staleEvidenceCount,
    incompleteCount: input.incompleteCount,
  };
  const result = snapshotAndHash(payload);
  if (!result.ok) return result;
  return result as IdentityBuildResultV1<HealthDecisionIdentityPayloadV1>;
}

export type ActionPackIdentityPayloadV1 = {
  readonly schema: "werkstatt/action-pack-identity@1";
  readonly actionPackId: string;
  readonly candidateId: string;
  readonly decisionId: string;
  readonly tasks: readonly unknown[];
};

export function buildActionPackIdentityV1(
  input: CertificationActionPackV1,
): IdentityBuildResultV1<ActionPackIdentityPayloadV1> {
  const payload: ActionPackIdentityPayloadV1 = {
    schema: "werkstatt/action-pack-identity@1",
    actionPackId: input.actionPackId,
    candidateId: input.candidateId,
    decisionId: input.decisionId,
    tasks: input.tasks,
  };
  const result = snapshotAndHash(payload);
  if (!result.ok) return result;
  return result as IdentityBuildResultV1<ActionPackIdentityPayloadV1>;
}

export type DeploymentOperationEventIdentityPayloadV1 = {
  readonly schema: "werkstatt/deployment-operation-event-identity@1";
  readonly operationId: string;
  readonly candidateId: string;
  readonly channel: string;
  readonly target: string;
  readonly environment: string;
  readonly deploymentPlanHash: string;
  readonly environmentIdentityHash: string;
  readonly authoritySequence: number;
  readonly previousEventHash: string | null;
  readonly eventKind: string;
  readonly result: unknown;
};

export function buildDeploymentOperationEventIdentityV1(
  input: DeploymentOperationEventV1,
): IdentityBuildResultV1<DeploymentOperationEventIdentityPayloadV1> {
  const payload: DeploymentOperationEventIdentityPayloadV1 = {
    schema: "werkstatt/deployment-operation-event-identity@1",
    operationId: input.operationId,
    candidateId: input.candidateId,
    channel: input.channel,
    target: input.target,
    environment: input.environment,
    deploymentPlanHash: input.deploymentPlanHash,
    environmentIdentityHash: input.environmentIdentityHash,
    authoritySequence: input.authoritySequence,
    previousEventHash: input.previousEventHash,
    eventKind: input.eventKind,
    result: input.result,
  };
  const result = snapshotAndHash(payload);
  if (!result.ok) return result;
  return result as IdentityBuildResultV1<DeploymentOperationEventIdentityPayloadV1>;
}
