import { describe, it, expect } from "vitest";
import {
  createEvaluatorRegistry,
  routeRisk,
  checkEvaluatorIsolation,
  aggregateConsensus,
  validateEvaluatorPayload,
  executeEvaluators,
  buildCoverageManifest,
} from "../certification/evaluators/index.ts";
import type {
  EvaluatorIdentityV1,
  QualitativeEvaluationPayloadV1,
  EvaluatorInputBundleV1,
  QualitativeRubricV1,
  ChangeProfileV1,
  RiskRuleV1,
} from "../certification/evaluators/index.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import type { EvidenceEnvelopeV1 } from "../certification/index.ts";

const D =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000" as string as Sha256Digest;
const D1 =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111" as string as Sha256Digest;
const _D2 =
  "sha256:2222222222222222222222222222222222222222222222222222222222222222" as string as Sha256Digest;
const TS = "2026-08-15T12:00:00Z";

function mkRubric(): QualitativeRubricV1 {
  return {
    schema: "werkstatt/site-qualitative-rubric@1",
    rubricId: "rubric-001",
    version: "1.0.0",
    criteria: [
      {
        criterionId: "crit-001",
        title: "Clarity",
        description: "Content is clear",
        dimension: "ux-conversion",
        weight: 1.0,
      },
      {
        criterionId: "crit-002",
        title: "Accuracy",
        description: "Content is accurate",
        dimension: "business-truth-compliance",
        weight: 1.5,
      },
    ],
  };
}

function mkInputBundle(hash: Sha256Digest = D): EvaluatorInputBundleV1 {
  return {
    schema: "werkstatt/evaluator-input-bundle@1",
    bundleId: "bundle-001",
    candidateId: "cand-001",
    rubricId: "rubric-001",
    rubricVersion: "1.0.0",
    coverageManifest: {
      schema: "werkstatt/coverage-manifest@1",
      routes: ["/"],
      states: ["default"],
      viewports: ["desktop"],
      combinations: [
        { route: "/", state: "default", viewport: "desktop", covered: true, evidenceId: "ev-001" },
      ],
    },
    deterministicEvidence: [],
    changedRoutes: ["/"],
    changedStates: ["default"],
    redactedContent: "redacted",
    bundleHash: hash,
  };
}

function mkPayload(
  evaluatorId: string,
  opts: Partial<QualitativeEvaluationPayloadV1> = {},
): QualitativeEvaluationPayloadV1 {
  return {
    schema: "werkstatt/site-qualitative-evaluation@1",
    evaluatorId,
    evaluatorRunId: `run-${evaluatorId}`,
    modelProvider: "test-provider",
    modelVersion: "v1",
    rubricId: "rubric-001",
    rubricVersion: "1.0.0",
    inputBundleHash: D,
    riskClass: "ordinary",
    verdict: "pass",
    confidence: 85,
    criteria: [
      {
        criterionId: "crit-001",
        verdict: "pass",
        rationale: "Content is clear and well-structured",
        diagnosticIds: [],
        evidenceAnchors: ["ev-001"],
      },
    ],
    diagnostics: [],
    ...opts,
  };
}

function mkIdentity(id: string): EvaluatorIdentityV1 {
  return { evaluatorId: id, modelProvider: "test-provider", modelVersion: "v1" };
}

