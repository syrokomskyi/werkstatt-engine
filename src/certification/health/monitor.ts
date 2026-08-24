import type { Sha256Digest } from "../../fingerprint/primitives.ts";
import { byteHash } from "../../fingerprint/primitives.ts";
import type { CertificationHealthDecisionV1 } from "../contracts/decisions.ts";
import type { CertificationStatus } from "../contracts/identifiers.ts";
import type { DriftAction } from "../profile/schemas.ts";

export type CertificationHealth = "current" | "degraded" | "revoked";
export type HealthDriftAction = DriftAction;

export type DriftCause =
  | "expired-evidence"
  | "public-output-drift"
  | "dns-header-drift"
  | "candidate-specific-regression"
  | "shared-infrastructure-outage"
  | "monitor-crash"
  | "late-evidence"
  | "duplicate-schedule-delivery";

export interface HealthRequirementResultV1 {
  requirementId: string;
  status: CertificationStatus;
  evidenceId: string | null;
  evidenceExpired: boolean;
  ttlExceeded: boolean;
  observedAt: string;
}

export interface HealthEvaluationInputV1 {
  candidateId: string;
  assessedAt: string;
  previousHealth: CertificationHealth | null;
  requirementResults: HealthRequirementResultV1[];
  sharedOutageDetected: boolean;
  rollbackCandidateAvailable: boolean;
  rollbackCandidateId: string | null;
  profileDriftAction: HealthDriftAction;
  scheduleWindowId: string;
  priorOperationId: string | null;
}

export interface HealthEvaluationResultV1 {
  ok: true;
  health: CertificationHealth;
  action: HealthDriftAction;
  triggeringRequirementIds: string[];
  selectedEvidenceIds: string[];
  incidentId: string | null;
  reason: string;
}

export interface HealthEvaluationFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
}

export type HealthEvaluationOutcomeV1 = HealthEvaluationResultV1 | HealthEvaluationFailureV1;

export function evaluateHealth(input: HealthEvaluationInputV1): HealthEvaluationOutcomeV1 {
  if (input.requirementResults.length === 0) {
    return {
      ok: false,
      ruleId: "CERT-HEALTH-01",
      message: "no requirement results provided for health evaluation",
    };
  }

  const failedReqs = input.requirementResults.filter((r) => r.status === "fail");
  const staleReqs = input.requirementResults.filter(
    (r) => r.status === "stale" || r.evidenceExpired || r.ttlExceeded,
  );
  const incompleteReqs = input.requirementResults.filter((r) => r.status === "incomplete");

  const triggeringReqs = [...failedReqs, ...staleReqs, ...incompleteReqs];
  const triggeringIds = triggeringReqs.map((r) => r.requirementId);
  const selectedEvidenceIds = triggeringReqs
    .filter((r) => r.evidenceId !== null)
    .map((r) => r.evidenceId!) as string[];

  if (failedReqs.length > 0) {
    const action = input.sharedOutageDetected ? "incident-only" : input.profileDriftAction;
    return {
      ok: true,
      health: "degraded",
      action,
      triggeringRequirementIds: triggeringIds,
      selectedEvidenceIds,
      incidentId: `inc-${input.candidateId}-${input.scheduleWindowId}`,
      reason: `${failedReqs.length} requirement(s) failed — health degraded`,
    };
  }

  if (staleReqs.length > 0) {
    const action = input.sharedOutageDetected ? "incident-only" : "retry";
    return {
      ok: true,
      health: "degraded",
      action,
      triggeringRequirementIds: triggeringIds,
      selectedEvidenceIds,
      incidentId:
        action === "incident-only" ? `inc-${input.candidateId}-${input.scheduleWindowId}` : null,
      reason: `${staleReqs.length} requirement(s) stale or expired — health degraded`,
    };
  }

  if (incompleteReqs.length > 0) {
    return {
      ok: true,
      health: "degraded",
      action: "retry",
      triggeringRequirementIds: triggeringIds,
      selectedEvidenceIds,
      incidentId: null,
      reason: `${incompleteReqs.length} requirement(s) incomplete — health degraded, retry scheduled`,
    };
  }

  return {
    ok: true,
    health: "current",
    action: "retry",
    triggeringRequirementIds: [],
    selectedEvidenceIds: [],
    incidentId: null,
    reason: "all requirements pass — health current",
  };
}

export function shouldRevoke(
  currentHealth: CertificationHealth,
  consecutiveDegradedWindows: number,
  revokeThreshold: number,
): boolean {
  if (currentHealth !== "degraded") return false;
  return consecutiveDegradedWindows >= revokeThreshold;
}

export function classifyDriftCause(
  requirementResult: HealthRequirementResultV1,
  sharedOutageDetected: boolean,
): DriftCause {
  if (sharedOutageDetected) return "shared-infrastructure-outage";
  if (requirementResult.evidenceExpired || requirementResult.ttlExceeded) {
    return "expired-evidence";
  }
  if (requirementResult.status === "fail") {
    return "candidate-specific-regression";
  }
  if (requirementResult.status === "stale") {
    return "public-output-drift";
  }
  if (requirementResult.status === "incomplete") {
    return "late-evidence";
  }
  return "public-output-drift";
}

export interface ScheduleWindowV1 {
  windowId: string;
  startedAt: string;
  completedAt: string | null;
  operationId: string;
  candidateId: string;
  effective: boolean;
}

export interface ScheduleWindowResultV1 {
  ok: true;
  effective: boolean;
  windowId: string;
  reason: string;
}

export interface ScheduleWindowFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
}

export type ScheduleWindowOutcomeV1 = ScheduleWindowResultV1 | ScheduleWindowFailureV1;

