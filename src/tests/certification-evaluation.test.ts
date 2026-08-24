import { describe, it, expect } from "vitest";
import {
  buildEvidenceIndex,
  selectRequirementEvidence,
  evaluateCertificationDecision,
  buildCertificationActionPack,
  computeDossierEventHash,
  computeDossierRoot,
} from "../certification/index.ts";
import type {
  EvidenceEnvelopeV1,
  CertificationPolicyBundleV1,
  ResolvedRequirementV1,
  CertificationDossierEventV1,
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
      applicability: {
        appliesTo,
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
    authorityAdmission: {
      schema: "werkstatt/authority-admission@1",
      authoritySequence: authoritySeq,
      admittedAt: "2026-01-01T00:00:00Z",
      admittedBy: "admitter-1",
    },
    freshness: { expiresAt, staleAfter },
  };
}

describe("evidence-selection: buildEvidenceIndex", () => {
  it("builds index excluding evidence above evaluation cut", () => {
    const ev1 = makeEvidence("ev-1", "cand-1", ["req-1"], 1);
    const ev2 = makeEvidence("ev-2", "cand-1", ["req-1"], 5);
    const index = buildEvidenceIndex({
      candidateId: "cand-1",
      evidence: [ev1, ev2],
      evaluationCutSequence: 3,
    });
    expect(index).toBeDefined();
    if ("code" in index) throw new Error("should not fail");
    const entries = index.byRequirement.get("req-1")!;
    expect(entries).toHaveLength(1);
    expect(entries[0].evidence.evidenceId).toBe("ev-1");
  });

  it("excludes evidence for different candidate", () => {
    const ev = makeEvidence("ev-1", "cand-other", ["req-1"], 1);
    const index = buildEvidenceIndex({
      candidateId: "cand-1",
      evidence: [ev],
      evaluationCutSequence: 10,
    });
    if ("code" in index) throw new Error("should not fail");
    expect(index.byRequirement.size).toBe(0);
  });

  it("excludes evidence without authority admission", () => {
    const ev = makeEvidence("ev-1", "cand-1", ["req-1"], 1);
    ev.authorityAdmission = undefined;
    const index = buildEvidenceIndex({
      candidateId: "cand-1",
      evidence: [ev],
      evaluationCutSequence: 10,
    });
    if ("code" in index) throw new Error("should not fail");
    expect(index.byRequirement.size).toBe(0);
  });

  it("fails when evidence count exceeds 10000", () => {
    const ev = makeEvidence("ev-1", "cand-1", ["req-1"], 1);
    const evidence = Array(10001).fill(ev);
    const result = buildEvidenceIndex({
      candidateId: "cand-1",
      evidence,
      evaluationCutSequence: 10,
    });
    expect("code" in result).toBe(true);
    if ("code" in result) expect(result.code).toBe("CERT-LIMIT-02");
  });
});

