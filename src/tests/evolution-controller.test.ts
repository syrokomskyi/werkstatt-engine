import { describe, it, expect } from "vitest";
import { byteHash } from "../fingerprint/primitives.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import { createEvolutionController } from "../evolution/controller.ts";
import {
  createEvolutionReducerState,
  applyTransition,
  registerCandidate,
  activateKillSwitch,
  getCandidate,
  getCandidateHistory,
} from "../evolution/reducer.ts";
import {
  checkSelfChangeBoundary,
  checkEvidenceImmutability,
  checkKillSwitch,
  checkAuthorityExpiry,
  checkShadowSideEffects,
  checkCanaryBoundaries,
  checkEvidencePoisoning,
  runAllGuards,
} from "../evolution/guards.ts";
import {
  isForwardTransition,
  isTerminalStage,
  FORWARD_ONLY_SEQUENCE,
} from "../evolution/contracts.ts";
import type {
  CapabilityCandidateV1,
  EvolutionEvidenceBundleV1,
  TransitionRequestV1,
  InspectionSnapshotV1,
  BoundedIntentV1,
  KillSwitchStateV1,
  EvolutionStage,
  DefinitionEvidenceV1,
  EvaluationEvidenceV1,
  ObservationEvidenceV1,
  AuthorityEvidenceV1,
  ArtifactEvidenceV1,
} from "../evolution/contracts.ts";

const D =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000" as string as Sha256Digest;
const D1 =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111" as string as Sha256Digest;
const D2 =
  "sha256:2222222222222222222222222222222222222222222222222222222222222222" as string as Sha256Digest;
const D3 =
  "sha256:3333333333333333333333333333333333333333333333333333333333333333" as string as Sha256Digest;
const D4 =
  "sha256:4444444444444444444444444444444444444444444444444444444444444444" as string as Sha256Digest;
const _D5 =
  "sha256:5555555555555555555555555555555555555555555555555555555555555555" as string as Sha256Digest;
const D6 =
  "sha256:6666666666666666666666666666666666666666666666666666666666666666" as string as Sha256Digest;
const D7 =
  "sha256:7777777777777777777777777777777777777777777777777777777777777777" as string as Sha256Digest;
const D8 =
  "sha256:8888888888888888888888888888888888888888888888888888888888888888" as string as Sha256Digest;
const _D9 =
  "sha256:9999999999999999999999999999999999999999999999999999999999999999" as string as Sha256Digest;
const _DA =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as string as Sha256Digest;
const TS = "2026-08-15T12:00:00Z";
const TS_FUTURE = "2026-08-16T12:00:00Z";

function mkDefinition(): DefinitionEvidenceV1 {
  return {
    schema: "werkstatt/definition-evidence@1",
    intentDescription: "improve performance",
    scope: "compute",
    generatedDiffHash: D,
    sourceHash: D1,
    constraints: ["no breaking changes"],
    lineageParentHash: D2,
    evidenceHash: D3,
  };
}

function mkEvaluation(allPass: boolean = true): EvaluationEvidenceV1 {
  return {
    schema: "werkstatt/evaluation-evidence@1",
    deterministicFixturesPassed: allPass,
    conformancePassed: allPass,
    securityPassed: allPass,
    performancePassed: allPass,
    regressionPassed: allPass,
    differentialResults: [
      { metric: "latency", baseline: 100, candidate: 90, delta: -10, passed: allPass },
    ],
    evidenceHash: D4,
  };
}

function mkObservation(exposure: "shadow" | "canary" = "shadow"): ObservationEvidenceV1 {
  return {
    schema: "werkstatt/observation-evidence@1",
    workloadId: "wl-001",
    exposure,
    duration: 60,
    sampleSize: 200,
    segmentedMetrics: [
      { segment: "all", metric: "latency", value: 90, threshold: 100, passed: true },
    ],
    incidents: [],
    noveltyScore: 0.1,
    uncertaintyScore: 0.1,
    evidenceHash: D7,
  };
}

function mkAuthority(allowedTransition: EvolutionStage = "tested"): AuthorityEvidenceV1 {
  return {
    schema: "werkstatt/authority-evidence@1",
    lawKernelDecisionHash: D,
    actorId: "actor-001",
    policyVersion: "1.0.0",
    allowedTransition,
    expiry: TS_FUTURE,
    killSwitchActive: false,
    evidenceHash: D6,
  };
}