describe("createEvaluatorRegistry", () => {
  it("registers an evaluator", () => {
    const reg = createEvaluatorRegistry();
    const result = reg.register(mkIdentity("e1"), async () => mkPayload("e1"));
    expect(result.ok).toBe(true);
    expect(reg.get("e1")?.identity.evaluatorId).toBe("e1");
  });

  it("rejects duplicate registration", () => {
    const reg = createEvaluatorRegistry();
    reg.register(mkIdentity("e1"), async () => mkPayload("e1"));
    const result = reg.register(mkIdentity("e1"), async () => mkPayload("e1"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVAL-01");
    }
  });

  it("lists registered evaluator IDs", () => {
    const reg = createEvaluatorRegistry();
    reg.register(mkIdentity("e1"), async () => mkPayload("e1"));
    reg.register(mkIdentity("e2"), async () => mkPayload("e2"));
    expect([...reg.list()].sort()).toEqual(["e1", "e2"]);
  });
});

describe("routeRisk", () => {
  const criticalRules: RiskRuleV1[] = [
    {
      ruleId: "r1",
      dimension: "security-operational-readiness",
      description: "security changes are critical",
    },
  ];
  const borderlineRules: RiskRuleV1[] = [
    { ruleId: "r2", dimension: "ux-conversion", description: "UX changes are borderline" },
  ];

  it("routes to critical when critical rule matches", () => {
    const change: ChangeProfileV1 = {
      changedRoutes: ["/"],
      changedStates: ["default"],
      dimensions: ["security-operational-readiness"],
      hasStructuralChanges: false,
      hasContentChanges: false,
      hasStyleChanges: false,
    };
    const result = routeRisk(change, criticalRules, borderlineRules);
    expect(result.riskClass).toBe("critical");
    expect(result.requiredEvaluatorCount).toBe(2);
    expect(result.matchedRules).toHaveLength(1);
  });

  it("routes to borderline when borderline rule matches", () => {
    const change: ChangeProfileV1 = {
      changedRoutes: ["/"],
      changedStates: ["default"],
      dimensions: ["ux-conversion"],
      hasStructuralChanges: false,
      hasContentChanges: false,
      hasStyleChanges: false,
    };
    const result = routeRisk(change, criticalRules, borderlineRules);
    expect(result.riskClass).toBe("borderline");
    expect(result.requiredEvaluatorCount).toBe(2);
  });

  it("routes to ordinary when no rules match", () => {
    const change: ChangeProfileV1 = {
      changedRoutes: ["/"],
      changedStates: ["default"],
      dimensions: ["performance-runtime"],
      hasStructuralChanges: false,
      hasContentChanges: false,
      hasStyleChanges: false,
    };
    const result = routeRisk(change, criticalRules, borderlineRules);
    expect(result.riskClass).toBe("ordinary");
    expect(result.requiredEvaluatorCount).toBe(1);
    expect(result.matchedRules).toHaveLength(0);
  });
});

describe("checkEvaluatorIsolation", () => {
  it("passes for distinct non-author evaluators", () => {
    const result = checkEvaluatorIsolation(["e1", "e2"], "author-1");
    expect(result.ok).toBe(true);
  });

  it("fails on self-review (evaluator matches author)", () => {
    const result = checkEvaluatorIsolation(["author-1"], "author-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVAL-02");
    }
  });

  it("fails on duplicate evaluator identities", () => {
    const result = checkEvaluatorIsolation(["e1", "e1"], "author-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVAL-03");
    }
  });
});

describe("aggregateConsensus", () => {
  it("returns pass when all evaluators pass", () => {
    const payloads = [mkPayload("e1", { verdict: "pass" }), mkPayload("e2", { verdict: "pass" })];
    const result = aggregateConsensus(payloads);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.consensus).toBe("pass");
    }
  });

  it("returns fail when all evaluators fail", () => {
    const payloads = [mkPayload("e1", { verdict: "fail" }), mkPayload("e2", { verdict: "fail" })];
    const result = aggregateConsensus(payloads);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.consensus).toBe("fail");
    }
  });

  it("returns incomplete on disagreement", () => {
    const payloads = [mkPayload("e1", { verdict: "pass" }), mkPayload("e2", { verdict: "fail" })];
    const result = aggregateConsensus(payloads);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.consensus).toBe("incomplete");
    }
  });

  it("fails on empty payloads", () => {
    const result = aggregateConsensus([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVAL-05");
    }
  });
});

describe("validateEvaluatorPayload", () => {
  it("passes for valid payload", () => {
    const payload = mkPayload("e1");
    const result = validateEvaluatorPayload(payload, D, mkRubric());
    expect(result.ok).toBe(true);
  });

  it("fails on bundle hash mismatch", () => {
    const payload = mkPayload("e1", { inputBundleHash: D1 });
    const result = validateEvaluatorPayload(payload, D, mkRubric());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVAL-07");
    }
  });

  it("fails on rubric mismatch", () => {
    const payload = mkPayload("e1", { rubricId: "wrong-rubric" });
    const result = validateEvaluatorPayload(payload, D, mkRubric());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVAL-08");
    }
  });

  it("fails on confidence out of range", () => {
    const payload = mkPayload("e1", { confidence: 150 });
    const result = validateEvaluatorPayload(payload, D, mkRubric());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVAL-09");
    }
  });

  it("fails on unknown criterion", () => {
    const payload = mkPayload("e1", {
      criteria: [
        {
          criterionId: "unknown-crit",
          verdict: "pass",
          rationale: "test",
          diagnosticIds: [],
          evidenceAnchors: [],
        },
      ],
    });
    const result = validateEvaluatorPayload(payload, D, mkRubric());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVAL-10");
    }
  });

  it("fails on empty rationale (ungrounded prose)", () => {
    const payload = mkPayload("e1", {
      criteria: [
        {
          criterionId: "crit-001",
          verdict: "pass",
          rationale: "  ",
          diagnosticIds: [],
          evidenceAnchors: [],
        },
      ],
    });
    const result = validateEvaluatorPayload(payload, D, mkRubric());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVAL-10");
    }
  });
});

