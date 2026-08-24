import { describe, it, expect } from "vitest";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import {
  authorizeDeployment,
  verifyMainPromotion,
  evaluateRollback,
  evaluateCrashRecovery,
  buildDeploymentEffectRecord,
  gateFromChannel,
  isForceBypassRequested,
  DEPLOYMENT_GATE_REQUIREMENTS,
  type DeploymentAuthorizationInputV1,
  type MainVerificationInputV1,
  type RollbackEvaluationInputV1,
  type CrashRecoveryStateV1,
  type CertificationGate,
} from "../certification/deployment/authority.ts";
import type {
  GateDecisionV1,
  MainVerificationDecisionV1,
} from "../certification/contracts/decisions.ts";
import type { GateChannel } from "../certification/contracts/identifiers.ts";

const D = "sha256:0000000000000000000000000000000000000000000000000000000000000000" as string as Sha256Digest;
const D1 = "sha256:1111111111111111111111111111111111111111111111111111111111111111" as string as Sha256Digest;
const _D2 = "sha256:2222222222222222222222222222222222222222222222222222222222222222" as string as Sha256Digest;
const _D3 = "sha256:3333333333333333333333333333333333333333333333333333333333333333" as string as Sha256Digest;
const TS = "2026-08-15T12:00:00Z";

function mkGateDecision(
  candidateId: string = "cand-001",
  status: "pass" | "fail" | "stale" | "incomplete" | "blocked" | "waived" = "pass",
  gate: "dev" | "alt" | "main" = "dev",
): GateDecisionV1 {
  return {
    schema: "werkstatt/gate-decision@1",
    decisionId: "dec-test-001",
    candidateId,
    policyBundleRoot: D,
    gate,
    evaluationCut: 1,
    selectedEvidence: [],
    status,
    coverage: {
      schema: "werkstatt/coverage-report@1",
      totalRequirements: 10,
      coveredRequirements: 10,
      uncoveredRequirements: [],
    },
    reasons: [],
    actionPackRef: null,
    decidedAt: TS,
  };
}

function mkMainVerificationDecision(
  candidateId: string = "cand-001",
  status: "pass" | "fail" | "stale" | "incomplete" | "blocked" | "waived" = "pass",
): MainVerificationDecisionV1 {
  return {
    schema: "werkstatt/main-verification-decision@1",
    decisionId: "dec-main-001",
    candidateId,
    policyBundleRoot: D,
    gate: "main",
    evaluationCut: 1,
    selectedEvidence: [],
    status,
    coverage: {
      schema: "werkstatt/coverage-report@1",
      totalRequirements: 10,
      coveredRequirements: 10,
      uncoveredRequirements: [],
    },
    reasons: [],
    actionPackRef: null,
    rootDossierRef: D1,
    priorOperationRef: null,
    decidedAt: TS,
  };
}

function mkAuthInput(
  overrides: Partial<DeploymentAuthorizationInputV1> = {},
): DeploymentAuthorizationInputV1 {
  return {
    candidateId: "cand-001",
    gate: "dev-deploy",
    gateDecision: mkGateDecision(),
    durableSyncVerified: false,
    artifactReadinessVerified: true,
    artifactHash: D,
    forceRequested: false,
    skipRequested: false,
    waiverRequested: false,
    graceRequested: false,
    ...overrides,
  };
}

describe("DEPLOYMENT_GATE_REQUIREMENTS", () => {
  it("has exactly 3 gates", () => {
    expect(DEPLOYMENT_GATE_REQUIREMENTS).toHaveLength(3);
  });

  it("dev-deploy does not require durable sync", () => {
    const dev = DEPLOYMENT_GATE_REQUIREMENTS.find((r) => r.gate === "dev-deploy")!;
    expect(dev.requiresDurableSync).toBe(false);
    expect(dev.requiresMainVerification).toBe(false);
  });

  it("propagate-alt requires durable sync", () => {
    const alt = DEPLOYMENT_GATE_REQUIREMENTS.find((r) => r.gate === "propagate-alt")!;
    expect(alt.requiresDurableSync).toBe(true);
    expect(alt.requiresMainVerification).toBe(false);
  });

  it("promote-main requires durable sync and main verification", () => {
    const main = DEPLOYMENT_GATE_REQUIREMENTS.find((r) => r.gate === "promote-main")!;
    expect(main.requiresDurableSync).toBe(true);
    expect(main.requiresMainVerification).toBe(true);
  });

  it("no gate allows force, skip, waiver, or grace", () => {
    for (const req of DEPLOYMENT_GATE_REQUIREMENTS) {
      expect(req.allowsForce).toBe(false);
      expect(req.allowsSkip).toBe(false);
      expect(req.allowsWaiver).toBe(false);
      expect(req.allowsGrace).toBe(false);
    }
  });
});