function mkArtifact(
  candidateHash: Sha256Digest = D,
  parentHash: Sha256Digest = D2,
): ArtifactEvidenceV1 {
  return {
    schema: "werkstatt/artifact-evidence@1",
    candidateHash,
    parentHash,
    sandboxAdmissionHash: D1,
    dependencyHashes: [],
    provenanceHash: D3,
    signatureHash: D4,
    evidenceHash: D8,
  };
}

function mkEvidence(
  candidateHash: Sha256Digest = D,
  parentHash: Sha256Digest = D2,
  exposure: "shadow" | "canary" = "shadow",
): EvolutionEvidenceBundleV1 {
  const def = mkDefinition();
  const eval_ = mkEvaluation();
  const obs = mkObservation(exposure);
  const auth = mkAuthority();
  const art = mkArtifact(candidateHash, parentHash);
  const bundleHash = byteHash(
    JSON.stringify({
      definition: def.evidenceHash,
      evaluation: eval_.evidenceHash,
      observation: obs.evidenceHash,
      authority: auth.evidenceHash,
      artifact: art.evidenceHash,
    }),
  ) as Sha256Digest;
  return {
    schema: "werkstatt/evolution-evidence-bundle@1",
    definition: def,
    evaluation: eval_,
    observation: obs,
    authority: auth,
    artifact: art,
    bundleHash,
  };
}

function mkCandidate(
  artifactHash: Sha256Digest = D,
  parentHash: Sha256Digest = D2,
): CapabilityCandidateV1 {
  return {
    schema: "werkstatt/capability-candidate@1",
    candidateId: "cand-001",
    parentArtifactHash: parentHash,
    artifactHash,
    intentHash: D3,
    policyHash: D4,
    stage: "defined",
  };
}

function mkTransitionRequest(
  candidateId: string = "cand-001",
  fromStage: EvolutionStage = "defined",
  toStage: EvolutionStage = "tested",
  evidence?: EvolutionEvidenceBundleV1,
  seq: number = 0,
): TransitionRequestV1 {
  return {
    schema: "werkstatt/evolution-transition-request@1",
    candidateId,
    fromStage,
    toStage,
    evidence: evidence ?? mkEvidence(),
    idempotencyKey: `key-${candidateId}-${seq}`,
    sequenceNumber: seq,
  };
}

function mkSnapshot(): InspectionSnapshotV1 {
  return {
    schema: "werkstatt/inspection-snapshot@1",
    currentArtifactHash: D,
    observedMetrics: [
      { segment: "all", metric: "latency", value: 100, threshold: 100, passed: true },
    ],
    activeIncidents: [],
    snapshotHash: D1,
  };
}

function mkIntent(scope: string = "compute"): BoundedIntentV1 {
  return {
    schema: "werkstatt/bounded-intent@1",
    intentId: "intent-001",
    description: "improve performance",
    scope,
    constraints: ["no breaking changes"],
    intentHash: D3,
  };
}

describe("contracts", () => {
  it("forward-only sequence has 5 stages", () => {
    expect(FORWARD_ONLY_SEQUENCE).toHaveLength(5);
    expect(FORWARD_ONLY_SEQUENCE[0]).toBe("defined");
    expect(FORWARD_ONLY_SEQUENCE[4]).toBe("promoted");
  });

  it("isForwardTransition allows sequential forward", () => {
    expect(isForwardTransition("defined", "tested")).toBe(true);
    expect(isForwardTransition("tested", "shadowed")).toBe(true);
    expect(isForwardTransition("shadowed", "canary")).toBe(true);
    expect(isForwardTransition("canary", "promoted")).toBe(true);
  });

  it("isForwardTransition rejects skips", () => {
    expect(isForwardTransition("defined", "shadowed")).toBe(false);
    expect(isForwardTransition("defined", "canary")).toBe(false);
  });

  it("isForwardTransition allows rollback and quarantine from any stage", () => {
    expect(isForwardTransition("canary", "rolled-back")).toBe(true);
    expect(isForwardTransition("promoted", "rolled-back")).toBe(true);
    expect(isForwardTransition("tested", "quarantined")).toBe(true);
  });

  it("isForwardTransition rejects backward non-rollback", () => {
    expect(isForwardTransition("tested", "defined")).toBe(false);
    expect(isForwardTransition("canary", "tested")).toBe(false);
  });

  it("isTerminalStage identifies terminal stages", () => {
    expect(isTerminalStage("promoted")).toBe(true);
    expect(isTerminalStage("rolled-back")).toBe(true);
    expect(isTerminalStage("quarantined")).toBe(true);
    expect(isTerminalStage("defined")).toBe(false);
    expect(isTerminalStage("canary")).toBe(false);
  });
});

