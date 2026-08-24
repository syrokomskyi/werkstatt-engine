import { describe, it, expect } from "vitest";
import {
  evaluateCertificationDecision,
  buildCertificationActionPack,
  computeDossierRoot,
} from "../certification/index.ts";
import type {
  EvidenceEnvelopeV1,
  CertificationPolicyBundleV1,
  ResolvedRequirementV1,
  ActionAnchorV1,
} from "../certification/index.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";

const D =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000" as string as Sha256Digest;
const D1 =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111" as string as Sha256Digest;
const D2 =
  "sha256:2222222222222222222222222222222222222222222222222222222222222222" as string as Sha256Digest;

function makeRequirement(id: string, mandatory: boolean): ResolvedRequirementV1 {
  return {
    requirementId: id,
    source: "test-rubric",
    description: `requirement ${id}`,
    mandatory,
  };
}

function makePolicyBundle(
  requirements: readonly ResolvedRequirementV1[],
): CertificationPolicyBundleV1 {
  return {
    schema: "werkstatt/certification-policy-bundle@1",
    policyBundleId: "pb-test",
    version: "1.0.0",
    profileId: "test-profile",
    resolvedRequirements: [...requirements],
    producerManifests: [],
    rubricManifests: [],
    toolchainManifests: [],
    issuerManifests: [],
    riskPolicy: { maxStale: 0, maxIncomplete: 0, blockOnFail: true },
    retention: { minRetentionDays: 30, maxRetentionDays: 365 },
    materializedAt: "2026-01-01T00:00:00Z",
  };
}

function makeEvidence(
  evidenceId: string,
  candidateId: string,
  appliesTo: string[],
  authoritySeq: number,
  diagnostics: { severity: "error" | "warning" | "info"; ruleId: string; message: string }[] = [],
  staleAfter = "2026-12-31T23:59:59Z",
  expiresAt = "2026-12-31T23:59:59Z",
): EvidenceEnvelopeV1 {
  return {
    schema: "werkstatt/evidence-envelope@1",
    evidenceId,
    candidateId,
    producerId: "producer-1",
    producerAttemptId: "att-1",
    producedAt: "2026-01-01T00:00:00Z",
    result: {
      schema: "werkstatt/evidence-result@1",
      producerId: "producer-1",
      producerAttemptId: "att-1",
      diagnostics: diagnostics.map((d) => ({
        ruleId: d.ruleId,
        severity: d.severity,
        message: d.message,
        evidence: [],
      })),
      bindingHash: D,
      applicability: { appliesTo, scope: "test" },
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
    authorityAdmission: {
      schema: "werkstatt/authority-admission@1",
      authoritySequence: authoritySeq,
      admittedAt: "2026-01-01T00:00:00Z",
      admittedBy: "admitter-1",
    },
    freshness: { expiresAt, staleAfter },
  };
}

function shuffle<T>(arr: readonly T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

describe("certification-evaluation PBT: permutation invariance", () => {
  it("decision is invariant under evidence input permutation (100 trials)", () => {
    const reqs = [
      makeRequirement("req-1", true),
      makeRequirement("req-2", true),
      makeRequirement("req-3", true),
    ];
    const policy = makePolicyBundle(reqs);
    const evidence = [
      makeEvidence("ev-1", "cand-1", ["req-1"], 1),
      makeEvidence("ev-2", "cand-1", ["req-2"], 2),
      makeEvidence("ev-3", "cand-1", ["req-3"], 3),
    ];

    const baseline = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence,
      evaluationCutSequence: 10,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    expect(baseline.ok).toBe(true);

    for (let trial = 0; trial < 100; trial++) {
      const permuted = evaluateCertificationDecision({
        candidateId: "cand-1",
        policyBundle: policy,
        evidence: shuffle(evidence),
        evaluationCutSequence: 10,
        authorityTime: "2026-06-01T00:00:00Z",
        gate: "dev",
        decidedAt: "2026-06-01T00:00:00Z",
      });
      expect(permuted.ok).toBe(true);
      if (baseline.ok && permuted.ok) {
        expect(permuted.status).toBe(baseline.status);
        expect(permuted.selectedEvidence).toEqual(baseline.selectedEvidence);
        expect(permuted.coverage).toEqual(baseline.coverage);
      }
    }
  });

  it("decision is invariant under requirement permutation (100 trials)", () => {
    const reqs = [
      makeRequirement("req-1", true),
      makeRequirement("req-2", true),
      makeRequirement("req-3", true),
    ];
    const evidence = [
      makeEvidence("ev-1", "cand-1", ["req-1"], 1),
      makeEvidence("ev-2", "cand-1", ["req-2"], 2),
      makeEvidence("ev-3", "cand-1", ["req-3"], 3),
    ];

    const baseline = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: makePolicyBundle(reqs),
      evidence,
      evaluationCutSequence: 10,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    expect(baseline.ok).toBe(true);

    for (let trial = 0; trial < 100; trial++) {
      const permuted = evaluateCertificationDecision({
        candidateId: "cand-1",
        policyBundle: makePolicyBundle(shuffle(reqs)),
        evidence,
        evaluationCutSequence: 10,
        authorityTime: "2026-06-01T00:00:00Z",
        gate: "dev",
        decidedAt: "2026-06-01T00:00:00Z",
      });
      expect(permuted.ok).toBe(true);
      if (baseline.ok && permuted.ok) {
        expect(permuted.status).toBe(baseline.status);
        expect(permuted.selectedEvidence).toEqual(baseline.selectedEvidence);
        expect(permuted.coverage).toEqual(baseline.coverage);
      }
    }
  });

  it("decision is invariant under retry (same cut) — historical decisions cannot change", () => {
    const req = makeRequirement("req-1", true);
    const policy = makePolicyBundle([req]);
    const ev1 = makeEvidence("ev-1", "cand-1", ["req-1"], 1);
    const ev2 = makeEvidence("ev-2", "cand-1", ["req-1"], 3);

    const r1 = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence: [ev1, ev2],
      evaluationCutSequence: 5,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    const r2 = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence: [ev1, ev2],
      evaluationCutSequence: 5,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.status).toBe(r2.status);
      expect(r1.selectedEvidence).toEqual(r2.selectedEvidence);
    }
  });

  it("late submission beyond cut does not change decision", () => {
    const req = makeRequirement("req-1", true);
    const policy = makePolicyBundle([req]);
    const ev1 = makeEvidence("ev-1", "cand-1", ["req-1"], 1);
    const evLate = makeEvidence("ev-late", "cand-1", ["req-1"], 10);

    const withoutLate = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence: [ev1],
      evaluationCutSequence: 5,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    const withLate = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence: [ev1, evLate],
      evaluationCutSequence: 5,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    expect(withoutLate.ok).toBe(true);
    expect(withLate.ok).toBe(true);
    if (withoutLate.ok && withLate.ok) {
      expect(withoutLate.status).toBe(withLate.status);
      expect(withoutLate.selectedEvidence).toEqual(withLate.selectedEvidence);
    }
  });
});