describe("authorizeDeployment", () => {
  it("authorizes dev-deploy with pass and artifact readiness", () => {
    const result = authorizeDeployment(mkAuthInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authorized).toBe(true);
      expect(result.gate).toBe("dev-deploy");
      expect(result.channel).toBe("dev");
    }
  });

  it("authorizes propagate-alt with durable sync", () => {
    const result = authorizeDeployment(
      mkAuthInput({
        gate: "propagate-alt",
        durableSyncVerified: true,
        gateDecision: mkGateDecision("cand-001", "pass", "alt"),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.channel).toBe("alt");
      expect(result.requiresDurableSync).toBe(true);
    }
  });

  it("rejects propagate-alt without durable sync", () => {
    const result = authorizeDeployment(
      mkAuthInput({
        gate: "propagate-alt",
        durableSyncVerified: false,
        gateDecision: mkGateDecision("cand-001", "pass", "alt"),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-09");
    }
  });

  it("rejects unknown gate", () => {
    const result = authorizeDeployment(
      mkAuthInput({ gate: "unknown" as CertificationGate }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-01");
    }
  });

  it("rejects force flag", () => {
    const result = authorizeDeployment(mkAuthInput({ forceRequested: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-02");
    }
  });

  it("rejects skip flag", () => {
    const result = authorizeDeployment(mkAuthInput({ skipRequested: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-03");
    }
  });

  it("rejects waiver flag", () => {
    const result = authorizeDeployment(mkAuthInput({ waiverRequested: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-04");
    }
  });

  it("rejects grace flag", () => {
    const result = authorizeDeployment(mkAuthInput({ graceRequested: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-05");
    }
  });

  it("rejects candidate mismatch", () => {
    const result = authorizeDeployment(
      mkAuthInput({
        candidateId: "cand-001",
        gateDecision: mkGateDecision("cand-002"),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-06");
    }
  });

  it("rejects non-pass gate decision", () => {
    const result = authorizeDeployment(
      mkAuthInput({ gateDecision: mkGateDecision("cand-001", "fail") }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-07");
    }
  });

  it("rejects missing artifact readiness", () => {
    const result = authorizeDeployment(
      mkAuthInput({ artifactReadinessVerified: false }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-08");
    }
  });

  it("rejects stale gate decision", () => {
    const result = authorizeDeployment(
      mkAuthInput({ gateDecision: mkGateDecision("cand-001", "stale") }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-07");
    }
  });

  it("rejects incomplete gate decision", () => {
    const result = authorizeDeployment(
      mkAuthInput({ gateDecision: mkGateDecision("cand-001", "incomplete") }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-07");
    }
  });
});

describe("verifyMainPromotion", () => {
  function mkMainInput(
    overrides: Partial<MainVerificationInputV1> = {},
  ): MainVerificationInputV1 {
    return {
      candidateId: "cand-001",
      mainVerificationDecision: mkMainVerificationDecision(),
      durableSyncVerified: true,
      artifactHash: D,
      priorOperationRef: null,
      ...overrides,
    };
  }

  it("certifies main promotion with pass and durable sync", () => {
    const result = verifyMainPromotion(mkMainInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.certified).toBe(true);
      expect(result.candidateId).toBe("cand-001");
    }
  });

  it("rejects candidate mismatch", () => {
    const result = verifyMainPromotion(
      mkMainInput({
        candidateId: "cand-001",
        mainVerificationDecision: mkMainVerificationDecision("cand-002"),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-10");
    }
  });

  it("rejects non-pass main verification", () => {
    const result = verifyMainPromotion(
      mkMainInput({
        mainVerificationDecision: mkMainVerificationDecision("cand-001", "fail"),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-11");
    }
  });

  it("rejects without durable sync", () => {
    const result = verifyMainPromotion(
      mkMainInput({ durableSyncVerified: false }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-12");
    }
  });

  it("rejects stale main verification", () => {
    const result = verifyMainPromotion(
      mkMainInput({
        mainVerificationDecision: mkMainVerificationDecision("cand-001", "stale"),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DEPLOY-11");
    }
  });
});

describe("evaluateRollback", () => {
  function mkRollbackInput(
    overrides: Partial<RollbackEvaluationInputV1> = {},
  ): RollbackEvaluationInputV1 {
    return {
      candidateId: "cand-001",
      failedGate: "promote-main",
      rollbackCandidateId: "cand-000",
      rollbackArtifactHash: D1,
      rollbackArtifactReadinessVerified: true,
      sharedOutageDetected: false,
      ...overrides,
    };
  }

  it("authorizes rollback to verified candidate", () => {
    const result = evaluateRollback(mkRollbackInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rollbackAuthorized).toBe(true);
    }
  });

  it("denies rollback during shared outage", () => {
    const result = evaluateRollback(
      mkRollbackInput({ sharedOutageDetected: true }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rollbackAuthorized).toBe(false);
      expect(result.reason).toContain("shared infrastructure outage");
    }
  });

  it("denies rollback when artifact not ready", () => {
    const result = evaluateRollback(
      mkRollbackInput({ rollbackArtifactReadinessVerified: false }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rollbackAuthorized).toBe(false);
      expect(result.reason).toContain("not ready");
    }
  });

  it("denies rollback to same candidate", () => {
    const result = evaluateRollback(
      mkRollbackInput({ rollbackCandidateId: "cand-001" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rollbackAuthorized).toBe(false);
      expect(result.reason).toContain("same as the failed candidate");
    }
  });
});

describe("evaluateCrashRecovery", () => {
  function mkCrashState(
    overrides: Partial<CrashRecoveryStateV1> = {},
  ): CrashRecoveryStateV1 {
    return {
      operationId: "op-001",
      candidateId: "cand-001",
      channel: "main" as GateChannel,
      lastPersistedState: "deployed",
      artifactPersisted: true,
      trafficSwitched: false,
      verificationStarted: false,
      verificationCompleted: false,
      statePersisted: false,
      ...overrides,
    };
  }

  it("resumes verification when completed but state not persisted", () => {
    const result = evaluateCrashRecovery(
      mkCrashState({
        verificationCompleted: true,
        statePersisted: false,
        trafficSwitched: true,
        verificationStarted: true,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("resume-verification");
    }
  });

  it("starts verification when traffic switched but not started", () => {
    const result = evaluateCrashRecovery(
      mkCrashState({
        trafficSwitched: true,
        verificationStarted: false,
        verificationCompleted: false,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("resume-verification");
    }
  });

  it("resumes verification when started but not completed", () => {
    const result = evaluateCrashRecovery(
      mkCrashState({
        trafficSwitched: true,
        verificationStarted: true,
        verificationCompleted: false,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("resume-verification");
    }
  });

  it("proceeds to verification when artifact deployed but traffic not switched", () => {
    const result = evaluateCrashRecovery(
      mkCrashState({
        artifactPersisted: true,
        trafficSwitched: false,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("resume-verification");
    }
  });

  it("restarts deployment when artifact not persisted", () => {
    const result = evaluateCrashRecovery(
      mkCrashState({
        artifactPersisted: false,
        trafficSwitched: false,
        lastPersistedState: "authorized",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("restart-deployment");
    }
  });

  it("quarantines when rollback completed", () => {
    const result = evaluateCrashRecovery(
      mkCrashState({
        lastPersistedState: "rolled-back",
        artifactPersisted: true,
        trafficSwitched: true,
        verificationStarted: true,
        verificationCompleted: true,
        statePersisted: true,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("quarantine");
    }
  });
});

describe("buildDeploymentEffectRecord", () => {
  it("creates a record with correct schema and hash", () => {
    const record = buildDeploymentEffectRecord(
      "op-001",
      "cand-001",
      "dev-deploy",
      "dev",
      D,
      "dec-001",
      false,
      null,
      "deployed",
      TS,
    );
    expect(record.schema).toBe("werkstatt/deployment-effect-record@1");
    expect(record.operationId).toBe("op-001");
    expect(record.candidateId).toBe("cand-001");
    expect(record.gate).toBe("dev-deploy");
    expect(record.channel).toBe("dev");
    expect(record.effectHash).toBeTruthy();
  });

  it("produces deterministic hash for same input", () => {
    const r1 = buildDeploymentEffectRecord(
      "op-001", "cand-001", "dev-deploy", "dev", D, "dec-001", false, null, "deployed", TS,
    );
    const r2 = buildDeploymentEffectRecord(
      "op-001", "cand-001", "dev-deploy", "dev", D, "dec-001", false, null, "deployed", TS,
    );
    expect(r1.effectHash).toBe(r2.effectHash);
  });

  it("produces different hash for different input", () => {
    const r1 = buildDeploymentEffectRecord(
      "op-001", "cand-001", "dev-deploy", "dev", D, "dec-001", false, null, "deployed", TS,
    );
    const r2 = buildDeploymentEffectRecord(
      "op-002", "cand-001", "dev-deploy", "dev", D, "dec-001", false, null, "deployed", TS,
    );
    expect(r1.effectHash).not.toBe(r2.effectHash);
  });
});

describe("gateFromChannel", () => {
  it("maps dev to dev-deploy", () => {
    expect(gateFromChannel("dev")).toBe("dev-deploy");
  });

  it("maps alt to propagate-alt", () => {
    expect(gateFromChannel("alt")).toBe("propagate-alt");
  });

  it("maps main to promote-main", () => {
    expect(gateFromChannel("main")).toBe("promote-main");
  });
});

describe("isForceBypassRequested", () => {
  it("returns false when no bypass flags are set", () => {
    expect(
      isForceBypassRequested({
        forceRequested: false,
        skipRequested: false,
        waiverRequested: false,
        graceRequested: false,
      }),
    ).toBe(false);
  });

  it("returns true when force is requested", () => {
    expect(
      isForceBypassRequested({
        forceRequested: true,
        skipRequested: false,
        waiverRequested: false,
        graceRequested: false,
      }),
    ).toBe(true);
  });

  it("returns true when skip is requested", () => {
    expect(
      isForceBypassRequested({
        forceRequested: false,
        skipRequested: true,
        waiverRequested: false,
        graceRequested: false,
      }),
    ).toBe(true);
  });
});