describe("reducer", () => {
  it("registers a new candidate at defined stage", () => {
    const state = createEvolutionReducerState();
    const result = registerCandidate(state, mkCandidate());
    expect(result.ok).toBe(true);
    expect(getCandidate(state, "cand-001")).not.toBeNull();
  });

  it("rejects duplicate candidate registration", () => {
    const state = createEvolutionReducerState();
    registerCandidate(state, mkCandidate());
    const result = registerCandidate(state, mkCandidate());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVO-09");
    }
  });

  it("rejects candidate not starting at defined", () => {
    const state = createEvolutionReducerState();
    const result = registerCandidate(state, { ...mkCandidate(), stage: "tested" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVO-10");
    }
  });

  it("applies forward transition defined → tested", () => {
    const state = createEvolutionReducerState();
    registerCandidate(state, mkCandidate());
    const result = applyTransition(state, mkTransitionRequest("cand-001", "defined", "tested"), TS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updatedCandidate.stage).toBe("tested");
      expect(result.record.decision).toBe("admit");
    }
  });

  it("rejects transition for non-existent candidate", () => {
    const state = createEvolutionReducerState();
    const result = applyTransition(state, mkTransitionRequest("unknown"), TS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVO-02");
    }
  });

  it("rejects stage mismatch", () => {
    const state = createEvolutionReducerState();
    registerCandidate(state, mkCandidate());
    const result = applyTransition(
      state,
      mkTransitionRequest("cand-001", "tested", "shadowed"),
      TS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVO-03");
    }
  });

  it("rejects invalid forward transition", () => {
    const state = createEvolutionReducerState();
    registerCandidate(state, mkCandidate());
    const result = applyTransition(
      state,
      mkTransitionRequest("cand-001", "defined", "shadowed"),
      TS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVO-05");
    }
  });

  it("rejects sequence mismatch", () => {
    const state = createEvolutionReducerState();
    registerCandidate(state, mkCandidate());
    const result = applyTransition(
      state,
      mkTransitionRequest("cand-001", "defined", "tested", undefined, 5),
      TS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVO-06");
    }
  });

  it("rejects duplicate idempotency key", () => {
    const state = createEvolutionReducerState();
    registerCandidate(state, mkCandidate());
    const req = mkTransitionRequest("cand-001", "defined", "tested");
    applyTransition(state, req, TS);
    const result = applyTransition(state, req, TS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVO-07");
    }
  });

  it("rejects transition when kill switch is active", () => {
    const state = createEvolutionReducerState();
    registerCandidate(state, mkCandidate());
    activateKillSwitch(state, "emergency", TS);
    const result = applyTransition(state, mkTransitionRequest(), TS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVO-01");
    }
  });

  it("rejects promotion with missing evaluation evidence", () => {
    const state = createEvolutionReducerState();
    registerCandidate(state, mkCandidate());
    applyTransition(state, mkTransitionRequest("cand-001", "defined", "tested"), TS);
    applyTransition(
      state,
      mkTransitionRequest("cand-001", "tested", "shadowed", mkEvidence(D, D2, "shadow"), 1),
      TS,
    );
    applyTransition(
      state,
      mkTransitionRequest("cand-001", "shadowed", "canary", mkEvidence(D, D2, "canary"), 2),
      TS,
    );

    const badEvidence = mkEvidence(D, D2, "canary");
    badEvidence.evaluation = mkEvaluation(false);
    const result = applyTransition(
      state,
      mkTransitionRequest("cand-001", "canary", "promoted", badEvidence, 3),
      TS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVO-08");
    }
  });

  it("rollback creates compensating action", () => {
    const state = createEvolutionReducerState();
    registerCandidate(state, mkCandidate());
    applyTransition(state, mkTransitionRequest("cand-001", "defined", "tested"), TS);
    const rollbackEvidence = mkEvidence();
    const result = applyTransition(
      state,
      mkTransitionRequest("cand-001", "tested", "rolled-back", rollbackEvidence, 1),
      TS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.compensatingAction).not.toBeNull();
      expect(result.record.compensatingAction?.action).toBe("rollback");
    }
  });

  it("quarantine creates compensating action", () => {
    const state = createEvolutionReducerState();
    registerCandidate(state, mkCandidate());
    applyTransition(state, mkTransitionRequest("cand-001", "defined", "tested"), TS);
    const result = applyTransition(
      state,
      mkTransitionRequest("cand-001", "tested", "quarantined", mkEvidence(), 1),
      TS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.compensatingAction?.action).toBe("quarantine");
    }
  });

  it("getCandidateHistory returns transitions for candidate", () => {
    const state = createEvolutionReducerState();
    registerCandidate(state, mkCandidate());
    applyTransition(state, mkTransitionRequest("cand-001", "defined", "tested"), TS);
    expect(getCandidateHistory(state, "cand-001")).toHaveLength(1);
  });

  it("rejects transition from terminal stage", () => {
    const state = createEvolutionReducerState();
    registerCandidate(state, mkCandidate());
    applyTransition(state, mkTransitionRequest("cand-001", "defined", "tested"), TS);
    applyTransition(
      state,
      mkTransitionRequest("cand-001", "tested", "rolled-back", mkEvidence(), 1),
      TS,
    );
    const result = applyTransition(
      state,
      mkTransitionRequest("cand-001", "rolled-back", "promoted", mkEvidence(), 2),
      TS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVO-04");
    }
  });
});

