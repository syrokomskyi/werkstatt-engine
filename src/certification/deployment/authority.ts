import type { Sha256Digest } from "../../fingerprint/primitives.ts";
import { byteHash } from "../../fingerprint/primitives.ts";
import type { GateChannel } from "../contracts/identifiers.ts";
import type { GateDecisionV1, MainVerificationDecisionV1 } from "../contracts/decisions.ts";
import type { DeploymentOperationState } from "../state-machine.ts";
import { validateDeploymentTransition, validateArtifactTransition } from "../state-machine.ts";
import type { ReleaseArtifactState } from "../../schemas/release.ts";

export type CertificationGate = "dev-deploy" | "propagate-alt" | "promote-main";

export interface DeploymentGateRequirementV1 {
  gate: CertificationGate;
  channel: GateChannel;
  requiresDurableSync: boolean;
  requiresMainVerification: boolean;
  allowsForce: boolean;
  allowsSkip: boolean;
  allowsWaiver: boolean;
  allowsGrace: boolean;
}

export const DEPLOYMENT_GATE_REQUIREMENTS: readonly DeploymentGateRequirementV1[] = [
  {
    gate: "dev-deploy",
    channel: "dev",
    requiresDurableSync: false,
    requiresMainVerification: false,
    allowsForce: false,
    allowsSkip: false,
    allowsWaiver: false,
    allowsGrace: false,
  },
  {
    gate: "propagate-alt",
    channel: "alt",
    requiresDurableSync: true,
    requiresMainVerification: false,
    allowsForce: false,
    allowsSkip: false,
    allowsWaiver: false,
    allowsGrace: false,
  },
  {
    gate: "promote-main",
    channel: "main",
    requiresDurableSync: true,
    requiresMainVerification: true,
    allowsForce: false,
    allowsSkip: false,
    allowsWaiver: false,
    allowsGrace: false,
  },
];

export interface DeploymentAuthorizationInputV1 {
  candidateId: string;
  gate: CertificationGate;
  gateDecision: GateDecisionV1;
  durableSyncVerified: boolean;
  artifactReadinessVerified: boolean;
  artifactHash: Sha256Digest;
  forceRequested: boolean;
  skipRequested: boolean;
  waiverRequested: boolean;
  graceRequested: boolean;
}

export interface DeploymentAuthorizationResultV1 {
  ok: true;
  authorized: boolean;
  gate: CertificationGate;
  channel: GateChannel;
  candidateId: string;
  decisionId: string;
  requiresMainVerification: boolean;
  requiresDurableSync: boolean;
}

export interface DeploymentAuthorizationFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
  gate: CertificationGate;
}

export type DeploymentAuthorizationOutcomeV1 =
  DeploymentAuthorizationResultV1 | DeploymentAuthorizationFailureV1;

export function authorizeDeployment(
  input: DeploymentAuthorizationInputV1,
): DeploymentAuthorizationOutcomeV1 {
  const req = DEPLOYMENT_GATE_REQUIREMENTS.find((r) => r.gate === input.gate);
  if (!req) {
    return {
      ok: false,
      ruleId: "CERT-DEPLOY-01",
      message: `unknown deployment gate "${input.gate}"`,
      gate: input.gate,
    };
  }

  if (input.forceRequested && !req.allowsForce) {
    return {
      ok: false,
      ruleId: "CERT-DEPLOY-02",
      message: `force flag is not permitted for gate "${input.gate}"`,
      gate: input.gate,
    };
  }

  if (input.skipRequested && !req.allowsSkip) {
    return {
      ok: false,
      ruleId: "CERT-DEPLOY-03",
      message: `skip flag is not permitted for gate "${input.gate}"`,
      gate: input.gate,
    };
  }

  if (input.waiverRequested && !req.allowsWaiver) {
    return {
      ok: false,
      ruleId: "CERT-DEPLOY-04",
      message: `waiver flag is not permitted for gate "${input.gate}"`,
      gate: input.gate,
    };
  }

  if (input.graceRequested && !req.allowsGrace) {
    return {
      ok: false,
      ruleId: "CERT-DEPLOY-05",
      message: `grace flag is not permitted for gate "${input.gate}"`,
      gate: input.gate,
    };
  }

  if (input.gateDecision.candidateId !== input.candidateId) {
    return {
      ok: false,
      ruleId: "CERT-DEPLOY-06",
      message: `gate decision candidate "${input.gateDecision.candidateId}" does not match requested candidate "${input.candidateId}"`,
      gate: input.gate,
    };
  }

  if (input.gateDecision.status !== "pass") {
    return {
      ok: false,
      ruleId: "CERT-DEPLOY-07",
      message: `gate "${input.gate}" decision is "${input.gateDecision.status}", not "pass" — deployment denied`,
      gate: input.gate,
    };
  }

  if (!input.artifactReadinessVerified) {
    return {
      ok: false,
      ruleId: "CERT-DEPLOY-08",
      message: `artifact readiness not verified for candidate "${input.candidateId}"`,
      gate: input.gate,
    };
  }

  if (req.requiresDurableSync && !input.durableSyncVerified) {
    return {
      ok: false,
      ruleId: "CERT-DEPLOY-09",
      message: `durable sync not verified for gate "${input.gate}" — deployment denied`,
      gate: input.gate,
    };
  }

  return {
    ok: true,
    authorized: true,
    gate: input.gate,
    channel: req.channel,
    candidateId: input.candidateId,
    decisionId: input.gateDecision.decisionId,
    requiresMainVerification: req.requiresMainVerification,
    requiresDurableSync: req.requiresDurableSync,
  };
}

