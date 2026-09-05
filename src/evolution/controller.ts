import type { Sha256Digest } from "../fingerprint/primitives.ts";
import type {
  CapabilityCandidateV1,
  TransitionRequestV1,
  TransitionRecordV1,
  InspectionSnapshotV1,
  BoundedIntentV1,
  KillSwitchStateV1,
  EvolutionStage,
  CandidateEvidenceV1,
} from "./contracts.ts";
import {
  createEvolutionReducerState,
  applyTransition,
  registerCandidate,
  activateKillSwitch,
  type ReducerStateV1,
  type TransitionOutcomeV1,
} from "./reducer.ts";
import { checkSelfChangeBoundary, runAllGuards, type GuardResultV1 } from "./guards.ts";
import { createShadowExecutor, type ShadowExecutor } from "./shadow-executor.ts";
import { createHealthMonitor, type HealthMonitor } from "./health-monitor.ts";

export interface EvolutionControllerV1 {
  inspect(snapshot: InspectionSnapshotV1): InspectionOutcomeV1;
  defineCandidate(
    snapshot: InspectionSnapshotV1,
    intent: BoundedIntentV1,
    artifactHash: Sha256Digest,
    parentArtifactHash: Sha256Digest,
    policyHash: Sha256Digest,
    componentId: string,
    version: string,
    replacesComponentId: string,
    allowAgentWritten?: boolean,
  ): DefineCandidateOutcomeV1;
  requestTransition(request: TransitionRequestV1, timestamp: string): TransitionOutcomeV1;
  activateKillSwitch(reason: string, timestamp: string): void;
  getCandidate(candidateId: string): CapabilityCandidateV1 | null;
  getCandidateHistory(candidateId: string): readonly TransitionRecordV1[];
  getKillSwitchState(): KillSwitchStateV1;
  getAllTransitions(): readonly TransitionRecordV1[];
  shadow(candidateId: string, comparisonMetric: string): Promise<CandidateEvidenceV1>;
  test(candidateId: string, scenariosPath: string): Promise<CandidateEvidenceV1[]>;
  canary(candidateId: string, trafficPercent: number): Promise<void>;
  activate(candidateId: string): Promise<void>;
  promote(candidateId: string, missionId: string): Promise<void>;
  rollback(componentId: string): Promise<void>;
  quarantine(candidateId: string, reason: string): Promise<void>;
  inspectAll(): readonly CapabilityCandidateV1[];
}

export interface InspectionResultV1 {
  ok: true;
  snapshot: InspectionSnapshotV1;
  observations: readonly string[];
}

export interface InspectionFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
}

export type InspectionOutcomeV1 = InspectionResultV1 | InspectionFailureV1;

export interface DefineCandidateResultV1 {
  ok: true;
  candidate: CapabilityCandidateV1;
}

export interface DefineCandidateFailureV1 {
  ok: false;
  ruleId: string;
  message: string;
}

export type DefineCandidateOutcomeV1 = DefineCandidateResultV1 | DefineCandidateFailureV1;

