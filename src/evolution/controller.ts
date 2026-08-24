import type { Sha256Digest } from "../fingerprint/primitives.ts";
import type {
  CapabilityCandidateV1,
  TransitionRequestV1,
  TransitionRecordV1,
  InspectionSnapshotV1,
  BoundedIntentV1,
  KillSwitchStateV1,
  EvolutionStage,
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

export interface EvolutionControllerV1 {
  inspect(snapshot: InspectionSnapshotV1): InspectionOutcomeV1;
  defineCandidate(
    snapshot: InspectionSnapshotV1,
    intent: BoundedIntentV1,
    artifactHash: Sha256Digest,
    parentArtifactHash: Sha256Digest,
    policyHash: Sha256Digest,
  ): DefineCandidateOutcomeV1;
  requestTransition(request: TransitionRequestV1, timestamp: string): TransitionOutcomeV1;
  activateKillSwitch(reason: string, timestamp: string): void;
  getCandidate(candidateId: string): CapabilityCandidateV1 | null;
  getCandidateHistory(candidateId: string): readonly TransitionRecordV1[];
  getKillSwitchState(): KillSwitchStateV1;
  getAllTransitions(): readonly TransitionRecordV1[];
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
): EvolutionControllerV1 {
  const state: ReducerStateV1 = createEvolutionReducerState();
  let killSwitch: KillSwitchStateV1 = {
    active: false,
    reason: "",
    activatedAt: "",
  };

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
    ): DefineCandidateOutcomeV1 {
      const boundaryCheck = checkSelfChangeBoundary(intent);
      if (!boundaryCheck.ok) {
        return {
          ok: false,
          ruleId: boundaryCheck.ruleId,
          message: boundaryCheck.message,
        };
      }

      const candidateId = `cand-${artifactHash.slice(7, 19)}`;
      const candidate: CapabilityCandidateV1 = {
        schema: "werkstatt/capability-candidate@1",
        candidateId,
        parentArtifactHash,
        artifactHash,
        intentHash: intent.intentHash,
        policyHash,
        stage: "defined" as EvolutionStage,
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
  };
}
