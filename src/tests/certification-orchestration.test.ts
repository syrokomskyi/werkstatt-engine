import { describe, it, expect } from "vitest";
import {
  planProducers,
  createGateLockManager,
  executeProducers,
  computeResumePoint,
  DEFAULT_PRODUCER_CONFIG,
} from "../certification/orchestration/index.ts";
import type {
  ProducerDependencyNodeV1,
  ProducerExecutionConfigV1,
  OrchestratorOperationV1,
} from "../certification/orchestration/index.ts";
import type {
  ReleaseCandidateV1,
  CertificationPolicyBundleV1,
  EvidenceEnvelopeV1,
  ResolvedRequirementV1,
  GateDecisionV1,
} from "../certification/index.ts";
import type { CertificationProfileV1 } from "../certification/profile/schemas.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import {
  createDossierRepository,
  appendDossierEvent,
} from "../certification/storage/repository.ts";
import { getCertificationStatus, verifyCertification } from "../certification/commands/index.ts";

const D =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000" as string as Sha256Digest;
const D1 =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111" as string as Sha256Digest;
const D2 =
  "sha256:2222222222222222222222222222222222222222222222222222222222222222" as string as Sha256Digest;
const TS = "2026-08-15T12:00:00Z";

function mkCandidate(): ReleaseCandidateV1 {
  return {
    schema: "werkstatt/release-candidate@1",
    candidateId: "cand-001",
    systemId: "system-001",
    releaseVersion: "1.0.0",
    sourceHash: D,
    contentHash: D1,
    artifactHash: D2,
    buildConfig: {
      schema: "werkstatt/build-config@1",
      buildConfigHash: D,
      toolchainId: "toolchain-001",
      sourceRef: "src/",
      contentHash: D1,
    },
    deploymentPlan: {
      schema: "werkstatt/deployment-plan@1",
      deploymentPlanHash: D2,
      channel: "dev",
      target: "dev-target",
      environmentRefs: [],
    },
    policyBundleRoot: D,
    toolchainId: "toolchain-001",
    observedEnvironment: {
      schema: "werkstatt/observed-environment@1",
      environment: "dev",
      environmentIdentityHash: D,
      observedAt: TS,
    },
    observedAt: TS,
  };
}

function mkProfile(): CertificationProfileV1 {
  return {
    schema: "werkstatt/certification-profile@1",
    id: "site-profile-v1",
    version: "1.0.0",
    plugin: {
      id: "werkstatt-site",
      profileId: "astro-typescript-turborepo",
    },
    dimensions: ["candidate-integrity"],
    producers: {},
    requirements: [
      {
        id: "req-001",
        title: "test requirement",
        dimension: "core",
        gates: ["dev-deploy"],
        classification: "required",
        applicability: { kind: "always" },
        producerId: "producer-1",
        evidenceSchema: "werkstatt/evidence-result@1",
        environments: ["dev"],
        reuse: { environmentIndependent: true, allowedFrom: [] },
        freshness: { maxAgeSeconds: null },
        execution: { timeoutMs: 30000, maxAttempts: 1, backoffMs: [] },
        criticality: "ordinary",
        driftAction: "retry",
        remediation: {
          classification: "product-fix",
          ownerRole: "author-agent",
          reproduceCommand: "echo reproduce",
          verificationCommand: "echo verify",
        },
        normativeRefs: ["spec-001"],
      },
    ],
    retentionPolicy: {
      minRetentionDays: 30,
      maxRetentionDays: 365,
      tombstoneAfterDays: 730,
    },
  };
}

function mkPolicyBundle(): CertificationPolicyBundleV1 {
  return {
    schema: "werkstatt/certification-policy-bundle@1",
    policyBundleId: "pb-001",
    version: "1.0.0",
    profileId: "site-profile-v1",
    resolvedRequirements: [] as ResolvedRequirementV1[],
    producerManifests: [],
    rubricManifests: [],
    toolchainManifests: [],
    issuerManifests: [],
    riskPolicy: { maxStale: 0, maxIncomplete: 0, blockOnFail: true },
    retention: { minRetentionDays: 30, maxRetentionDays: 365 },
    materializedAt: TS,
  };
}