export function createEvolutionController(
  maxCanaryDuration: number = 3600,
  minSampleSize: number = 100,
  quarantineThreshold: number = 3,
): EvolutionControllerV1 {
  const state: ReducerStateV1 = createEvolutionReducerState();
  let killSwitch: KillSwitchStateV1 = {
    active: false,
    reason: "",
    activatedAt: "",
  };
  const shadowExecutor: ShadowExecutor = createShadowExecutor();
  const healthMonitor: HealthMonitor = createHealthMonitor(quarantineThreshold);

  return {
    inspect(snapshot: InspectionSnapshotV1): InspectionOutcomeV1 {
      const observations: string[] = [];

      if (snapshot.activeIncidents.some((i) => i.severity === "critical")) {
        observations.push("critical incidents detected — consider kill switch");
      }

      if (snapshot.observedMetrics.some((m) => !m.passed)) {
        observations.push("some metrics failing — investigate before defining new candidate");
      }

      return { ok: true, snapshot, observations };
    },

    defineCandidate(
      snapshot: InspectionSnapshotV1,
      intent: BoundedIntentV1,
      artifactHash: Sha256Digest,
      parentArtifactHash: Sha256Digest,
      policyHash: Sha256Digest,
      componentId: string,
      version: string,
      replacesComponentId: string,
      allowAgentWritten: boolean = false,
    ): DefineCandidateOutcomeV1 {
      const boundaryCheck = checkSelfChangeBoundary(intent);
      if (!boundaryCheck.ok) {
        return {
          ok: false,
          ruleId: boundaryCheck.ruleId,
          message: boundaryCheck.message,
        };
      }

      if (!allowAgentWritten && intent.scope.includes("agent-authored")) {
        return {
          ok: false,
          ruleId: "EVOLUTION-01",
          message: "agent-written candidates require --allow-agent-written flag",
        };
      }

      const candidateId = `${componentId}@${version}`;
      const candidate: CapabilityCandidateV1 = {
        schema: "werkstatt/capability-candidate@1",
        candidateId,
        componentId,
        version,
        parentArtifactHash,
        artifactHash,
        intentHash: intent.intentHash,
        policyHash,
        stage: "defined" as EvolutionStage,
        replacesComponentId,
        canaryTrafficPercent: 0,
      };

      const result = registerCandidate(state, candidate);
      if (!result.ok) {
        return {
          ok: false,
          ruleId: (result as { ruleId: string }).ruleId,
          message: (result as { message: string }).message,
        };
      }

      return { ok: true, candidate };
    },

    requestTransition(request: TransitionRequestV1, timestamp: string): TransitionOutcomeV1 {
      const candidate = state.candidates.get(request.candidateId);
      if (!candidate) {
        return {
          ok: false,
          ruleId: "CERT-EVO-02",
          message: `candidate "${request.candidateId}" not found`,
        };
      }

      const guardResult: GuardResultV1 = runAllGuards(
        candidate,
        request,
        killSwitch,
        timestamp,
        maxCanaryDuration,
        minSampleSize,
      );

      if (!guardResult.ok) {
        return {
          ok: false,
          ruleId: guardResult.ruleId,
          message: guardResult.message,
        };
      }

      return applyTransition(state, request, timestamp);
    },

    activateKillSwitch(reason: string, timestamp: string): void {
      killSwitch = {
        active: true,
        reason,
        activatedAt: timestamp,
      };
      activateKillSwitch(state, reason, timestamp);
    },

    getCandidate(candidateId: string): CapabilityCandidateV1 | null {
      return state.candidates.get(candidateId) ?? null;
    },

    getCandidateHistory(candidateId: string): readonly TransitionRecordV1[] {
      return state.transitions.filter((t) => t.candidateId === candidateId);
    },

    getKillSwitchState(): KillSwitchStateV1 {
      return killSwitch;
    },

    getAllTransitions(): readonly TransitionRecordV1[] {
      return [...state.transitions];
    },

    async shadow(candidateId: string, comparisonMetric: string): Promise<CandidateEvidenceV1> {
      const candidate = state.candidates.get(candidateId);
      if (!candidate) {
        throw new Error(`candidate "${candidateId}" not found`);
      }
      return shadowExecutor.execute(
        candidateId,
        comparisonMetric,
        (input: unknown) => input,
        (input: unknown) => input,
        { candidateId, comparisonMetric },
      );
    },

    async test(candidateId: string, _scenariosPath: string): Promise<CandidateEvidenceV1[]> {
      const candidate = state.candidates.get(candidateId);
      if (!candidate) {
        throw new Error(`candidate "${candidateId}" not found`);
      }
      throw new Error(
        `evolution.candidate.test not implemented: scenario loading from "${_scenariosPath}" is not yet wired`,
      );
    },

    async canary(candidateId: string, trafficPercent: number): Promise<void> {
      const candidate = state.candidates.get(candidateId);
      if (!candidate) {
        throw new Error(`candidate "${candidateId}" not found`);
      }
      const updated: CapabilityCandidateV1 = {
        ...candidate,
        canaryTrafficPercent: trafficPercent,
      };
      state.candidates.set(candidateId, updated);
    },

    async activate(candidateId: string): Promise<void> {
      const candidate = state.candidates.get(candidateId);
      if (!candidate) {
        throw new Error(`candidate "${candidateId}" not found`);
      }
      const updated: CapabilityCandidateV1 = {
        ...candidate,
        stage: "active" as EvolutionStage,
      };
      state.candidates.set(candidateId, updated);
    },

    async promote(candidateId: string, _missionId: string): Promise<void> {
      const candidate = state.candidates.get(candidateId);
      if (!candidate) {
        throw new Error(`candidate "${candidateId}" not found`);
      }
      const updated: CapabilityCandidateV1 = {
        ...candidate,
        stage: "promoted" as EvolutionStage,
      };
      state.candidates.set(candidateId, updated);
    },

    async rollback(componentId: string): Promise<void> {
      for (const [cid, candidate] of state.candidates) {
        if (candidate.componentId === componentId && candidate.stage === "active") {
          const updated: CapabilityCandidateV1 = {
            ...candidate,
            stage: "rolled-back" as EvolutionStage,
          };
          state.candidates.set(cid, updated);
          return;
        }
      }
      throw new Error(`no active candidate found for component "${componentId}"`);
    },

    async quarantine(candidateId: string, reason: string): Promise<void> {
      const candidate = state.candidates.get(candidateId);
      if (!candidate) {
        throw new Error(`candidate "${candidateId}" not found`);
      }
      const updated: CapabilityCandidateV1 = {
        ...candidate,
        stage: "quarantined" as EvolutionStage,
      };
      state.candidates.set(candidateId, updated);
      healthMonitor.reset(candidateId);
    },

    inspectAll(): readonly CapabilityCandidateV1[] {
      return [...state.candidates.values()];
    },
  };
}
