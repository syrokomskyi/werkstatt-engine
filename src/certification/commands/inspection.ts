import type { ReleaseCandidateV1 } from "../contracts/candidate.ts";
import type { GateDecisionV1 } from "../contracts/decisions.ts";
import type { CoverageReportV1 } from "../contracts/decisions.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";
import type { GateChannel } from "../contracts/identifiers.ts";
import type { DossierRepositoryV1 } from "../storage/repository.ts";
import { verifyDossierIntegrity, buildRootReference } from "../storage/repository.ts";
import { buildReleaseCandidateIdentityV1 } from "../identity.ts";

export interface CertificationStatusResultV1 {
  ok: true;
  status: {
    candidateId: string;
    candidateIdentityHash: Sha256Digest;
    latestDecisions: Partial<Record<GateChannel, GateDecisionV1>>;
    coverage: CoverageReportV1 | null;
    dossierRootHash: Sha256Digest | null;
    eventCount: number;
    durableReplicaStatus: "verified" | "not-verified" | "mismatch";
    activeIncidents: string[];
    nextRequiredAction: string | null;
    actionPackLocators: string[];
  };
}

export interface CertificationStatusFailureV1 {
  ok: false;
  ruleId: "CERT-ORCHESTRATOR-08" | "CERT-ORCHESTRATOR-09";
  message: string;
}

export type CertificationStatusOutcomeV1 =
  | CertificationStatusResultV1
  | CertificationStatusFailureV1;

export function getCertificationStatus(
  candidate: ReleaseCandidateV1,
  repository: DossierRepositoryV1,
  decisions: Partial<Record<GateChannel, GateDecisionV1>>,
  coverage: CoverageReportV1 | null,
  durableReplicaStatus: "verified" | "not-verified" | "mismatch",
  activeIncidents: string[],
  actionPackLocators: string[],
): CertificationStatusOutcomeV1 {
  const identityResult = buildReleaseCandidateIdentityV1(candidate);
  if (!identityResult.ok) {
    return {
      ok: false,
      ruleId: "CERT-ORCHESTRATOR-08",
      message: `failed to compute candidate identity: ${identityResult.diagnostic.message}`,
    };
  }

  const rootRef = buildRootReference(repository);
  const latestDecisions: Partial<Record<GateChannel, GateDecisionV1>> = {};
  for (const [gate, decision] of Object.entries(decisions)) {
    if (decision) {
      latestDecisions[gate as GateChannel] = decision;
    }
  }

  const nextRequiredAction = computeNextRequiredAction(latestDecisions, durableReplicaStatus);

  return {
    ok: true,
    status: {
      candidateId: candidate.candidateId,
      candidateIdentityHash: identityResult.digest,
      latestDecisions,
      coverage,
      dossierRootHash: rootRef.rootHash,
      eventCount: rootRef.eventCount,
      durableReplicaStatus,
      activeIncidents,
      nextRequiredAction,
      actionPackLocators,
    },
  };
}

function computeNextRequiredAction(
  decisions: Partial<Record<GateChannel, GateDecisionV1>>,
  durableReplicaStatus: "verified" | "not-verified" | "mismatch",
): string | null {
  for (const [gate, decision] of Object.entries(decisions)) {
    if (decision && decision.status !== "pass") {
      return `Fix requirements for gate "${gate}" — current status: ${decision.status}`;
    }
  }

  if (durableReplicaStatus === "mismatch") {
    return "Durable replica root hash mismatch — sync required";
  }

  if (durableReplicaStatus === "not-verified") {
    return "Durable replica not verified — sync required for Alt/Main gates";
  }

  return null;
}

export interface CertificationVerifyResultV1 {
  ok: true;
  verified: boolean;
  recomputedCandidateId: string;
  recomputedDossierRoot: Sha256Digest;
  eventCount: number;
  decisionReferences: string[];
  issues: string[];
}

export interface CertificationVerifyFailureV1 {
  ok: false;
  ruleId: "CERT-ORCHESTRATOR-09" | "CERT-ORCHESTRATOR-10";
  message: string;
  issues: string[];
}

export type CertificationVerifyOutcomeV1 =
  | CertificationVerifyResultV1
  | CertificationVerifyFailureV1;

export function verifyCertification(
  candidate: ReleaseCandidateV1,
  repository: DossierRepositoryV1,
  decisions: Partial<Record<GateChannel, GateDecisionV1>>,
  expectedDossierRoot?: Sha256Digest,
): CertificationVerifyOutcomeV1 {
  const issues: string[] = [];

  const identityResult = buildReleaseCandidateIdentityV1(candidate);
  if (!identityResult.ok) {
    return {
      ok: false,
      ruleId: "CERT-ORCHESTRATOR-09",
      message: `failed to compute candidate identity: ${identityResult.diagnostic.message}`,
      issues,
    };
  }

  const integrityResult = verifyDossierIntegrity(repository);
  if (!integrityResult.ok) {
    issues.push(`dossier integrity: ${integrityResult.message}`);
    return {
      ok: false,
      ruleId: "CERT-ORCHESTRATOR-10",
      message: `dossier integrity verification failed: ${integrityResult.message}`,
      issues,
    };
  }

  if (!integrityResult.valid) {
    issues.push("dossier root hash does not match recomputed root");
  }

  if (expectedDossierRoot && expectedDossierRoot !== integrityResult.recomputedRootHash) {
    issues.push(
      `expected dossier root ${expectedDossierRoot} does not match recomputed ${integrityResult.recomputedRootHash}`,
    );
  }

  const decisionReferences: string[] = [];
  for (const [gate, decision] of Object.entries(decisions)) {
    if (decision) {
      decisionReferences.push(`${gate}:${decision.decisionId}`);
    }
  }

  const verified = issues.length === 0;

  return {
    ok: true,
    verified,
    recomputedCandidateId: candidate.candidateId,
    recomputedDossierRoot: integrityResult.recomputedRootHash,
    eventCount: repository.events.length,
    decisionReferences,
    issues,
  };
}