function mkEvidence(producerId: string): EvidenceEnvelopeV1 {
  return {
    schema: "werkstatt/evidence-envelope@1",
    evidenceId: `evidence-${producerId}`,
    candidateId: "cand-001",
    producerId,
    producerAttemptId: `attempt-${producerId}`,
    producedAt: TS,
    result: {
      schema: "werkstatt/evidence-result@1",
      producerId,
      producerAttemptId: `attempt-${producerId}`,
      diagnostics: [],
      bindingHash: D,
      applicability: {
        appliesTo: ["req-001"],
        scope: "test",
      },
    },
    payloads: [],
    redaction: {
      schema: "werkstatt/redaction-report@1",
      policyVersion: "1.0.0",
      detectedSecrets: 0,
      detectedPii: 0,
      resolved: true,
      unresolvedSecrets: 0,
      unresolvedPii: 0,
    },
    freshness: { expiresAt: TS, staleAfter: TS },
  };
}

function mkGateDecision(status: "pass" | "fail"): GateDecisionV1 {
  return {
    schema: "werkstatt/gate-decision@1",
    decisionId: "dec-001",
    candidateId: "cand-001",
    policyBundleRoot: D,
    gate: "dev",
    evaluationCut: 1,
    selectedEvidence: [],
    status,
    coverage: {
      schema: "werkstatt/coverage-report@1",
      totalRequirements: 1,
      coveredRequirements: status === "pass" ? 1 : 0,
      uncoveredRequirements: status === "pass" ? [] : ["req-001"],
    },
    reasons: [],
    actionPackRef: status === "pass" ? null : D1,
    decidedAt: TS,
  };
}

describe("planProducers", () => {
  it("plans a single producer", () => {
    const nodes: ProducerDependencyNodeV1[] = [{ producerId: "p1", dependsOn: [] }];
    const result = planProducers(nodes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.batches).toHaveLength(1);
      expect(result.batches[0]).toEqual(["p1"]);
    }
  });

  it("plans producers with dependencies in correct batches", () => {
    const nodes: ProducerDependencyNodeV1[] = [
      { producerId: "p1", dependsOn: [] },
      { producerId: "p2", dependsOn: ["p1"] },
      { producerId: "p3", dependsOn: ["p1"] },
      { producerId: "p4", dependsOn: ["p2", "p3"] },
    ];
    const result = planProducers(nodes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.batches).toHaveLength(3);
      expect(result.batches[0]).toEqual(["p1"]);
      expect([...result.batches[1]].sort()).toEqual(["p2", "p3"]);
      expect(result.batches[2]).toEqual(["p4"]);
    }
  });

  it("fails on duplicate producer IDs", () => {
    const nodes: ProducerDependencyNodeV1[] = [
      { producerId: "p1", dependsOn: [] },
      { producerId: "p1", dependsOn: [] },
    ];
    const result = planProducers(nodes);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ORCHESTRATOR-01");
    }
  });

  it("fails on unknown dependency", () => {
    const nodes: ProducerDependencyNodeV1[] = [{ producerId: "p1", dependsOn: ["p-unknown"] }];
    const result = planProducers(nodes);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ORCHESTRATOR-02");
    }
  });

  it("fails on cycle", () => {
    const nodes: ProducerDependencyNodeV1[] = [
      { producerId: "p1", dependsOn: ["p2"] },
      { producerId: "p2", dependsOn: ["p1"] },
    ];
    const result = planProducers(nodes);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ORCHESTRATOR-02");
    }
  });

  it("handles empty input", () => {
    const result = planProducers([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.batches).toHaveLength(0);
      expect(result.producerIds).toHaveLength(0);
    }
  });
});

