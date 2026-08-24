import type { Sha256Digest } from "../fingerprint/primitives.ts";
import { byteHash } from "../fingerprint/primitives.ts";
import type {
  EvolutionStage,
  EvolutionDecision,
  CapabilityCandidateV1,
  EvolutionEvidenceBundleV1,
  TransitionRequestV1,
  TransitionRecordV1,
  CompensatingActionV1,
} from "./contracts.ts";
import { isForwardTransition, isTerminalStage, } from "./contracts.ts";

export interface ReducerStateV1 {
  candidates: Map<string, CapabilityCandidateV1>;
  transitions: TransitionRecordV1[];
  killSwitchActive: boolean;
}

export interface TransitionResultV1 {
  ok: true;
  record: TransitionRecordV1;
  updatedCandidate: CapabilityCandidateV1;
}

export interface TransitionFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
}

export type TransitionOutcomeV1 = TransitionResultV1 | TransitionFailureV1;

export function createEvolutionReducerState(): ReducerStateV1 {
  return {
    candidates: new Map(),
    transitions: [],
    killSwitchActive: false,
  };
}

export function applyTransition(
  state: ReducerStateV1,
  request: TransitionRequestV1,
  timestamp: string,
): TransitionOutcomeV1 {
  if (state.killSwitchActive) {
    return {
      ok: false,
      ruleId: "CERT-EVO-01",
      message: "kill switch is active — all transitions are denied",
    };
  }

  const candidate = state.candidates.get(request.candidateId);
  if (!candidate) {
    return {
      ok: false,
      ruleId: "CERT-EVO-02",
      message: `candidate "${request.candidateId}" not found`,
    };
  }

  const existingIdempotency = state.transitions.find(
    (t) => t.idempotencyKey === request.idempotencyKey,
  );
  if (existingIdempotency) {
    return {
      ok: false,
      ruleId: "CERT-EVO-07",
      message: `idempotency key "${request.idempotencyKey}" already used in transition ${existingIdempotency.transitionHash}`,
    };
  }

  if (candidate.stage !== request.fromStage) {
    return {
      ok: false,
      ruleId: "CERT-EVO-03",
      message: `stage mismatch: candidate is at "${candidate.stage}", request expects "${request.fromStage}"`,
    };
  }

  if (isTerminalStage(candidate.stage) && request.toStage !== "quarantined") {
    return {
      ok: false,
      ruleId: "CERT-EVO-04",
      message: `candidate is at terminal stage "${candidate.stage}" — no further forward transitions`,
    };
  }

  if (!isForwardTransition(request.fromStage, request.toStage)) {
    return {
      ok: false,
      ruleId: "CERT-EVO-05",
      message: `transition "${request.fromStage}" → "${request.toStage}" is not a valid forward-only transition`,
    };
  }

  const expectedSeq = state.transitions.filter((t) => t.candidateId === request.candidateId).length;
  if (request.sequenceNumber !== expectedSeq) {
    return {
      ok: false,
      ruleId: "CERT-EVO-06",
      message: `sequence mismatch: expected ${expectedSeq}, got ${request.sequenceNumber}`,
    };
  }

  const evidenceCheck = checkEvidenceForStage(request.toStage, request.evidence);
  if (!evidenceCheck.ok) {
    const record = buildTransitionRecord(
      request,
      "incomplete",
      evidenceCheck.message,
      null,
      timestamp,
    );
    state.transitions.push(record);
    return {
      ok: false,
      ruleId: "CERT-EVO-08",
      message: evidenceCheck.message,
    };
  }

  const decision: EvolutionDecision = "admit";
  let compensatingAction: CompensatingActionV1 | null = null;

  if (request.toStage === "rolled-back") {
    compensatingAction = {
      schema: "werkstatt/compensating-action@1",
      action: "rollback",
      targetArtifactHash: candidate.parentArtifactHash,
      reason: "rollback transition activates previously admitted artifact",
    };
  }

  if (request.toStage === "quarantined") {
    compensatingAction = {
      schema: "werkstatt/compensating-action@1",
      action: "quarantine",
      targetArtifactHash: candidate.artifactHash,
      reason: "quarantine revokes activation and future transition eligibility",
    };
  }

  const updatedCandidate: CapabilityCandidateV1 = {
    ...candidate,
    stage: request.toStage,
  };

  state.candidates.set(request.candidateId, updatedCandidate);

  const record = buildTransitionRecord(request, decision, null, compensatingAction, timestamp);
  state.transitions.push(record);

  return { ok: true, record, updatedCandidate };
}