describe("executeEvaluators", () => {
  it("executes single evaluator for ordinary risk", async () => {
    const reg = createEvaluatorRegistry();
    reg.register(mkIdentity("e1"), async () => mkPayload("e1", { verdict: "pass" }));

    const result = await executeEvaluators(reg, {
      evaluatorIds: ["e1"],
      inputBundle: mkInputBundle(),
      authorAgentId: "author-1",
      rubric: mkRubric(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payloads).toHaveLength(1);
      expect(result.consensus).toBe("pass");
    }
  });

  it("executes two evaluators and aggregates consensus", async () => {
    const reg = createEvaluatorRegistry();
    reg.register(mkIdentity("e1"), async () => mkPayload("e1", { verdict: "fail" }));
    reg.register(mkIdentity("e2"), async () => mkPayload("e2", { verdict: "fail" }));

    const result = await executeEvaluators(reg, {
      evaluatorIds: ["e1", "e2"],
      inputBundle: mkInputBundle(),
      authorAgentId: "author-1",
      rubric: mkRubric(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payloads).toHaveLength(2);
      expect(result.consensus).toBe("fail");
    }
  });

  it("fails on self-review", async () => {
    const reg = createEvaluatorRegistry();
    reg.register(mkIdentity("author-1"), async () => mkPayload("author-1"));

    const result = await executeEvaluators(reg, {
      evaluatorIds: ["author-1"],
      inputBundle: mkInputBundle(),
      authorAgentId: "author-1",
      rubric: mkRubric(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVAL-11");
    }
  });

  it("fails for unregistered evaluator", async () => {
    const reg = createEvaluatorRegistry();
    const result = await executeEvaluators(reg, {
      evaluatorIds: ["e-unknown"],
      inputBundle: mkInputBundle(),
      authorAgentId: "author-1",
      rubric: mkRubric(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVAL-12");
    }
  });

  it("fails when evaluator throws", async () => {
    const reg = createEvaluatorRegistry();
    reg.register(mkIdentity("e1"), async () => {
      throw new Error("evaluator crashed");
    });

    const result = await executeEvaluators(reg, {
      evaluatorIds: ["e1"],
      inputBundle: mkInputBundle(),
      authorAgentId: "author-1",
      rubric: mkRubric(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVAL-13");
    }
  });

  it("fails on invalid payload (bundle hash mismatch)", async () => {
    const reg = createEvaluatorRegistry();
    reg.register(mkIdentity("e1"), async () => mkPayload("e1", { inputBundleHash: D1 }));

    const result = await executeEvaluators(reg, {
      evaluatorIds: ["e1"],
      inputBundle: mkInputBundle(D),
      authorAgentId: "author-1",
      rubric: mkRubric(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-EVAL-13");
    }
  });

  it("returns incomplete consensus on disagreement", async () => {
    const reg = createEvaluatorRegistry();
    reg.register(mkIdentity("e1"), async () => mkPayload("e1", { verdict: "pass" }));
    reg.register(mkIdentity("e2"), async () => mkPayload("e2", { verdict: "fail" }));

    const result = await executeEvaluators(reg, {
      evaluatorIds: ["e1", "e2"],
      inputBundle: mkInputBundle(),
      authorAgentId: "author-1",
      rubric: mkRubric(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.consensus).toBe("incomplete");
    }
  });
});

describe("buildCoverageManifest", () => {
  it("builds coverage manifest from routes/states/viewports", () => {
    const manifest = buildCoverageManifest(["/", "/about"], ["default"], ["desktop", "mobile"], []);
    expect(manifest.combinations).toHaveLength(4);
    expect(manifest.combinations[0].covered).toBe(false);
    expect(manifest.combinations[0].evidenceId).toBeNull();
  });

  it("marks covered combinations with evidence ID", () => {
    const evidence: EvidenceEnvelopeV1[] = [
      {
        schema: "werkstatt/evidence-envelope@1",
        evidenceId: "ev-001",
        candidateId: "cand-001",
        producerId: "p1",
        producerAttemptId: "att-001",
        producedAt: TS,
        result: {
          schema: "werkstatt/evidence-result@1",
          producerId: "p1",
          producerAttemptId: "att-001",
          diagnostics: [],
          bindingHash: D,
          applicability: {
            appliesTo: ["req-001"],
            scope: "dev",
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
        freshness: {
          expiresAt: TS,
          staleAfter: TS,
        },
      },
    ];
    const manifest = buildCoverageManifest(["/"], ["default"], ["desktop"], evidence);
    expect(manifest.combinations).toHaveLength(1);
  });
});
