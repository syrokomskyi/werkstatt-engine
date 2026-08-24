import { describe, it, expect } from "vitest";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import {
  evaluateHealth,
  shouldRevoke,
  classifyDriftCause,
  evaluateScheduleWindow,
  buildHealthDecision,
  buildHealthProjection,
  evaluateMonitorRecovery,
  isHealthTransitionValid,
  type HealthEvaluationInputV1,
  type HealthRequirementResultV1,
  type ScheduleWindowV1,
  type MonitorRecoveryStateV1,
} from "../certification/health/monitor.ts";

const _D =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000" as string as Sha256Digest;
const _D1 =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111" as string as Sha256Digest;
const TS = "2026-08-15T12:00:00Z";
const TS2 = "2026-08-15T13:00:00Z";

function mkReqResult(
  overrides: Partial<HealthRequirementResultV1> = {},
): HealthRequirementResultV1 {
  return {
    requirementId: "req-001",
    status: "pass",
    evidenceId: "ev-001",
    evidenceExpired: false,
    ttlExceeded: false,
    observedAt: TS,
    ...overrides,
  };
}

function mkHealthInput(overrides: Partial<HealthEvaluationInputV1> = {}): HealthEvaluationInputV1 {
  return {
    candidateId: "cand-001",
    assessedAt: TS,
    previousHealth: "current",
    requirementResults: [mkReqResult()],
    sharedOutageDetected: false,
    rollbackCandidateAvailable: true,
    rollbackCandidateId: "cand-000",
    profileDriftAction: "rollback",
    scheduleWindowId: "win-001",
    priorOperationId: null,
    ...overrides,
  };
}