export function registerCandidate(
  state: ReducerStateV1,
  candidate: CapabilityCandidateV1,
): TransitionOutcomeV1 {
  if (state.candidates.has(candidate.candidateId)) {
    return {
      ok: false,
      ruleId: "CERT-EVO-09",
      message: `candidate "${candidate.candidateId}" already exists — candidates are immutable, create a new one`,
    };
  }

  if (candidate.stage !== "defined") {
    return {
      ok: false,
      ruleId: "CERT-EVO-10",
      message: `new candidate must start at stage "defined", got "${candidate.stage}"`,
    };
  }

  state.candidates.set(candidate.candidateId, candidate);

  return {
    ok: true,
    record: {
      schema: "werkstatt/evolution-transition-record@1",
      transitionHash: byteHash(`register:${candidate.candidateId}`) as Sha256Digest,
      candidateId: candidate.candidateId,
      fromStage: "defined" as EvolutionStage,
      toStage: "defined" as EvolutionStage,
      decision: "admit" as EvolutionDecision,
      evidenceBundleHash: byteHash("registration") as Sha256Digest,
      authorityHash: byteHash("registration") as Sha256Digest,
      policyVersion: "1.0.0",
      sequenceNumber: 0,
      idempotencyKey: `register-${candidate.candidateId}`,
      timestamp: "1970-01-01T00:00:00Z",
      diagnostic: null,
      compensatingAction: null,
    },
    updatedCandidate: candidate,
  };
}

export function activateKillSwitch(state: ReducerStateV1, reason: string, timestamp: string): void {
  state.killSwitchActive = true;
  state.transitions.push({
    schema: "werkstatt/evolution-transition-record@1",
    transitionHash: byteHash(`kill-switch:${timestamp}`) as Sha256Digest,
    candidateId: "kill-switch",
    fromStage: "promoted" as EvolutionStage,
    toStage: "quarantined" as EvolutionStage,
    decision: "admit" as EvolutionDecision,
    evidenceBundleHash: byteHash("kill-switch") as Sha256Digest,
    authorityHash: byteHash("kill-switch") as Sha256Digest,
    policyVersion: "1.0.0",
    sequenceNumber: state.transitions.length,
    idempotencyKey: `kill-switch-${timestamp}`,
    timestamp,
    diagnostic: reason,
    compensatingAction: {
      schema: "werkstatt/compensating-action@1",
      action: "kill-switch",
      targetArtifactHash: byteHash("kill-switch") as Sha256Digest,
      reason,
    },
  });
}

function buildTransitionRecord(
  request: TransitionRequestV1,
  decision: EvolutionDecision,
  diagnostic: string | null,
  compensatingAction: CompensatingActionV1 | null,
  timestamp: string,
): TransitionRecordV1 {
  const recordData = {
    candidateId: request.candidateId,
    fromStage: request.fromStage,
    toStage: request.toStage,
    decision,
    evidenceBundleHash: request.evidence.bundleHash,
    authorityHash: request.evidence.authority.evidenceHash,
    policyVersion: request.evidence.authority.policyVersion,
    sequenceNumber: request.sequenceNumber,
    idempotencyKey: request.idempotencyKey,
    timestamp,
  };
  const transitionHash = byteHash(JSON.stringify(recordData)) as Sha256Digest;

  return {
    schema: "werkstatt/evolution-transition-record@1",
    transitionHash,
    candidateId: request.candidateId,
    fromStage: request.fromStage,
    toStage: request.toStage,
    decision,
    evidenceBundleHash: request.evidence.bundleHash,
    authorityHash: request.evidence.authority.evidenceHash,
    policyVersion: request.evidence.authority.policyVersion,
    sequenceNumber: request.sequenceNumber,
    idempotencyKey: request.idempotencyKey,
    timestamp,
    diagnostic,
    compensatingAction,
  };
}

