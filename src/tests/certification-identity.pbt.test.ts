import { describe, it, expect } from "vitest";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import {
  buildReleaseCandidateIdentityV1,
  buildPolicyBundleIdentityV1,
  buildEvidenceIdentityV1,
  buildDossierEventIdentityV1,
  buildGateDecisionIdentityV1,
  buildMainVerificationIdentityV1,
  buildHealthDecisionIdentityV1,
  buildActionPackIdentityV1,
  buildDeploymentOperationEventIdentityV1,
} from "../certification/identity.ts";
import {
  releaseCandidateV1Schema,
  evidenceEnvelopeV1Schema,
  dossierEventV1Schema,
  gateDecisionV1Schema,
  mainVerificationDecisionV1Schema,
  certificationHealthDecisionV1Schema,
  certificationActionPackV1Schema,
  deploymentOperationEventV1Schema,
  certificationPolicyBundleV1Schema,
} from "../certification/contracts/index.ts";
import type {
  ReleaseCandidateV1,
  EvidenceEnvelopeV1,
  CertificationDossierEventV1,
  GateDecisionV1,
  MainVerificationDecisionV1,
  CertificationHealthDecisionV1,
  CertificationActionPackV1,
  DeploymentOperationEventV1,
  CertificationPolicyBundleV1,
} from "../certification/contracts/index.ts";

const D = ("sha256:" + "a".repeat(64)) as Sha256Digest;
const D2 = ("sha256:" + "b".repeat(64)) as Sha256Digest;
const TS = "2026-08-15T12:00:00Z";

function makeCandidate(): ReleaseCandidateV1 {
  return releaseCandidateV1Schema.parse({
    schema: "werkstatt/release-candidate@1",
    candidateId: "cand-test",
    systemId: "sys-1",
    releaseVersion: "1.0.0",
    sourceHash: D,
    contentHash: D,
    artifactHash: D,
    buildConfig: {
      schema: "werkstatt/build-config@1",
      buildConfigHash: D,
      toolchainId: "tc-1",
      sourceRef: "src/index.ts",
      contentHash: D,
    },
    deploymentPlan: {
      schema: "werkstatt/deployment-plan@1",
      deploymentPlanHash: D,
      channel: "dev",
      target: "target-1",
      environmentRefs: ["env-1"],
    },
    policyBundleRoot: D,
    toolchainId: "tc-1",
    observedEnvironment: {
      schema: "werkstatt/observed-environment@1",
      environment: "dev",
      environmentIdentityHash: D,
      observedAt: TS,
    },
    observedAt: TS,
  });
}