describe("guards", () => {
  it("checkSelfChangeBoundary rejects forbidden scopes", () => {
    expect(checkSelfChangeBoundary(mkIntent("law-kernel")).ok).toBe(false);
    expect(checkSelfChangeBoundary(mkIntent("permissions")).ok).toBe(false);
    expect(checkSelfChangeBoundary(mkIntent("effect-policy")).ok).toBe(false);
    expect(checkSelfChangeBoundary(mkIntent("isolation-contract")).ok).toBe(false);
    expect(checkSelfChangeBoundary(mkIntent("controller-code")).ok).toBe(false);
    expect(checkSelfChangeBoundary(mkIntent("evaluator-policy")).ok).toBe(false);
  });

  it("checkSelfChangeBoundary allows safe scopes", () => {
    expect(checkSelfChangeBoundary(mkIntent("compute")).ok).toBe(true);
  });

  it("checkEvidenceImmutability rejects hash mismatch", () => {
    const candidate = mkCandidate(D, D2);
    const evidence = mkEvidence(D1, D2);
    expect(checkEvidenceImmutability(candidate, evidence).ok).toBe(false);
  });

  it("checkEvidenceImmutability rejects parent hash mismatch", () => {
    const candidate = mkCandidate(D, D2);
    const evidence = mkEvidence(D, D1);
    expect(checkEvidenceImmutability(candidate, evidence).ok).toBe(false);
  });

  it("checkKillSwitch denies when active", () => {
    const ks: KillSwitchStateV1 = { active: true, reason: "emergency", activatedAt: TS };
    expect(checkKillSwitch(ks).ok).toBe(false);
  });

  it("checkKillSwitch allows when inactive", () => {
    const ks: KillSwitchStateV1 = { active: false, reason: "", activatedAt: "" };
    expect(checkKillSwitch(ks).ok).toBe(true);
  });

  it("checkAuthorityExpiry rejects expired authority", () => {
    const evidence = mkEvidence();
    evidence.authority = { ...evidence.authority, expiry: "2026-01-01T00:00:00Z" };
    expect(checkAuthorityExpiry(evidence, TS).ok).toBe(false);
  });

  it("checkShadowSideEffects rejects critical incidents in shadow", () => {
    const evidence = mkEvidence(D, D2, "shadow");
    evidence.observation = {
      ...evidence.observation,
      incidents: [
        { incidentId: "inc-001", severity: "critical", description: "side effect", timestamp: TS },
      ],
    };
    expect(checkShadowSideEffects(evidence).ok).toBe(false);
  });

  it("checkCanaryBoundaries rejects excessive duration", () => {
    const evidence = mkEvidence(D, D2, "canary");
    evidence.observation = { ...evidence.observation, duration: 7200 };
    expect(checkCanaryBoundaries(evidence, 3600, 100).ok).toBe(false);
  });

  it("checkCanaryBoundaries rejects insufficient sample", () => {
    const evidence = mkEvidence(D, D2, "canary");
    evidence.observation = { ...evidence.observation, sampleSize: 10 };
    expect(checkCanaryBoundaries(evidence, 3600, 100).ok).toBe(false);
  });

  it("checkCanaryBoundaries rejects high uncertainty", () => {
    const evidence = mkEvidence(D, D2, "canary");
    evidence.observation = { ...evidence.observation, uncertaintyScore: 0.5 };
    expect(checkCanaryBoundaries(evidence, 3600, 100).ok).toBe(false);
  });

  it("checkEvidencePoisoning detects bundle hash mismatch", () => {
    const evidence = mkEvidence();
    evidence.bundleHash = D6;
    expect(checkEvidencePoisoning(evidence).ok).toBe(false);
  });

  it("runAllGuards passes for valid evidence", () => {
    const candidate = mkCandidate(D, D2);
    const request = mkTransitionRequest();
    const ks: KillSwitchStateV1 = { active: false, reason: "", activatedAt: "" };
    const result = runAllGuards(candidate, request, ks, TS, 3600, 100);
    expect(result.ok).toBe(true);
  });

  it("runAllGuards fails on kill switch", () => {
    const candidate = mkCandidate(D, D2);
    const request = mkTransitionRequest();
    const ks: KillSwitchStateV1 = { active: true, reason: "emergency", activatedAt: TS };
    const result = runAllGuards(candidate, request, ks, TS, 3600, 100);
    expect(result.ok).toBe(false);
    expect(result.ruleId).toBe("CERT-EVO-GUARD-04");
  });
});