describe("certification-evaluation PBT: status precedence truth table", () => {
  it("fail > stale > incomplete > pass", () => {
    const cases: { statuses: ("pass" | "fail" | "stale" | "incomplete")[]; expected: string }[] = [
      { statuses: ["pass", "pass"], expected: "pass" },
      { statuses: ["pass", "incomplete"], expected: "incomplete" },
      { statuses: ["pass", "stale"], expected: "stale" },
      { statuses: ["pass", "fail"], expected: "fail" },
      { statuses: ["incomplete", "stale"], expected: "stale" },
      { statuses: ["incomplete", "fail"], expected: "fail" },
      { statuses: ["stale", "fail"], expected: "fail" },
      { statuses: ["fail", "fail"], expected: "fail" },
    ];

    for (const { statuses, expected } of cases) {
      const reqs = statuses.map((_, i) => makeRequirement(`req-${i}`, true));
      const policy = makePolicyBundle(reqs);
      const evidence: EvidenceEnvelopeV1[] = [];
      for (let i = 0; i < statuses.length; i++) {
        if (statuses[i] === "pass") {
          evidence.push(makeEvidence(`ev-pass-${i}`, "cand-1", [`req-${i}`], i + 1));
        } else if (statuses[i] === "fail") {
          evidence.push(
            makeEvidence(`ev-fail-${i}`, "cand-1", [`req-${i}`], i + 1, [
              { severity: "error", ruleId: "RULE-01", message: "fail" },
            ]),
          );
        } else if (statuses[i] === "stale") {
          evidence.push(
            makeEvidence(
              `ev-stale-${i}`,
              "cand-1",
              [`req-${i}`],
              i + 1,
              [],
              "2026-01-01T00:00:00Z",
              "2026-01-01T00:00:00Z",
            ),
          );
        }
      }
      const result = evaluateCertificationDecision({
        candidateId: "cand-1",
        policyBundle: policy,
        evidence,
        evaluationCutSequence: 100,
        authorityTime: "2026-06-01T00:00:00Z",
        gate: "dev",
        decidedAt: "2026-06-01T00:00:00Z",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.status).toBe(expected);
      }
    }
  });

  it("empty profile cannot produce pass", () => {
    const policy = makePolicyBundle([]);
    const result = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence: [],
      evaluationCutSequence: 10,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe("incomplete");
  });

  it("advisory (non-mandatory) results are visible but non-authorizing", () => {
    const req = makeRequirement("req-adv", false);
    const policy = makePolicyBundle([req]);
    const ev = makeEvidence("ev-1", "cand-1", ["req-adv"], 1, [
      { severity: "error", ruleId: "RULE-01", message: "fail" },
    ]);
    const result = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence: [ev],
      evaluationCutSequence: 10,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("incomplete");
      const reqResult = result.requirements.find((r) => r.requirementId === "req-adv");
      expect(reqResult?.status).toBe("fail");
    }
  });
});