export interface MainVerificationInputV1 {
  candidateId: string;
  mainVerificationDecision: MainVerificationDecisionV1;
  durableSyncVerified: boolean;
  artifactHash: Sha256Digest;
  priorOperationRef: Sha256Digest | null;
}

export interface MainVerificationResultV1 {
  ok: true;
  certified: boolean;
  candidateId: string;
  decisionId: string;
  rootDossierRef: Sha256Digest;
}

export interface MainVerificationFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
}

export type MainVerificationOutcomeV1 = MainVerificationResultV1 | MainVerificationFailureV1;

export function verifyMainPromotion(input: MainVerificationInputV1): MainVerificationOutcomeV1 {
  if (input.mainVerificationDecision.candidateId !== input.candidateId) {
    return {
      ok: false,
      ruleId: "CERT-DEPLOY-10",
      message: `main verification decision candidate "${input.mainVerificationDecision.candidateId}" does not match "${input.candidateId}"`,
    };
  }

  if (input.mainVerificationDecision.status !== "pass") {
    return {
      ok: false,
      ruleId: "CERT-DEPLOY-11",
      message: `main verification status is "${input.mainVerificationDecision.status}", not "pass" — promotion denied`,
    };
  }

  if (!input.durableSyncVerified) {
    return {
      ok: false,
      ruleId: "CERT-DEPLOY-12",
      message: `durable sync not verified after main verification — certification denied`,
    };
  }

  return {
    ok: true,
    certified: true,
    candidateId: input.candidateId,
    decisionId: input.mainVerificationDecision.decisionId,
    rootDossierRef: input.mainVerificationDecision.rootDossierRef,
  };
}

export interface RollbackEvaluationInputV1 {
  candidateId: string;
  failedGate: CertificationGate;
  rollbackCandidateId: string;
  rollbackArtifactHash: Sha256Digest;
  rollbackArtifactReadinessVerified: boolean;
  sharedOutageDetected: boolean;
}

export interface RollbackEvaluationResultV1 {
  ok: true;
  rollbackAuthorized: boolean;
  reason: string;
  rollbackCandidateId: string;
}

export interface RollbackEvaluationFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
}

export type RollbackEvaluationOutcomeV1 = RollbackEvaluationResultV1 | RollbackEvaluationFailureV1;

export function evaluateRollback(input: RollbackEvaluationInputV1): RollbackEvaluationOutcomeV1 {
  if (input.sharedOutageDetected) {
    return {
      ok: true,
      rollbackAuthorized: false,
      reason:
        "shared infrastructure outage detected — rollback to equally affected candidate is not useful",
      rollbackCandidateId: input.rollbackCandidateId,
    };
  }

  if (!input.rollbackArtifactReadinessVerified) {
    return {
      ok: true,
      rollbackAuthorized: false,
      reason: `rollback candidate "${input.rollbackCandidateId}" artifact is not ready — cannot restore`,
      rollbackCandidateId: input.rollbackCandidateId,
    };
  }

  if (input.rollbackCandidateId === input.candidateId) {
    return {
      ok: true,
      rollbackAuthorized: false,
      reason: "rollback target is the same as the failed candidate — nothing to restore",
      rollbackCandidateId: input.rollbackCandidateId,
    };
  }

  return {
    ok: true,
    rollbackAuthorized: true,
    reason: `rollback from failed gate "${input.failedGate}" to verified candidate "${input.rollbackCandidateId}"`,
    rollbackCandidateId: input.rollbackCandidateId,
  };
}