describe("controller", () => {
  it("inspects a snapshot and returns observations", () => {
    const controller = createEvolutionController();
    const result = controller.inspect(mkSnapshot());
    expect(result.ok).toBe(true);
  });

  it("defines a candidate from inspection and intent", () => {
    const controller = createEvolutionController();
    const result = controller.defineCandidate(mkSnapshot(), mkIntent(), D, D2, D4);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidate.stage).toBe("defined");
    }
  });

  it("rejects candidate definition for forbidden scope", () => {
    const controller = createEvolutionController();
    const result = controller.defineCandidate(mkSnapshot(), mkIntent("law-kernel"), D, D2, D4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVO-GUARD-01");
    }
  });

  it("requests transition through controller", () => {
    const controller = createEvolutionController();
    controller.defineCandidate(mkSnapshot(), mkIntent(), D, D2, D4);
    const result = controller.requestTransition(
      mkTransitionRequest("cand-000000000000", "defined", "tested", mkEvidence(D, D2)),
      TS,
    );
    expect(result.ok).toBe(true);
  });

  it("kill switch denies all transitions", () => {
    const controller = createEvolutionController();
    controller.defineCandidate(mkSnapshot(), mkIntent(), D, D2, D4);
    controller.activateKillSwitch("emergency", TS);
    const result = controller.requestTransition(
      mkTransitionRequest("cand-000000000000", "defined", "tested", mkEvidence(D, D2)),
      TS,
    );
    expect(result.ok).toBe(false);
  });

  it("getCandidate returns registered candidate", () => {
    const controller = createEvolutionController();
    controller.defineCandidate(mkSnapshot(), mkIntent(), D, D2, D4);
    const candidate = controller.getCandidate("cand-000000000000");
    expect(candidate).not.toBeNull();
  });

  it("getCandidateHistory returns transitions", () => {
    const controller = createEvolutionController();
    controller.defineCandidate(mkSnapshot(), mkIntent(), D, D2, D4);
    controller.requestTransition(
      mkTransitionRequest("cand-000000000000", "defined", "tested", mkEvidence(D, D2)),
      TS,
    );
    expect(controller.getCandidateHistory("cand-000000000000")).toHaveLength(1);
  });

  it("getKillSwitchState returns current state", () => {
    const controller = createEvolutionController();
    expect(controller.getKillSwitchState().active).toBe(false);
  });
});