describe("createGateLockManager", () => {
  it("acquires a lock", () => {
    const mgr = createGateLockManager();
    const result = mgr.acquire({
      releaseId: "rel-001",
      gate: "dev",
      operationId: "op-001",
      acquiredAt: TS,
      holder: "orchestrator",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lock.operationId).toBe("op-001");
    }
    expect(mgr.isLocked("rel-001", "dev")).toBe(true);
  });

  it("rejects concurrent lock for same release+gate", () => {
    const mgr = createGateLockManager();
    mgr.acquire({
      releaseId: "rel-001",
      gate: "dev",
      operationId: "op-001",
      acquiredAt: TS,
      holder: "orchestrator",
    });
    const result = mgr.acquire({
      releaseId: "rel-001",
      gate: "dev",
      operationId: "op-002",
      acquiredAt: TS,
      holder: "orchestrator",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ORCHESTRATOR-03");
    }
  });

  it("allows re-acquire with same operationId (idempotent)", () => {
    const mgr = createGateLockManager();
    mgr.acquire({
      releaseId: "rel-001",
      gate: "dev",
      operationId: "op-001",
      acquiredAt: TS,
      holder: "orchestrator",
    });
    const result = mgr.acquire({
      releaseId: "rel-001",
      gate: "dev",
      operationId: "op-001",
      acquiredAt: TS,
      holder: "orchestrator",
    });
    expect(result.ok).toBe(true);
  });

  it("releases a lock", () => {
    const mgr = createGateLockManager();
    mgr.acquire({
      releaseId: "rel-001",
      gate: "dev",
      operationId: "op-001",
      acquiredAt: TS,
      holder: "orchestrator",
    });
    expect(mgr.release("op-001")).toBe(true);
    expect(mgr.isLocked("rel-001", "dev")).toBe(false);
  });

  it("allows different gates for same release", () => {
    const mgr = createGateLockManager();
    mgr.acquire({
      releaseId: "rel-001",
      gate: "dev",
      operationId: "op-001",
      acquiredAt: TS,
      holder: "orchestrator",
    });
    const result = mgr.acquire({
      releaseId: "rel-001",
      gate: "alt",
      operationId: "op-002",
      acquiredAt: TS,
      holder: "orchestrator",
    });
    expect(result.ok).toBe(true);
  });
});

describe("executeProducers", () => {
  it("executes a simple plan", async () => {
    const plan = planProducers([
      { producerId: "p1", dependsOn: [] },
      { producerId: "p2", dependsOn: [] },
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const config: ProducerExecutionConfigV1 = {
      ...DEFAULT_PRODUCER_CONFIG,
      operationId: "op-001",
      timestamp: TS,
      maxParallelism: 2,
      timeoutMs: 5000,
      maxRetries: 0,
      retryDelayMs: 10,
    };

    const result = await executeProducers(plan, async (input) => mkEvidence(input.producerId), {
      candidate: mkCandidate(),
      profile: mkProfile(),
      policyBundle: mkPolicyBundle(),
      config,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence).toHaveLength(2);
      expect(result.events.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("handles producer failure", async () => {
    const plan = planProducers([{ producerId: "p1", dependsOn: [] }]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const config: ProducerExecutionConfigV1 = {
      ...DEFAULT_PRODUCER_CONFIG,
      operationId: "op-001",
      timestamp: TS,
      maxParallelism: 1,
      timeoutMs: 5000,
      maxRetries: 0,
      retryDelayMs: 10,
    };

    const result = await executeProducers(
      plan,
      async () => {
        throw new Error("producer failed");
      },
      {
        candidate: mkCandidate(),
        profile: mkProfile(),
        policyBundle: mkPolicyBundle(),
        config,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ORCHESTRATOR-04");
      expect(result.partialEvidence).toHaveLength(0);
    }
  });

  it("retries on failure", async () => {
    const plan = planProducers([{ producerId: "p1", dependsOn: [] }]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    let attempts = 0;
    const config: ProducerExecutionConfigV1 = {
      ...DEFAULT_PRODUCER_CONFIG,
      operationId: "op-001",
      timestamp: TS,
      maxParallelism: 1,
      timeoutMs: 5000,
      maxRetries: 2,
      retryDelayMs: 1,
    };

    const result = await executeProducers(
      plan,
      async (input) => {
        attempts++;
        if (attempts < 2) throw new Error("transient failure");
        return mkEvidence(input.producerId);
      },
      {
        candidate: mkCandidate(),
        profile: mkProfile(),
        policyBundle: mkPolicyBundle(),
        config,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence).toHaveLength(1);
      expect(attempts).toBe(2);
    }
  });

  it("emits progress events", async () => {
    const plan = planProducers([{ producerId: "p1", dependsOn: [] }]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const events: string[] = [];
    const config: ProducerExecutionConfigV1 = {
      ...DEFAULT_PRODUCER_CONFIG,
      operationId: "op-001",
      timestamp: TS,
      maxParallelism: 1,
      timeoutMs: 5000,
      maxRetries: 0,
      retryDelayMs: 10,
    };

    await executeProducers(
      plan,
      async (input) => mkEvidence(input.producerId),
      {
        candidate: mkCandidate(),
        profile: mkProfile(),
        policyBundle: mkPolicyBundle(),
        config,
      },
      (event) => events.push(event.status),
    );

    expect(events).toContain("started");
    expect(events).toContain("completed");
  });
});

describe("computeResumePoint", () => {
  it("computes resume point for empty operation", () => {
    const plan = planProducers([
      { producerId: "p1", dependsOn: [] },
      { producerId: "p2", dependsOn: ["p1"] },
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const operation: OrchestratorOperationV1 = {
      operationId: "op-001",
      releaseId: "rel-001",
      gate: "dev",
      candidate: mkCandidate(),
      profile: mkProfile(),
      policyBundle: mkPolicyBundle(),
      state: "producing",
      startedAt: TS,
      evidence: [],
    };

    const result = computeResumePoint(operation, plan);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resumePoint.batchIndex).toBe(0);
      expect(result.resumePoint.producerIdsCompleted.size).toBe(0);
    }
  });

  it("computes resume point after first batch", () => {
    const plan = planProducers([
      { producerId: "p1", dependsOn: [] },
      { producerId: "p2", dependsOn: ["p1"] },
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const operation: OrchestratorOperationV1 = {
      operationId: "op-001",
      releaseId: "rel-001",
      gate: "dev",
      candidate: mkCandidate(),
      profile: mkProfile(),
      policyBundle: mkPolicyBundle(),
      state: "producing",
      startedAt: TS,
      evidence: [mkEvidence("p1")],
    };

    const result = computeResumePoint(operation, plan);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resumePoint.batchIndex).toBe(1);
      expect(result.resumePoint.producerIdsCompleted.has("p1")).toBe(true);
    }
  });

  it("returns failure when all batches complete", () => {
    const plan = planProducers([{ producerId: "p1", dependsOn: [] }]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const operation: OrchestratorOperationV1 = {
      operationId: "op-001",
      releaseId: "rel-001",
      gate: "dev",
      candidate: mkCandidate(),
      profile: mkProfile(),
      policyBundle: mkPolicyBundle(),
      state: "producing",
      startedAt: TS,
      evidence: [mkEvidence("p1")],
    };

    const result = computeResumePoint(operation, plan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ORCHESTRATOR-07");
    }
  });
});

describe("getCertificationStatus", () => {
  it("returns status for a candidate with no decisions", () => {
    const candidate = mkCandidate();
    const repo = createDossierRepository("cand-001");
    const result = getCertificationStatus(candidate, repo, {}, null, "not-verified", [], []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status.candidateId).toBe("cand-001");
      expect(result.status.eventCount).toBe(0);
      expect(result.status.durableReplicaStatus).toBe("not-verified");
      expect(result.status.nextRequiredAction).toBe(
        "Durable replica not verified — sync required for Alt/Main gates",
      );
    }
  });

  it("returns next action for non-pass decision", () => {
    const candidate = mkCandidate();
    const repo = createDossierRepository("cand-001");
    const result = getCertificationStatus(
      candidate,
      repo,
      { dev: mkGateDecision("fail") },
      null,
      "verified",
      [],
      ["action-pack-001"],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status.nextRequiredAction).toContain("Fix requirements");
      expect(result.status.actionPackLocators).toEqual(["action-pack-001"]);
    }
  });
});

describe("verifyCertification", () => {
  it("verifies a clean dossier", () => {
    const candidate = mkCandidate();
    const repo = createDossierRepository("cand-001");
    const result = verifyCertification(candidate, repo, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(true);
      expect(result.eventCount).toBe(0);
    }
  });

  it("detects dossier integrity issues", () => {
    const candidate = mkCandidate();
    const repo = createDossierRepository("cand-001");
    const event = {
      schema: "werkstatt/dossier-event@1" as const,
      eventId: "evt-001",
      eventKind: "evidence-admitted" as const,
      candidateId: "cand-001",
      authoritySequence: 1,
      previousEventHash: null,
      eventPayloadRef: D,
      recordedAt: TS,
    };
    const appendResult = appendDossierEvent(repo, { event });
    expect(appendResult.ok).toBe(true);
    if (!appendResult.ok) return;

    const tamperedRepo = {
      ...appendResult.repository,
      events: [
        ...appendResult.repository.events,
        {
          ...event,
          eventId: "evt-002",
          previousEventHash: D2,
        },
      ],
      eventHashes: [...appendResult.repository.eventHashes, D2],
    };

    const result = verifyCertification(candidate, tamperedRepo, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-ORCHESTRATOR-10");
    }
  });
});