function makeEvidence(): EvidenceEnvelopeV1 {
  return evidenceEnvelopeV1Schema.parse({
    schema: "werkstatt/evidence-envelope@1",
    evidenceId: "ev-test",
    candidateId: "cand-test",
    producerId: "prod-1",
    producerAttemptId: "att-1",
    producedAt: TS,
    result: {
      schema: "werkstatt/evidence-result@1",
      producerId: "prod-1",
      producerAttemptId: "att-1",
      diagnostics: [],
      bindingHash: D,
      applicability: { appliesTo: ["req-1"], scope: "gate" },
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
  });
}

function makeDossierEvent(): CertificationDossierEventV1 {
  return dossierEventV1Schema.parse({
    schema: "werkstatt/dossier-event@1",
    eventId: "evt-test",
    eventKind: "evidence-admitted",
    candidateId: "cand-test",
    authoritySequence: 1,
    previousEventHash: null,
    eventPayloadRef: D,
    recordedAt: TS,
  });
}

function makeGateDecision(): GateDecisionV1 {
  return gateDecisionV1Schema.parse({
    schema: "werkstatt/gate-decision@1",
    decisionId: "dec-test",
    candidateId: "cand-test",
    policyBundleRoot: D,
    gate: "dev",
    evaluationCut: 1,
    selectedEvidence: [],
    status: "pass",
    coverage: {
      schema: "werkstatt/coverage-report@1",
      totalRequirements: 1,
      coveredRequirements: 1,
      uncoveredRequirements: [],
    },
    reasons: ["ok"],
    actionPackRef: null,
    decidedAt: TS,
  });
}

function makeMainVerification(): MainVerificationDecisionV1 {
  return mainVerificationDecisionV1Schema.parse({
    schema: "werkstatt/main-verification-decision@1",
    decisionId: "dec-test",
    candidateId: "cand-test",
    policyBundleRoot: D,
    gate: "main",
    evaluationCut: 1,
    selectedEvidence: [],
    status: "pass",
    coverage: {
      schema: "werkstatt/coverage-report@1",
      totalRequirements: 1,
      coveredRequirements: 1,
      uncoveredRequirements: [],
    },
    reasons: ["ok"],
    actionPackRef: null,
    rootDossierRef: D,
    priorOperationRef: null,
    decidedAt: TS,
  });
}

function makeHealthDecision(): CertificationHealthDecisionV1 {
  return certificationHealthDecisionV1Schema.parse({
    schema: "werkstatt/certification-health-decision@1",
    candidateId: "cand-test",
    currentStatus: "pass",
    lastDecisionId: "dec-test",
    lastDecisionAt: TS,
    staleEvidenceCount: 0,
    incompleteCount: 0,
    assessedAt: TS,
  });
}

function makeActionPack(): CertificationActionPackV1 {
  return certificationActionPackV1Schema.parse({
    schema: "werkstatt/certification-action-pack@1",
    actionPackId: "pack-1",
    candidateId: "cand-test",
    decisionId: "dec-test",
    tasks: [],
    createdAt: TS,
  });
}

function makeDeploymentEvent(): DeploymentOperationEventV1 {
  return deploymentOperationEventV1Schema.parse({
    schema: "werkstatt/deployment-operation-event@1",
    eventId: "evt-test",
    operationId: "op-test",
    candidateId: "cand-test",
    channel: "dev",
    target: "target-1",
    environment: "dev",
    deploymentPlanHash: D,
    environmentIdentityHash: D,
    authoritySequence: 1,
    previousEventHash: null,
    eventKind: "operation-started",
    result: null,
    recordedAt: TS,
  });
}

function makePolicyBundle(): CertificationPolicyBundleV1 {
  return certificationPolicyBundleV1Schema.parse({
    schema: "werkstatt/certification-policy-bundle@1",
    policyBundleId: "policy-1",
    version: "1.0.0",
    profileId: "profile-1",
    resolvedRequirements: [],
    producerManifests: [],
    rubricManifests: [],
    toolchainManifests: [],
    issuerManifests: [],
    riskPolicy: { maxStale: 0, maxIncomplete: 0, blockOnFail: true },
    retention: { minRetentionDays: 30, maxRetentionDays: 365 },
    materializedAt: TS,
  });
}

describe("certification identity: basic builder success", () => {
  it("builds release candidate identity", () => {
    const result = buildReleaseCandidateIdentityV1(makeCandidate());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.payload.schema).toBe("werkstatt/release-candidate-identity@1");
  });

  it("builds policy bundle identity", () => {
    const result = buildPolicyBundleIdentityV1(makePolicyBundle());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("builds evidence identity", () => {
    const result = buildEvidenceIdentityV1(makeEvidence());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("builds dossier event identity", () => {
    const result = buildDossierEventIdentityV1(makeDossierEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("builds gate decision identity", () => {
    const result = buildGateDecisionIdentityV1(makeGateDecision());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("builds main verification identity", () => {
    const result = buildMainVerificationIdentityV1(makeMainVerification());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("builds health decision identity", () => {
    const result = buildHealthDecisionIdentityV1(makeHealthDecision());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("builds action pack identity", () => {
    const result = buildActionPackIdentityV1(makeActionPack());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("builds deployment event identity", () => {
    const result = buildDeploymentOperationEventIdentityV1(makeDeploymentEvent());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("certification identity: included field sensitivity", () => {
  it("candidate identity changes when sourceHash changes", () => {
    const c1 = makeCandidate();
    const r1 = buildReleaseCandidateIdentityV1(c1);
    const c2 = { ...c1, sourceHash: D2 };
    const r2 = buildReleaseCandidateIdentityV1(c2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).not.toBe(r2.digest);
  });

  it("candidate identity changes when buildConfigHash changes", () => {
    const c1 = makeCandidate();
    const r1 = buildReleaseCandidateIdentityV1(c1);
    const c2 = { ...c1, buildConfig: { ...c1.buildConfig, buildConfigHash: D2 } };
    const r2 = buildReleaseCandidateIdentityV1(c2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).not.toBe(r2.digest);
  });

  it("candidate identity changes when policyBundleRoot changes", () => {
    const c1 = makeCandidate();
    const r1 = buildReleaseCandidateIdentityV1(c1);
    const c2 = { ...c1, policyBundleRoot: D2 };
    const r2 = buildReleaseCandidateIdentityV1(c2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).not.toBe(r2.digest);
  });

  it("evidence identity changes when result bindingHash changes", () => {
    const e1 = makeEvidence();
    const r1 = buildEvidenceIdentityV1(e1);
    const e2 = {
      ...e1,
      result: { ...e1.result, bindingHash: D2 },
    };
    const r2 = buildEvidenceIdentityV1(e2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).not.toBe(r2.digest);
  });

  it("dossier event identity changes when eventKind changes", () => {
    const d1 = makeDossierEvent();
    const r1 = buildDossierEventIdentityV1(d1);
    const d2 = { ...d1, eventKind: "decision-recorded" as const };
    const r2 = buildDossierEventIdentityV1(d2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).not.toBe(r2.digest);
  });

  it("gate decision identity changes when status changes", () => {
    const g1 = makeGateDecision();
    const r1 = buildGateDecisionIdentityV1(g1);
    const g2 = { ...g1, status: "fail" as const };
    const r2 = buildGateDecisionIdentityV1(g2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).not.toBe(r2.digest);
  });

  it("action pack identity changes when tasks change", () => {
    const a1 = makeActionPack();
    const r1 = buildActionPackIdentityV1(a1);
    const a2 = {
      ...a1,
      tasks: [
        {
          taskId: "act-task-1",
          remediationClass: "fix-class",
          description: "fix something",
          verificationCommand: "pnpm test",
          anchors: [],
          dependencies: [],
        },
      ],
    };
    const r2 = buildActionPackIdentityV1(a2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).not.toBe(r2.digest);
  });

  it("deployment event identity changes when eventKind changes", () => {
    const d1 = makeDeploymentEvent();
    const r1 = buildDeploymentOperationEventIdentityV1(d1);
    const d2 = { ...d1, eventKind: "operation-succeeded" as const };
    const r2 = buildDeploymentOperationEventIdentityV1(d2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).not.toBe(r2.digest);
  });
});

describe("certification identity: excluded field sensitivity", () => {
  it("candidate identity does NOT change when candidateId changes", () => {
    const c1 = makeCandidate();
    const r1 = buildReleaseCandidateIdentityV1(c1);
    const c2 = { ...c1, candidateId: "cand-different" };
    const r2 = buildReleaseCandidateIdentityV1(c2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).toBe(r2.digest);
  });

  it("candidate identity does NOT change when observedAt changes", () => {
    const c1 = makeCandidate();
    const r1 = buildReleaseCandidateIdentityV1(c1);
    const c2 = { ...c1, observedAt: "2026-09-01T00:00:00Z" };
    const r2 = buildReleaseCandidateIdentityV1(c2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).toBe(r2.digest);
  });

  it("candidate identity does NOT change when observedEnvironment changes", () => {
    const c1 = makeCandidate();
    const r1 = buildReleaseCandidateIdentityV1(c1);
    const c2 = {
      ...c1,
      observedEnvironment: {
        ...c1.observedEnvironment,
        environment: "alt" as const,
        environmentIdentityHash: D2,
      },
    };
    const r2 = buildReleaseCandidateIdentityV1(c2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).toBe(r2.digest);
  });

  it("evidence identity does NOT change when evidenceId changes", () => {
    const e1 = makeEvidence();
    const r1 = buildEvidenceIdentityV1(e1);
    const e2 = { ...e1, evidenceId: "ev-different" };
    const r2 = buildEvidenceIdentityV1(e2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).toBe(r2.digest);
  });

  it("evidence identity does NOT change when payload locator changes", () => {
    const base = makeEvidence();
    const e1 = {
      ...base,
      payloads: [
        {
          payloadDigest: D,
          mediaType: "application/json",
          sizeBytes: 100,
          role: "primary" as const,
          locator: "https://example.com/payload-a",
        },
      ],
    };
    const r1 = buildEvidenceIdentityV1(e1);
    const e2 = {
      ...base,
      payloads: [
        {
          payloadDigest: D,
          mediaType: "application/json",
          sizeBytes: 100,
          role: "primary" as const,
          locator: "https://example.com/payload-b",
        },
      ],
    };
    const r2 = buildEvidenceIdentityV1(e2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).toBe(r2.digest);
  });

  it("dossier event identity does NOT change when eventId changes", () => {
    const d1 = makeDossierEvent();
    const r1 = buildDossierEventIdentityV1(d1);
    const d2 = { ...d1, eventId: "evt-different" };
    const r2 = buildDossierEventIdentityV1(d2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).toBe(r2.digest);
  });

  it("gate decision identity does NOT change when decidedAt changes", () => {
    const g1 = makeGateDecision();
    const r1 = buildGateDecisionIdentityV1(g1);
    const g2 = { ...g1, decidedAt: "2026-09-01T00:00:00Z" };
    const r2 = buildGateDecisionIdentityV1(g2);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).toBe(r2.digest);
  });
});

describe("certification identity: redaction closure", () => {
  it("rejects evidence with unresolved redaction", () => {
    const e = makeEvidence();
    const unresolved = {
      ...e,
      redaction: {
        ...e.redaction,
        resolved: false,
        detectedSecrets: 1,
        unresolvedSecrets: 1,
      },
    };
    const result = buildEvidenceIdentityV1(unresolved);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe("CERT-REDACTION-01");
  });
});

describe("certification identity: determinism", () => {
  it("same input produces same digest", () => {
    const c = makeCandidate();
    const r1 = buildReleaseCandidateIdentityV1(c);
    const r2 = buildReleaseCandidateIdentityV1(c);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).toBe(r2.digest);
  });

  it("policy bundle determinism", () => {
    const p = makePolicyBundle();
    const r1 = buildPolicyBundleIdentityV1(p);
    const r2 = buildPolicyBundleIdentityV1(p);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).toBe(r2.digest);
  });

  it("evidence determinism", () => {
    const e = makeEvidence();
    const r1 = buildEvidenceIdentityV1(e);
    const r2 = buildEvidenceIdentityV1(e);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.digest).toBe(r2.digest);
  });
});