interface EvidenceCheckResultV1 {
  ok: boolean;
  message: string;
}

function checkEvidenceForStage(
  stage: EvolutionStage,
  evidence: EvolutionEvidenceBundleV1,
): EvidenceCheckResultV1 {
  if (stage === "rolled-back" || stage === "quarantined") {
    if (!evidence.authority) {
      return { ok: false, message: `authority evidence required for ${stage}` };
    }
    return { ok: true, message: "" };
  }

  if (stage === "tested") {
    if (!evidence.evaluation.deterministicFixturesPassed) {
      return { ok: false, message: "deterministic fixtures did not pass" };
    }
    if (!evidence.evaluation.conformancePassed) {
      return { ok: false, message: "conformance did not pass" };
    }
    if (!evidence.evaluation.securityPassed) {
      return { ok: false, message: "security tests did not pass" };
    }
    return { ok: true, message: "" };
  }

  if (stage === "shadowed") {
    if (evidence.observation.exposure !== "shadow") {
      return { ok: false, message: "shadow stage requires shadow exposure observation" };
    }
    if (
      evidence.observation.incidents.some((i) => i.severity === "critical" || i.severity === "high")
    ) {
      return { ok: false, message: "shadow stage has high/critical incidents" };
    }
    return { ok: true, message: "" };
  }

  if (stage === "canary") {
    if (evidence.observation.exposure !== "canary") {
      return { ok: false, message: "canary stage requires canary exposure observation" };
    }
    const failedMetrics = evidence.observation.segmentedMetrics.filter((m) => !m.passed);
    if (failedMetrics.length > 0) {
      return {
        ok: false,
        message: `canary metrics failed: ${failedMetrics.map((m) => m.segment + "/" + m.metric).join(", ")}`,
      };
    }
    if (evidence.observation.incidents.some((i) => i.severity === "critical")) {
      return {
        ok: false,
        message: "canary stage has critical incidents — automatic rollback required",
      };
    }
    return { ok: true, message: "" };
  }

  if (stage === "promoted") {
    if (!evidence.definition) {
      return { ok: false, message: "definition evidence required for promotion" };
    }
    if (
      !evidence.evaluation.deterministicFixturesPassed ||
      !evidence.evaluation.conformancePassed ||
      !evidence.evaluation.securityPassed ||
      !evidence.evaluation.performancePassed ||
      !evidence.evaluation.regressionPassed
    ) {
      return { ok: false, message: "all evaluation layers must pass for promotion" };
    }
    if (evidence.observation.exposure !== "canary") {
      return { ok: false, message: "canary observation required for promotion" };
    }
    if (evidence.observation.segmentedMetrics.some((m) => !m.passed)) {
      return { ok: false, message: "all segmented metrics must pass for promotion" };
    }
    if (evidence.observation.incidents.length > 0) {
      return { ok: false, message: "no incidents allowed for promotion" };
    }
    if (evidence.authority.killSwitchActive) {
      return { ok: false, message: "kill switch is active — promotion denied" };
    }
    if (!evidence.artifact) {
      return { ok: false, message: "artifact evidence required for promotion" };
    }
    return { ok: true, message: "" };
  }

  return { ok: true, message: "" };
}

export function getCandidateHistory(
  state: ReducerStateV1,
  candidateId: string,
): readonly TransitionRecordV1[] {
  return state.transitions.filter((t) => t.candidateId === candidateId);
}

export function getCandidate(
  state: ReducerStateV1,
  candidateId: string,
): CapabilityCandidateV1 | null {
  return state.candidates.get(candidateId) ?? null;
}