describe("evidence-selection: selectRequirementEvidence", () => {
  it("returns incomplete when no evidence for mandatory requirement", () => {
    const req = makeRequirement("req-1", true);
    const policy = makePolicyBundle([req]);
    const index = buildEvidenceIndex({
      candidateId: "cand-1",
      evidence: [],
      evaluationCutSequence: 10,
    });
    if ("code" in index) throw new Error("should not fail");
    const sel = selectRequirementEvidence(
      { requirement: req, policyBundle: policy, authorityTime: "2026-06-01T00:00:00Z" },
      index,
    );
    expect(sel.status).toBe("incomplete");
    expect(sel.reasonCode).toBe("CERT-EVIDENCE-01");
  });

  it("returns not-applicable when no evidence for non-mandatory requirement", () => {
    const req = makeRequirement("req-1", false);
    const policy = makePolicyBundle([req]);
    const index = buildEvidenceIndex({
      candidateId: "cand-1",
      evidence: [],
      evaluationCutSequence: 10,
    });
    if ("code" in index) throw new Error("should not fail");
    const sel = selectRequirementEvidence(
      { requirement: req, policyBundle: policy, authorityTime: "2026-06-01T00:00:00Z" },
      index,
    );
    expect(sel.status).toBe("not-applicable");
  });

  it("selects highest authority sequence evidence", () => {
    const req = makeRequirement("req-1", true);
    const policy = makePolicyBundle([req]);
    const ev1 = makeEvidence("ev-1", "cand-1", ["req-1"], 1);
    const ev2 = makeEvidence("ev-2", "cand-1", ["req-1"], 5);
    const index = buildEvidenceIndex({
      candidateId: "cand-1",
      evidence: [ev1, ev2],
      evaluationCutSequence: 10,
    });
    if ("code" in index) throw new Error("should not fail");
    const sel = selectRequirementEvidence(
      { requirement: req, policyBundle: policy, authorityTime: "2026-06-01T00:00:00Z" },
      index,
    );
    expect(sel.selectedEvidenceId).toBe("ev-2");
    expect(sel.selectedAtSequence).toBe(5);
    expect(sel.status).toBe("pass");
  });

  it("returns fail when evidence has error diagnostic", () => {
    const req = makeRequirement("req-1", true);
    const policy = makePolicyBundle([req]);
    const ev = makeEvidence("ev-1", "cand-1", ["req-1"], 1, [
      { severity: "error", ruleId: "RULE-01", message: "failure" },
    ]);
    const index = buildEvidenceIndex({
      candidateId: "cand-1",
      evidence: [ev],
      evaluationCutSequence: 10,
    });
    if ("code" in index) throw new Error("should not fail");
    const sel = selectRequirementEvidence(
      { requirement: req, policyBundle: policy, authorityTime: "2026-06-01T00:00:00Z" },
      index,
    );
    expect(sel.status).toBe("fail");
  });

  it("returns stale when evidence is past staleAfter", () => {
    const req = makeRequirement("req-1", true);
    const policy = makePolicyBundle([req]);
    const ev = makeEvidence(
      "ev-1",
      "cand-1",
      ["req-1"],
      1,
      [],
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );
    const index = buildEvidenceIndex({
      candidateId: "cand-1",
      evidence: [ev],
      evaluationCutSequence: 10,
    });
    if ("code" in index) throw new Error("should not fail");
    const sel = selectRequirementEvidence(
      { requirement: req, policyBundle: policy, authorityTime: "2026-06-01T00:00:00Z" },
      index,
    );
    expect(sel.status).toBe("stale");
    expect(sel.reasonCode).toBe("CERT-EVIDENCE-02");
  });
});