describe("certification-evaluation PBT: dossier root properties", () => {
  it("dossier root is permutation-sensitive (order matters)", () => {
    const hashes = [D1, D2, D];
    const root1 = computeDossierRoot("cand-1", hashes);
    for (let trial = 0; trial < 50; trial++) {
      const shuffled = shuffle(hashes);
      if (shuffled.join(",") === hashes.join(",")) continue;
      const rootShuffled = computeDossierRoot("cand-1", shuffled);
      expect(rootShuffled).not.toBe(root1);
    }
  });

  it("dossier root is deterministic for same input", () => {
    for (let trial = 0; trial < 50; trial++) {
      const hashes = Array(10)
        .fill(null)
        .map((_, i) => `sha256:${String(i).padStart(64, "0")}` as string as Sha256Digest);
      const r1 = computeDossierRoot("cand-1", hashes);
      const r2 = computeDossierRoot("cand-1", hashes);
      expect(r1).toBe(r2);
    }
  });
});

describe("certification-evaluation PBT: maximum-size stress", () => {
  it("handles 1000 requirements and 10000 evidence records deterministically", () => {
    const reqs: ResolvedRequirementV1[] = [];
    for (let i = 0; i < 1000; i++) {
      reqs.push(makeRequirement(`req-${i}`, true));
    }
    const policy = makePolicyBundle(reqs);

    const evidence: EvidenceEnvelopeV1[] = [];
    for (let i = 0; i < 10000; i++) {
      const reqIdx = i % 1000;
      evidence.push(makeEvidence(`ev-${i}`, "cand-1", [`req-${reqIdx}`], i + 1));
    }

    const start = performance.now();
    const result = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence,
      evaluationCutSequence: 10001,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    const elapsed = performance.now() - start;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("pass");
      expect(result.coverage.totalRequirements).toBe(1000);
      expect(result.coverage.coveredRequirements).toBe(1000);
    }

    expect(elapsed).toBeLessThan(5000);
  });

  it("rejects 1001 requirements with CERT-LIMIT-01", () => {
    const reqs: ResolvedRequirementV1[] = [];
    for (let i = 0; i < 1001; i++) {
      reqs.push(makeRequirement(`req-${i}`, true));
    }
    const policy = makePolicyBundle(reqs);

    const result = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence: [],
      evaluationCutSequence: 10,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CERT-LIMIT-01");
  });

  it("rejects 10001 evidence records with CERT-LIMIT-02", () => {
    const req = makeRequirement("req-1", true);
    const policy = makePolicyBundle([req]);
    const evidence: EvidenceEnvelopeV1[] = [];
    for (let i = 0; i < 10001; i++) {
      evidence.push(makeEvidence(`ev-${i}`, "cand-1", ["req-1"], i + 1));
    }

    const result = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence,
      evaluationCutSequence: 10002,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CERT-LIMIT-02");
  });
});

describe("certification-evaluation PBT: action-pack determinism", () => {
  function makeAnchor(id: string): ActionAnchorV1 {
    return {
      anchorId: id,
      target: `target-${id}`,
      description: `anchor ${id}`,
    };
  }

  it("action pack is invariant under requirement permutation", () => {
    const requirements = [
      {
        requirementId: "req-a",
        status: "fail" as const,
        selectedEvidenceId: null,
        selectedEvidenceHash: null,
        reasonCode: "CERT-OK",
        reasonMessage: "",
      },
      {
        requirementId: "req-b",
        status: "stale" as const,
        selectedEvidenceId: null,
        selectedEvidenceHash: null,
        reasonCode: "CERT-EVIDENCE-02",
        reasonMessage: "",
      },
      {
        requirementId: "req-c",
        status: "incomplete" as const,
        selectedEvidenceId: null,
        selectedEvidenceHash: null,
        reasonCode: "CERT-EVIDENCE-01",
        reasonMessage: "",
      },
    ];
    const meta = new Map([
      [
        "req-a",
        {
          remediationClass: "product-fix" as const,
          description: "fix a",
          verificationCommand: "pnpm test",
          anchors: [makeAnchor("a-1")],
          dependencies: [],
        },
      ],
      [
        "req-b",
        {
          remediationClass: "infrastructure-retry" as const,
          description: "retry b",
          verificationCommand: "pnpm build",
          anchors: [makeAnchor("b-1")],
          dependencies: [],
        },
      ],
      [
        "req-c",
        {
          remediationClass: "policy-defect" as const,
          description: "fix c policy",
          verificationCommand: "pnpm lint",
          anchors: [makeAnchor("c-1")],
          dependencies: [],
        },
      ],
    ]);

    const baseline = buildCertificationActionPack({
      actionPackId: "ap-1",
      candidateId: "cand-1",
      decisionId: "dec-1",
      requirements,
      remediationMetadata: meta,
      createdAt: "2026-06-01T00:00:00Z",
    });

    for (let trial = 0; trial < 50; trial++) {
      const permuted = buildCertificationActionPack({
        actionPackId: "ap-1",
        candidateId: "cand-1",
        decisionId: "dec-1",
        requirements: shuffle(requirements),
        remediationMetadata: meta,
        createdAt: "2026-06-01T00:00:00Z",
      });
      if ("tasks" in baseline && "tasks" in permuted) {
        expect(permuted.tasks.map((t) => t.taskId).sort()).toEqual(
          baseline.tasks.map((t) => t.taskId).sort(),
        );
      }
    }
  });
});