describe("evaluateHealth", () => {
  it("returns current when all requirements pass", () => {
    const result = evaluateHealth(mkHealthInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.health).toBe("current");
      expect(result.triggeringRequirementIds).toHaveLength(0);
    }
  });

  it("returns degraded when any requirement fails", () => {
    const result = evaluateHealth(
      mkHealthInput({
        requirementResults: [
          mkReqResult({ requirementId: "req-001", status: "pass" }),
          mkReqResult({ requirementId: "req-002", status: "fail" }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.health).toBe("degraded");
      expect(result.triggeringRequirementIds).toContain("req-002");
      expect(result.action).toBe("rollback");
    }
  });

  it("uses incident-only action during shared outage", () => {
    const result = evaluateHealth(
      mkHealthInput({
        sharedOutageDetected: true,
        requirementResults: [mkReqResult({ requirementId: "req-001", status: "fail" })],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.health).toBe("degraded");
      expect(result.action).toBe("incident-only");
      expect(result.incidentId).toBeTruthy();
    }
  });

  it("returns degraded with retry for stale requirements", () => {
    const result = evaluateHealth(
      mkHealthInput({
        requirementResults: [mkReqResult({ requirementId: "req-001", status: "stale" })],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.health).toBe("degraded");
      expect(result.action).toBe("retry");
    }
  });

  it("returns degraded with retry for expired evidence", () => {
    const result = evaluateHealth(
      mkHealthInput({
        requirementResults: [
          mkReqResult({ requirementId: "req-001", status: "pass", evidenceExpired: true }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.health).toBe("degraded");
      expect(result.action).toBe("retry");
    }
  });

  it("returns degraded with retry for TTL exceeded", () => {
    const result = evaluateHealth(
      mkHealthInput({
        requirementResults: [
          mkReqResult({ requirementId: "req-001", status: "pass", ttlExceeded: true }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.health).toBe("degraded");
      expect(result.action).toBe("retry");
    }
  });

  it("returns degraded with retry for incomplete requirements", () => {
    const result = evaluateHealth(
      mkHealthInput({
        requirementResults: [mkReqResult({ requirementId: "req-001", status: "incomplete" })],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.health).toBe("degraded");
      expect(result.action).toBe("retry");
      expect(result.incidentId).toBeNull();
    }
  });

  it("rejects empty requirement results", () => {
    const result = evaluateHealth(mkHealthInput({ requirementResults: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-HEALTH-01");
    }
  });

  it("uses incident-only for stale during shared outage", () => {
    const result = evaluateHealth(
      mkHealthInput({
        sharedOutageDetected: true,
        requirementResults: [mkReqResult({ requirementId: "req-001", status: "stale" })],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.action).toBe("incident-only");
      expect(result.incidentId).toBeTruthy();
    }
  });
});

describe("shouldRevoke", () => {
  it("does not revoke when current", () => {
    expect(shouldRevoke("current", 5, 3)).toBe(false);
  });

  it("does not revoke when degraded below threshold", () => {
    expect(shouldRevoke("degraded", 2, 3)).toBe(false);
  });

  it("revokes when degraded at threshold", () => {
    expect(shouldRevoke("degraded", 3, 3)).toBe(true);
  });

  it("revokes when degraded above threshold", () => {
    expect(shouldRevoke("degraded", 5, 3)).toBe(true);
  });

  it("does not revoke when already revoked", () => {
    expect(shouldRevoke("revoked", 10, 3)).toBe(false);
  });
});

describe("classifyDriftCause", () => {
  it("classifies shared outage", () => {
    expect(classifyDriftCause(mkReqResult(), true)).toBe("shared-infrastructure-outage");
  });

  it("classifies expired evidence", () => {
    expect(classifyDriftCause(mkReqResult({ evidenceExpired: true }), false)).toBe(
      "expired-evidence",
    );
  });

  it("classifies TTL exceeded", () => {
    expect(classifyDriftCause(mkReqResult({ ttlExceeded: true }), false)).toBe("expired-evidence");
  });

  it("classifies candidate regression", () => {
    expect(classifyDriftCause(mkReqResult({ status: "fail" }), false)).toBe(
      "candidate-specific-regression",
    );
  });

  it("classifies public output drift", () => {
    expect(classifyDriftCause(mkReqResult({ status: "stale" }), false)).toBe("public-output-drift");
  });

  it("classifies late evidence", () => {
    expect(classifyDriftCause(mkReqResult({ status: "incomplete" }), false)).toBe("late-evidence");
  });
});

describe("evaluateScheduleWindow", () => {
  function mkWindow(overrides: Partial<ScheduleWindowV1> = {}): ScheduleWindowV1 {
    return {
      windowId: "win-001",
      startedAt: TS,
      completedAt: null,
      operationId: "op-001",
      candidateId: "cand-001",
      effective: true,
      ...overrides,
    };
  }

  it("marks new window as effective", () => {
    const result = evaluateScheduleWindow(mkWindow(), []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effective).toBe(true);
    }
  });

  it("rejects duplicate window", () => {
    const prior = mkWindow({ completedAt: TS });
    const result = evaluateScheduleWindow(mkWindow(), [prior]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effective).toBe(false);
      expect(result.reason).toContain("duplicate");
    }
  });

  it("rejects late delivery", () => {
    const prior = mkWindow({
      windowId: "win-000",
      startedAt: TS,
      completedAt: TS2,
    });
    const result = evaluateScheduleWindow(mkWindow({ startedAt: TS }), [prior]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effective).toBe(false);
      expect(result.reason).toContain("late delivery");
    }
  });

  it("allows new window after prior completed", () => {
    const prior = mkWindow({
      windowId: "win-000",
      startedAt: TS,
      completedAt: TS,
    });
    const result = evaluateScheduleWindow(mkWindow({ windowId: "win-001", startedAt: TS2 }), [
      prior,
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effective).toBe(true);
    }
  });
});

describe("buildHealthDecision", () => {
  it("builds a valid health decision", () => {
    const decision = buildHealthDecision({
      candidateId: "cand-001",
      currentStatus: "pass",
      lastDecisionId: "dec-001",
      lastDecisionAt: TS,
      staleEvidenceCount: 0,
      incompleteCount: 0,
      assessedAt: TS,
    });
    expect(decision.schema).toBe("werkstatt/certification-health-decision@1");
    expect(decision.candidateId).toBe("cand-001");
    expect(decision.currentStatus).toBe("pass");
    expect(decision.staleEvidenceCount).toBe(0);
  });

  it("builds a degraded health decision", () => {
    const decision = buildHealthDecision({
      candidateId: "cand-001",
      currentStatus: "fail",
      lastDecisionId: null,
      lastDecisionAt: null,
      staleEvidenceCount: 3,
      incompleteCount: 1,
      assessedAt: TS,
    });
    expect(decision.currentStatus).toBe("fail");
    expect(decision.staleEvidenceCount).toBe(3);
    expect(decision.incompleteCount).toBe(1);
  });
});

describe("buildHealthProjection", () => {
  it("builds a projection with deterministic hash", () => {
    const p1 = buildHealthProjection("cand-001", "current", "dec-001", TS, [], 0, TS);
    const p2 = buildHealthProjection("cand-001", "current", "dec-001", TS, [], 0, TS);
    expect(p1.schema).toBe("werkstatt/health-projection@1");
    expect(p1.projectionHash).toBe(p2.projectionHash);
  });

  it("produces different hash for different health", () => {
    const p1 = buildHealthProjection("cand-001", "current", "dec-001", TS, [], 0, TS);
    const p2 = buildHealthProjection("cand-001", "degraded", "dec-001", TS, [], 1, TS);
    expect(p1.projectionHash).not.toBe(p2.projectionHash);
  });
});

describe("evaluateMonitorRecovery", () => {
  function mkRecoveryState(
    overrides: Partial<MonitorRecoveryStateV1> = {},
  ): MonitorRecoveryStateV1 {
    return {
      operationId: "op-001",
      candidateId: "cand-001",
      scheduleWindowId: "win-001",
      requirementsStarted: false,
      requirementsCompleted: false,
      healthDecisionAppended: false,
      incidentCreated: false,
      projectionUpdated: false,
      ...overrides,
    };
  }

  it("resumes from requirements when not started", () => {
    const result = evaluateMonitorRecovery(mkRecoveryState());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resumeFrom).toBe("requirements");
    }
  });

  it("resumes from requirements when started but not completed", () => {
    const result = evaluateMonitorRecovery(
      mkRecoveryState({ requirementsStarted: true, requirementsCompleted: false }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resumeFrom).toBe("requirements");
    }
  });

  it("resumes from health-decision when requirements completed", () => {
    const result = evaluateMonitorRecovery(
      mkRecoveryState({ requirementsStarted: true, requirementsCompleted: true }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resumeFrom).toBe("health-decision");
    }
  });

  it("resumes from incident when health decision appended", () => {
    const result = evaluateMonitorRecovery(
      mkRecoveryState({
        requirementsStarted: true,
        requirementsCompleted: true,
        healthDecisionAppended: true,
        incidentCreated: false,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resumeFrom).toBe("incident");
    }
  });

  it("resumes from projection when health decision and incident done", () => {
    const result = evaluateMonitorRecovery(
      mkRecoveryState({
        requirementsStarted: true,
        requirementsCompleted: true,
        healthDecisionAppended: true,
        incidentCreated: true,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resumeFrom).toBe("projection");
    }
  });

  it("completes when projection updated", () => {
    const result = evaluateMonitorRecovery(
      mkRecoveryState({
        requirementsStarted: true,
        requirementsCompleted: true,
        healthDecisionAppended: true,
        incidentCreated: true,
        projectionUpdated: true,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resumeFrom).toBe("complete");
    }
  });
});

describe("isHealthTransitionValid", () => {
  it("allows null to any state", () => {
    expect(isHealthTransitionValid(null, "current")).toBe(true);
    expect(isHealthTransitionValid(null, "degraded")).toBe(true);
    expect(isHealthTransitionValid(null, "revoked")).toBe(true);
  });

  it("allows current to degraded", () => {
    expect(isHealthTransitionValid("current", "degraded")).toBe(true);
  });

  it("allows current to revoked", () => {
    expect(isHealthTransitionValid("current", "revoked")).toBe(true);
  });

  it("allows degraded to current (recovery)", () => {
    expect(isHealthTransitionValid("degraded", "current")).toBe(true);
  });

  it("allows degraded to revoked", () => {
    expect(isHealthTransitionValid("degraded", "revoked")).toBe(true);
  });

  it("allows revoked to current (recovery)", () => {
    expect(isHealthTransitionValid("revoked", "current")).toBe(true);
  });

  it("allows revoked to degraded", () => {
    expect(isHealthTransitionValid("revoked", "degraded")).toBe(true);
  });

  it("allows current to current", () => {
    expect(isHealthTransitionValid("current", "current")).toBe(true);
  });

  it("allows degraded to degraded", () => {
    expect(isHealthTransitionValid("degraded", "degraded")).toBe(true);
  });

  it("allows revoked to revoked", () => {
    expect(isHealthTransitionValid("revoked", "revoked")).toBe(true);
  });
});