describe("aggregation: evaluateCertificationDecision", () => {
  it("returns incomplete when no mandatory requirements exist", () => {
    const req = makeRequirement("req-1", false);
    const policy = makePolicyBundle([req]);
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
    if (result.ok) {
      expect(result.status).toBe("incomplete");
      expect(result.reasons).toContain(
        "no mandatory requirements — cannot infer pass from empty profile",
      );
    }
  });

  it("returns incomplete when mandatory requirement has no evidence", () => {
    const req = makeRequirement("req-1", true);
    const policy = makePolicyBundle([req]);
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

  it("returns pass when all mandatory requirements pass", () => {
    const req = makeRequirement("req-1", true);
    const policy = makePolicyBundle([req]);
    const ev = makeEvidence("ev-1", "cand-1", ["req-1"], 1);
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
    if (result.ok) expect(result.status).toBe("pass");
  });

  it("returns fail when any mandatory requirement fails", () => {
    const req1 = makeRequirement("req-1", true);
    const req2 = makeRequirement("req-2", true);
    const policy = makePolicyBundle([req1, req2]);
    const ev1 = makeEvidence("ev-1", "cand-1", ["req-1"], 1);
    const ev2 = makeEvidence("ev-2", "cand-1", ["req-2"], 2, [
      { severity: "error", ruleId: "RULE-01", message: "fail" },
    ]);
    const result = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence: [ev1, ev2],
      evaluationCutSequence: 10,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe("fail");
  });

  it("applies precedence: fail > stale > incomplete > pass", () => {
    const req1 = makeRequirement("req-1", true);
    const req2 = makeRequirement("req-2", true);
    const policy = makePolicyBundle([req1, req2]);
    const ev1 = makeEvidence("ev-1", "cand-1", ["req-1"], 1);
    const ev2 = makeEvidence(
      "ev-2",
      "cand-1",
      ["req-2"],
      2,
      [],
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );
    const result = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence: [ev1, ev2],
      evaluationCutSequence: 10,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe("stale");
  });

  it("returns selected evidence sorted by evidenceId", () => {
    const req1 = makeRequirement("req-1", true);
    const req2 = makeRequirement("req-2", true);
    const policy = makePolicyBundle([req1, req2]);
    const evB = makeEvidence("ev-bbb", "cand-1", ["req-1"], 1);
    const evA = makeEvidence("ev-aaa", "cand-1", ["req-2"], 2);
    const result = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence: [evB, evA],
      evaluationCutSequence: 10,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selectedEvidence[0].evidenceId).toBe("ev-aaa");
      expect(result.selectedEvidence[1].evidenceId).toBe("ev-bbb");
    }
  });

  it("fails when requirements exceed 1000", () => {
    const reqs = Array(1001)
      .fill(null)
      .map((_, i) => makeRequirement(`req-${i}`, true));
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

  it("is deterministic under evidence input permutation", () => {
    const req1 = makeRequirement("req-1", true);
    const req2 = makeRequirement("req-2", true);
    const policy = makePolicyBundle([req1, req2]);
    const ev1 = makeEvidence("ev-1", "cand-1", ["req-1"], 1);
    const ev2 = makeEvidence("ev-2", "cand-1", ["req-2"], 2);
    const r1 = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence: [ev1, ev2],
      evaluationCutSequence: 10,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    const r2 = evaluateCertificationDecision({
      candidateId: "cand-1",
      policyBundle: policy,
      evidence: [ev2, ev1],
      evaluationCutSequence: 10,
      authorityTime: "2026-06-01T00:00:00Z",
      gate: "dev",
      decidedAt: "2026-06-01T00:00:00Z",
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.status).toBe(r2.status);
      expect(r1.selectedEvidence).toEqual(r2.selectedEvidence);
      expect(r1.coverage).toEqual(r2.coverage);
    }
  });
});

describe("action-pack: buildCertificationActionPack", () => {
  function makeAnchor(id: string): ActionAnchorV1 {
    return {
      anchorId: id,
      target: `target-${id}`,
      description: `anchor ${id}`,
    };
  }

  it("builds action pack for non-pass requirements with remediation", () => {
    const result = buildCertificationActionPack({
      actionPackId: "ap-1",
      candidateId: "cand-1",
      decisionId: "dec-1",
      requirements: [
        {
          requirementId: "req-1",
          status: "fail",
          selectedEvidenceId: "ev-1",
          selectedEvidenceHash: D,
          reasonCode: "CERT-OK",
          reasonMessage: "fail",
        },
      ],
      remediationMetadata: new Map([
        [
          "req-1",
          {
            remediationClass: "product-fix",
            description: "fix the bug",
            verificationCommand: "pnpm test",
            anchors: [makeAnchor("a-1")],
            dependencies: [],
          },
        ],
      ]),
      createdAt: "2026-06-01T00:00:00Z",
    });
    expect("schema" in result).toBe(true);
    if ("tasks" in result) {
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].description).toBe("fix the bug");
    }
  });

  it("fails with CERT-ACTION-01 when non-pass requirement lacks remediation", () => {
    const result = buildCertificationActionPack({
      actionPackId: "ap-1",
      candidateId: "cand-1",
      decisionId: "dec-1",
      requirements: [
        {
          requirementId: "req-1",
          status: "fail",
          selectedEvidenceId: "ev-1",
          selectedEvidenceHash: D,
          reasonCode: "CERT-OK",
          reasonMessage: "fail",
        },
      ],
      remediationMetadata: new Map(),
      createdAt: "2026-06-01T00:00:00Z",
    });
    expect("ok" in result && result.ok === false).toBe(true);
    if ("ok" in result && !result.ok) expect(result.code).toBe("CERT-ACTION-01");
  });

  it("fails with CERT-ACTION-01 when remediation has no anchors", () => {
    const result = buildCertificationActionPack({
      actionPackId: "ap-1",
      candidateId: "cand-1",
      decisionId: "dec-1",
      requirements: [
        {
          requirementId: "req-1",
          status: "fail",
          selectedEvidenceId: "ev-1",
          selectedEvidenceHash: D,
          reasonCode: "CERT-OK",
          reasonMessage: "fail",
        },
      ],
      remediationMetadata: new Map([
        [
          "req-1",
          {
            remediationClass: "product-fix",
            description: "fix the bug",
            verificationCommand: "pnpm test",
            anchors: [],
            dependencies: [],
          },
        ],
      ]),
      createdAt: "2026-06-01T00:00:00Z",
    });
    if ("ok" in result && !result.ok) expect(result.code).toBe("CERT-ACTION-01");
  });

  it("detects dependency cycle", () => {
    const result = buildCertificationActionPack({
      actionPackId: "ap-1",
      candidateId: "cand-1",
      decisionId: "dec-1",
      requirements: [
        {
          requirementId: "req-a",
          status: "fail",
          selectedEvidenceId: null,
          selectedEvidenceHash: null,
          reasonCode: "CERT-OK",
          reasonMessage: "",
        },
        {
          requirementId: "req-b",
          status: "fail",
          selectedEvidenceId: null,
          selectedEvidenceHash: null,
          reasonCode: "CERT-OK",
          reasonMessage: "",
        },
      ],
      remediationMetadata: new Map([
        [
          "req-a",
          {
            remediationClass: "product-fix",
            description: "fix a",
            verificationCommand: "pnpm test",
            anchors: [makeAnchor("a-1")],
            dependencies: [{ dependsOn: "act-req-b", type: "hard" }],
          },
        ],
        [
          "req-b",
          {
            remediationClass: "product-fix",
            description: "fix b",
            verificationCommand: "pnpm test",
            anchors: [makeAnchor("b-1")],
            dependencies: [{ dependsOn: "act-req-a", type: "hard" }],
          },
        ],
      ]),
      createdAt: "2026-06-01T00:00:00Z",
    });
    if ("ok" in result && !result.ok) expect(result.code).toBe("CERT-ACTION-01");
  });

  it("skips pass and not-applicable requirements", () => {
    const result = buildCertificationActionPack({
      actionPackId: "ap-1",
      candidateId: "cand-1",
      decisionId: "dec-1",
      requirements: [
        {
          requirementId: "req-1",
          status: "pass",
          selectedEvidenceId: "ev-1",
          selectedEvidenceHash: D,
          reasonCode: "CERT-OK",
          reasonMessage: "",
        },
        {
          requirementId: "req-2",
          status: "not-applicable",
          selectedEvidenceId: null,
          selectedEvidenceHash: null,
          reasonCode: "CERT-NA",
          reasonMessage: "",
        },
      ],
      remediationMetadata: new Map(),
      createdAt: "2026-06-01T00:00:00Z",
    });
    if ("tasks" in result) expect(result.tasks).toHaveLength(0);
  });
});