export function evaluateScheduleWindow(
  window: ScheduleWindowV1,
  priorWindows: ScheduleWindowV1[],
): ScheduleWindowOutcomeV1 {
  const duplicate = priorWindows.find((w) => w.windowId === window.windowId);
  if (duplicate) {
    return {
      ok: true,
      effective: false,
      windowId: window.windowId,
      reason: `duplicate schedule window "${window.windowId}" — already processed`,
    };
  }

  const priorForCandidate = priorWindows.filter(
    (w) => w.candidateId === window.candidateId && w.effective,
  );
  const lastEffective = priorForCandidate[priorForCandidate.length - 1];
  if (lastEffective && lastEffective.completedAt && lastEffective.completedAt > window.startedAt) {
    return {
      ok: true,
      effective: false,
      windowId: window.windowId,
      reason: `late delivery — window started at ${window.startedAt} but prior window completed at ${lastEffective.completedAt}`,
    };
  }

  return {
    ok: true,
    effective: true,
    windowId: window.windowId,
    reason: "schedule window is effective",
  };
}

export interface HealthDecisionBuilderInputV1 {
  candidateId: string;
  currentStatus: CertificationStatus;
  lastDecisionId: string | null;
  lastDecisionAt: string | null;
  staleEvidenceCount: number;
  incompleteCount: number;
  assessedAt: string;
}

export function buildHealthDecision(
  input: HealthDecisionBuilderInputV1,
): CertificationHealthDecisionV1 {
  return {
    schema: "werkstatt/certification-health-decision@1",
    candidateId: input.candidateId,
    currentStatus: input.currentStatus,
    lastDecisionId: input.lastDecisionId,
    lastDecisionAt: input.lastDecisionAt,
    staleEvidenceCount: input.staleEvidenceCount,
    incompleteCount: input.incompleteCount,
    assessedAt: input.assessedAt,
  };
}

export interface HealthProjectionV1 {
  schema: "werkstatt/health-projection@1";
  projectionHash: Sha256Digest;
  candidateId: string;
  currentHealth: CertificationHealth;
  lastHealthDecisionId: string | null;
  lastHealthDecisionAt: string | null;
  activeIncidentIds: string[];
  consecutiveDegradedWindows: number;
  projectedAt: string;
}

export function buildHealthProjection(
  candidateId: string,
  currentHealth: CertificationHealth,
  lastHealthDecisionId: string | null,
  lastHealthDecisionAt: string | null,
  activeIncidentIds: string[],
  consecutiveDegradedWindows: number,
  projectedAt: string,
): HealthProjectionV1 {
  const projectionData = {
    candidateId,
    currentHealth,
    lastHealthDecisionId,
    lastHealthDecisionAt,
    activeIncidentIds,
    consecutiveDegradedWindows,
    projectedAt,
  };
  const projectionHash = byteHash(JSON.stringify(projectionData)) as Sha256Digest;
  return {
    schema: "werkstatt/health-projection@1",
    projectionHash,
    ...projectionData,
  };
}

export interface MonitorRecoveryStateV1 {
  operationId: string;
  candidateId: string;
  scheduleWindowId: string;
  requirementsStarted: boolean;
  requirementsCompleted: boolean;
  healthDecisionAppended: boolean;
  incidentCreated: boolean;
  projectionUpdated: boolean;
}

export interface MonitorRecoveryResultV1 {
  ok: true;
  resumeFrom: "requirements" | "health-decision" | "incident" | "projection" | "complete";
  reason: string;
}

export interface MonitorRecoveryFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
}

export type MonitorRecoveryOutcomeV1 = MonitorRecoveryResultV1 | MonitorRecoveryFailureV1;

export function evaluateMonitorRecovery(state: MonitorRecoveryStateV1): MonitorRecoveryOutcomeV1 {
  if (state.projectionUpdated) {
    return {
      ok: true,
      resumeFrom: "complete",
      reason: "monitor cycle completed — projection updated",
    };
  }

  if (state.healthDecisionAppended && !state.incidentCreated) {
    return {
      ok: true,
      resumeFrom: "incident",
      reason: "health decision appended but incident not created — create incident",
    };
  }

  if (state.healthDecisionAppended && state.incidentCreated) {
    return {
      ok: true,
      resumeFrom: "projection",
      reason: "health decision and incident complete — update projection",
    };
  }

  if (state.requirementsCompleted && !state.healthDecisionAppended) {
    return {
      ok: true,
      resumeFrom: "health-decision",
      reason: "requirements completed but health decision not appended — append decision",
    };
  }

  if (state.requirementsStarted && !state.requirementsCompleted) {
    return {
      ok: true,
      resumeFrom: "requirements",
      reason: "requirements started but not completed — re-run requirements",
    };
  }

  if (!state.requirementsStarted) {
    return {
      ok: true,
      resumeFrom: "requirements",
      reason: "requirements not started — start from beginning",
    };
  }

  return {
    ok: false,
    ruleId: "CERT-HEALTH-02",
    message: `monitor recovery state is ambiguous for operation "${state.operationId}"`,
  };
}

export function isHealthTransitionValid(
  from: CertificationHealth | null,
  to: CertificationHealth,
): boolean {
  if (from === null) return true;
  if (from === to) return true;
  if (from === "current" && to === "degraded") return true;
  if (from === "current" && to === "revoked") return true;
  if (from === "degraded" && to === "current") return true;
  if (from === "degraded" && to === "revoked") return true;
  if (from === "revoked" && to === "current") return true;
  if (from === "revoked" && to === "degraded") return true;
  return false;
}
