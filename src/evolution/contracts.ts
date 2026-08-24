import type { Sha256Digest } from "../fingerprint/primitives.ts";

export type EvolutionStage =
  | "defined"
  | "tested"
  | "shadowed"
  | "canary"
  | "promoted"
  | "rolled-back"
  | "quarantined";

export type EvolutionDecision = "admit" | "deny" | "incomplete";

export interface CapabilityCandidateV1 {
  schema: "werkstatt/capability-candidate@1";
  candidateId: string;
  parentArtifactHash: Sha256Digest;
  artifactHash: Sha256Digest;
  intentHash: Sha256Digest;
  policyHash: Sha256Digest;
  stage: EvolutionStage;
}

export interface DefinitionEvidenceV1 {
  schema: "werkstatt/definition-evidence@1";
  intentDescription: string;
  scope: string;
  generatedDiffHash: Sha256Digest;
  sourceHash: Sha256Digest;
  constraints: readonly string[];
  lineageParentHash: Sha256Digest | null;
  evidenceHash: Sha256Digest;
}

export interface EvaluationEvidenceV1 {
  schema: "werkstatt/evaluation-evidence@1";
  deterministicFixturesPassed: boolean;
  conformancePassed: boolean;
  securityPassed: boolean;
  performancePassed: boolean;
  regressionPassed: boolean;
  differentialResults: readonly DifferentialResultV1[];
  evidenceHash: Sha256Digest;
}

export interface DifferentialResultV1 {
  metric: string;
  baseline: number;
  candidate: number;
  delta: number;
  passed: boolean;
}

export interface ObservationEvidenceV1 {
  schema: "werkstatt/observation-evidence@1";
  workloadId: string;
  exposure: "shadow" | "canary";
  duration: number;
  sampleSize: number;
  segmentedMetrics: readonly SegmentedMetricV1[];
  incidents: readonly IncidentRecordV1[];
  noveltyScore: number;
  uncertaintyScore: number;
  evidenceHash: Sha256Digest;
}

export interface SegmentedMetricV1 {
  segment: string;
  metric: string;
  value: number;
  threshold: number;
  passed: boolean;
}

export interface IncidentRecordV1 {
  incidentId: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  timestamp: string;
}

export interface AuthorityEvidenceV1 {
  schema: "werkstatt/authority-evidence@1";
  lawKernelDecisionHash: Sha256Digest;
  actorId: string;
  policyVersion: string;
  allowedTransition: EvolutionStage;
  expiry: string;
  killSwitchActive: boolean;
  evidenceHash: Sha256Digest;
}

export interface ArtifactEvidenceV1 {
  schema: "werkstatt/artifact-evidence@1";
  candidateHash: Sha256Digest;
  parentHash: Sha256Digest;
  sandboxAdmissionHash: Sha256Digest;
  dependencyHashes: readonly Sha256Digest[];
  provenanceHash: Sha256Digest;
  signatureHash: Sha256Digest;
  evidenceHash: Sha256Digest;
}

export interface EvolutionEvidenceBundleV1 {
  schema: "werkstatt/evolution-evidence-bundle@1";
  definition: DefinitionEvidenceV1;
  evaluation: EvaluationEvidenceV1;
  observation: ObservationEvidenceV1;
  authority: AuthorityEvidenceV1;
  artifact: ArtifactEvidenceV1;
  bundleHash: Sha256Digest;
}

export interface TransitionRequestV1 {
  schema: "werkstatt/evolution-transition-request@1";
  candidateId: string;
  fromStage: EvolutionStage;
  toStage: EvolutionStage;
  evidence: EvolutionEvidenceBundleV1;
  idempotencyKey: string;
  sequenceNumber: number;
}

export interface TransitionRecordV1 {
  schema: "werkstatt/evolution-transition-record@1";
  transitionHash: Sha256Digest;
  candidateId: string;
  fromStage: EvolutionStage;
  toStage: EvolutionStage;
  decision: EvolutionDecision;
  evidenceBundleHash: Sha256Digest;
  authorityHash: Sha256Digest;
  policyVersion: string;
  sequenceNumber: number;
  idempotencyKey: string;
  timestamp: string;
  diagnostic: string | null;
  compensatingAction: CompensatingActionV1 | null;
}

export interface CompensatingActionV1 {
  schema: "werkstatt/compensating-action@1";
  action: "rollback" | "quarantine" | "kill-switch";
  targetArtifactHash: Sha256Digest;
  reason: string;
}

export interface InspectionSnapshotV1 {
  schema: "werkstatt/inspection-snapshot@1";
  currentArtifactHash: Sha256Digest;
  observedMetrics: readonly SegmentedMetricV1[];
  activeIncidents: readonly IncidentRecordV1[];
  snapshotHash: Sha256Digest;
}

export interface BoundedIntentV1 {
  schema: "werkstatt/bounded-intent@1";
  intentId: string;
  description: string;
  scope: string;
  constraints: readonly string[];
  intentHash: Sha256Digest;
}

export interface KillSwitchStateV1 {
  active: boolean;
  reason: string;
  activatedAt: string;
}

export const FORWARD_ONLY_SEQUENCE: readonly EvolutionStage[] = [
  "defined",
  "tested",
  "shadowed",
  "canary",
  "promoted",
];

export const TERMINAL_STAGES: readonly EvolutionStage[] = [
  "promoted",
  "rolled-back",
  "quarantined",
];

export function isForwardTransition(from: EvolutionStage, to: EvolutionStage): boolean {
  if (to === "rolled-back" || to === "quarantined") {
    return true;
  }
  const fromIdx = FORWARD_ONLY_SEQUENCE.indexOf(from);
  const toIdx = FORWARD_ONLY_SEQUENCE.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) {
    return false;
  }
  return toIdx === fromIdx + 1;
}

export function isTerminalStage(stage: EvolutionStage): boolean {
  return TERMINAL_STAGES.includes(stage);
}