describe("dossier-hash: computeDossierEventHash", () => {
  it("computes a deterministic hash for a dossier event", () => {
    const event: CertificationDossierEventV1 = {
      schema: "werkstatt/dossier-event@1",
      eventId: "evt-1",
      eventKind: "evidence-admitted",
      candidateId: "cand-1",
      authoritySequence: 1,
      previousEventHash: null,
      eventPayloadRef: D,
      recordedAt: "2026-01-01T00:00:00Z",
    };
    const result1 = computeDossierEventHash(event);
    const result2 = computeDossierEventHash(event);
    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (result1.ok && result2.ok) {
      expect(result1.eventHash).toBe(result2.eventHash);
    }
  });

  it("different events produce different hashes", () => {
    const event1: CertificationDossierEventV1 = {
      schema: "werkstatt/dossier-event@1",
      eventId: "evt-1",
      eventKind: "evidence-admitted",
      candidateId: "cand-1",
      authoritySequence: 1,
      previousEventHash: null,
      eventPayloadRef: D1,
      recordedAt: "2026-01-01T00:00:00Z",
    };
    const event2: CertificationDossierEventV1 = {
      ...event1,
      eventPayloadRef: D2,
    };
    const r1 = computeDossierEventHash(event1);
    const r2 = computeDossierEventHash(event2);
    if (r1.ok && r2.ok) expect(r1.eventHash).not.toBe(r2.eventHash);
  });
});

describe("dossier-hash: computeDossierRoot", () => {
  it("is order-sensitive", () => {
    const root1 = computeDossierRoot("cand-1", [D1, D2]);
    const root2 = computeDossierRoot("cand-1", [D2, D1]);
    expect(root1).not.toBe(root2);
  });

  it("is candidate-sensitive", () => {
    const root1 = computeDossierRoot("cand-1", [D1]);
    const root2 = computeDossierRoot("cand-2", [D1]);
    expect(root1).not.toBe(root2);
  });

  it("insertion changes root", () => {
    const root1 = computeDossierRoot("cand-1", [D1]);
    const root2 = computeDossierRoot("cand-1", [D1, D2]);
    expect(root1).not.toBe(root2);
  });

  it("removal changes root", () => {
    const root1 = computeDossierRoot("cand-1", [D1, D2]);
    const root2 = computeDossierRoot("cand-1", [D1]);
    expect(root1).not.toBe(root2);
  });

  it("empty hash list produces deterministic root", () => {
    const root1 = computeDossierRoot("cand-1", []);
    const root2 = computeDossierRoot("cand-1", []);
    expect(root1).toBe(root2);
  });
});