export interface CrashRecoveryStateV1 {
  operationId: string;
  candidateId: string;
  channel: GateChannel;
  lastPersistedState: DeploymentOperationState;
  artifactPersisted: boolean;
  trafficSwitched: boolean;
  verificationStarted: boolean;
  verificationCompleted: boolean;
  statePersisted: boolean;
}

export interface CrashRecoveryResultV1 {
  ok: true;
  resumeFrom: DeploymentOperationState;
  action: "resume-verification" | "resume-rollback" | "restart-deployment" | "quarantine";
  reason: string;
}

export interface CrashRecoveryFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
}

export type CrashRecoveryOutcomeV1 = CrashRecoveryResultV1 | CrashRecoveryFailureV1;

export function evaluateCrashRecovery(state: CrashRecoveryStateV1): CrashRecoveryOutcomeV1 {
  if (state.verificationCompleted && !state.statePersisted) {
    return {
      ok: true,
      resumeFrom: "verifying",
      action: "resume-verification",
      reason: "verification completed but state not persisted — re-verify and persist",
    };
  }

  if (state.trafficSwitched && !state.verificationStarted) {
    return {
      ok: true,
      resumeFrom: "deployed",
      action: "resume-verification",
      reason: "traffic switched but verification not started — start verification",
    };
  }

  if (state.trafficSwitched && state.verificationStarted && !state.verificationCompleted) {
    return {
      ok: true,
      resumeFrom: "verifying",
      action: "resume-verification",
      reason: "verification started but not completed — resume verification",
    };
  }

  if (state.artifactPersisted && !state.trafficSwitched) {
    return {
      ok: true,
      resumeFrom: "deployed",
      action: "resume-verification",
      reason: "artifact deployed but traffic not switched — proceed to verification",
    };
  }

  if (!state.artifactPersisted) {
    return {
      ok: true,
      resumeFrom: "authorized",
      action: "restart-deployment",
      reason: "artifact not persisted — restart deployment from authorized state",
    };
  }

  if (state.lastPersistedState === "rolled-back") {
    return {
      ok: true,
      resumeFrom: "rolled-back",
      action: "quarantine",
      reason: "rollback completed — quarantine and open incident",
    };
  }

  return {
    ok: false,
    ruleId: "CERT-DEPLOY-13",
    message: `crash recovery state is ambiguous — cannot determine resume point from state "${state.lastPersistedState}"`,
  };
}

export interface DeploymentEffectRecordV1 {
  schema: "werkstatt/deployment-effect-record@1";
  effectHash: Sha256Digest;
  operationId: string;
  candidateId: string;
  gate: CertificationGate;
  channel: GateChannel;
  artifactHash: Sha256Digest;
  decisionId: string;
  durableSyncVerified: boolean;
  mainVerificationDecisionId: string | null;
  state: DeploymentOperationState;
  timestamp: string;
  workerVersionId?: string;
  releaseId?: string;
}

export function buildDeploymentEffectRecord(
  operationId: string,
  candidateId: string,
  gate: CertificationGate,
  channel: GateChannel,
  artifactHash: Sha256Digest,
  decisionId: string,
  durableSyncVerified: boolean,
  mainVerificationDecisionId: string | null,
  state: DeploymentOperationState,
  timestamp: string,
  workerVersionId?: string,
  releaseId?: string,
): DeploymentEffectRecordV1 {
  const recordData = {
    operationId,
    candidateId,
    gate,
    channel,
    artifactHash,
    decisionId,
    durableSyncVerified,
    mainVerificationDecisionId,
    state,
    timestamp,
    workerVersionId,
    releaseId,
  };
  const effectHash = byteHash(JSON.stringify(recordData)) as Sha256Digest;

  return {
    schema: "werkstatt/deployment-effect-record@1",
    effectHash,
    ...recordData,
  };
}

export function gateFromChannel(channel: GateChannel): CertificationGate {
  switch (channel) {
    case "dev":
      return "dev-deploy";
    case "alt":
      return "propagate-alt";
    case "main":
      return "promote-main";
  }
}

export function isForceBypassRequested(input: {
  forceRequested: boolean;
  skipRequested: boolean;
  waiverRequested: boolean;
  graceRequested: boolean;
}): boolean {
  return (
    input.forceRequested || input.skipRequested || input.waiverRequested || input.graceRequested
  );
}

export { validateDeploymentTransition, validateArtifactTransition };
export type { ReleaseArtifactState };
