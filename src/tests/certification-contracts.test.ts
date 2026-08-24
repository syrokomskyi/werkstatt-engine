import { describe, it, expect } from "vitest";
import {
  digestSchema,
  candidateIdSchema,
  evidenceIdSchema,
  decisionIdSchema,
  actionIdSchema,
  eventIdSchema,
  operationIdSchema,
  attemptIdSchema,
  authoritySequenceSchema,
  humanReadableIdSchema,
  utcTimestampSchema,
  gateChannelSchema,
  environmentSchema,
  certificationStatusSchema,
  safeSemanticPathSchema,
  safeLocatorSchema,
  schemaIdSchema,
  buildConfigV1Schema,
  deploymentPlanV1Schema,
  observedEnvironmentV1Schema,
  releaseCandidateV1Schema,
  producerManifestV1Schema,
  rubricManifestV1Schema,
  toolchainManifestV1Schema,
  issuerManifestV1Schema,
  resolvedRequirementV1Schema,
  certificationPolicyBundleV1Schema,
  payloadDescriptorV1Schema,
  redactionReportV1Schema,
  attestationStatementV1Schema,
  authorityAdmissionV1Schema,
  evidenceResultV1Schema,
  evidenceEnvelopeV1Schema,
  dossierEventKindSchema,
  dossierEventV1Schema,
  dossierManifestProjectionV1Schema,
  dossierIncidentV1Schema,
  dossierTombstoneV1Schema,
  dossierRootReferenceV1Schema,
  coverageReportV1Schema,
  selectedEvidenceV1Schema,
  gateDecisionV1Schema,
  mainVerificationDecisionV1Schema,
  certificationHealthDecisionV1Schema,
  actionAnchorV1Schema,
  actionDependencyV1Schema,
  actionTaskV1Schema,
  certificationActionPackV1Schema,
  issuerRegistryEntryV1Schema,
  attestationVerificationV1Schema,
  signedDecisionV1Schema,
  signedRootV1Schema,
  operationAuthorizationV1Schema,
  nonAuthoritativePreviewV1Schema,
  artifactReadinessV1Schema,
  deploymentOperationStateV1Schema,
  deploymentOperationEventV1Schema,
} from "../certification/index.ts";

const VALID_DIGEST = "sha256:" + "a".repeat(64);
const VALID_TIMESTAMP = "2026-08-15T12:00:00Z";

describe("certification contracts: traceability inventory", () => {
  it("exports all required top-level schemas", () => {
    expect(digestSchema).toBeDefined();
    expect(schemaIdSchema).toBeDefined();
    expect(candidateIdSchema).toBeDefined();
    expect(evidenceIdSchema).toBeDefined();
    expect(decisionIdSchema).toBeDefined();
    expect(actionIdSchema).toBeDefined();
    expect(eventIdSchema).toBeDefined();
    expect(operationIdSchema).toBeDefined();
    expect(attemptIdSchema).toBeDefined();
    expect(authoritySequenceSchema).toBeDefined();
    expect(humanReadableIdSchema).toBeDefined();
    expect(utcTimestampSchema).toBeDefined();
    expect(gateChannelSchema).toBeDefined();
    expect(environmentSchema).toBeDefined();
    expect(certificationStatusSchema).toBeDefined();
    expect(safeSemanticPathSchema).toBeDefined();
    expect(safeLocatorSchema).toBeDefined();
    expect(buildConfigV1Schema).toBeDefined();
    expect(deploymentPlanV1Schema).toBeDefined();
    expect(observedEnvironmentV1Schema).toBeDefined();
    expect(releaseCandidateV1Schema).toBeDefined();
    expect(producerManifestV1Schema).toBeDefined();
    expect(rubricManifestV1Schema).toBeDefined();
    expect(toolchainManifestV1Schema).toBeDefined();
    expect(issuerManifestV1Schema).toBeDefined();
    expect(resolvedRequirementV1Schema).toBeDefined();
    expect(certificationPolicyBundleV1Schema).toBeDefined();
    expect(payloadDescriptorV1Schema).toBeDefined();
    expect(redactionReportV1Schema).toBeDefined();
    expect(attestationStatementV1Schema).toBeDefined();
    expect(authorityAdmissionV1Schema).toBeDefined();
    expect(evidenceResultV1Schema).toBeDefined();
    expect(evidenceEnvelopeV1Schema).toBeDefined();
    expect(dossierEventKindSchema).toBeDefined();
    expect(dossierEventV1Schema).toBeDefined();
    expect(dossierManifestProjectionV1Schema).toBeDefined();
    expect(dossierIncidentV1Schema).toBeDefined();
    expect(dossierTombstoneV1Schema).toBeDefined();
    expect(dossierRootReferenceV1Schema).toBeDefined();
    expect(coverageReportV1Schema).toBeDefined();
    expect(selectedEvidenceV1Schema).toBeDefined();
    expect(gateDecisionV1Schema).toBeDefined();
    expect(mainVerificationDecisionV1Schema).toBeDefined();
    expect(certificationHealthDecisionV1Schema).toBeDefined();
    expect(actionAnchorV1Schema).toBeDefined();
    expect(actionDependencyV1Schema).toBeDefined();
    expect(actionTaskV1Schema).toBeDefined();
    expect(certificationActionPackV1Schema).toBeDefined();
    expect(issuerRegistryEntryV1Schema).toBeDefined();
    expect(attestationVerificationV1Schema).toBeDefined();
    expect(signedDecisionV1Schema).toBeDefined();
    expect(signedRootV1Schema).toBeDefined();
    expect(operationAuthorizationV1Schema).toBeDefined();
    expect(nonAuthoritativePreviewV1Schema).toBeDefined();
    expect(artifactReadinessV1Schema).toBeDefined();
    expect(deploymentOperationStateV1Schema).toBeDefined();
    expect(deploymentOperationEventV1Schema).toBeDefined();
  });
});

describe("certification contracts: identifier primitives", () => {
  it("accepts valid digest", () => {
    expect(digestSchema.safeParse(VALID_DIGEST).success).toBe(true);
  });

  it("rejects invalid digest (missing prefix)", () => {
    expect(digestSchema.safeParse("a".repeat(64)).success).toBe(false);
  });

  it("rejects invalid digest (uppercase hex)", () => {
    expect(digestSchema.safeParse("sha256:" + "A".repeat(64)).success).toBe(false);
  });

  it("accepts valid candidate id", () => {
    expect(candidateIdSchema.safeParse("cand-my-candidate").success).toBe(true);
  });

  it("rejects invalid candidate id (wrong prefix)", () => {
    expect(candidateIdSchema.safeParse("bad-id").success).toBe(false);
  });

  it("accepts valid evidence id", () => {
    expect(evidenceIdSchema.safeParse("ev-my-evidence").success).toBe(true);
  });

  it("accepts valid decision id", () => {
    expect(decisionIdSchema.safeParse("dec-my-decision").success).toBe(true);
  });

  it("accepts valid action id", () => {
    expect(actionIdSchema.safeParse("act-my-action").success).toBe(true);
  });

  it("accepts valid event id", () => {
    expect(eventIdSchema.safeParse("evt-my-event").success).toBe(true);
  });

  it("accepts valid operation id", () => {
    expect(operationIdSchema.safeParse("op-my-operation").success).toBe(true);
  });

  it("accepts valid attempt id", () => {
    expect(attemptIdSchema.safeParse("att-my-attempt").success).toBe(true);
  });

  it("accepts non-negative authority sequence", () => {
    expect(authoritySequenceSchema.safeParse(0).success).toBe(true);
    expect(authoritySequenceSchema.safeParse(42).success).toBe(true);
  });

  it("rejects negative authority sequence", () => {
    expect(authoritySequenceSchema.safeParse(-1).success).toBe(false);
  });

  it("accepts valid RFC 3339 timestamp", () => {
    expect(utcTimestampSchema.safeParse(VALID_TIMESTAMP).success).toBe(true);
  });

  it("rejects non-RFC 3339 timestamp", () => {
    expect(utcTimestampSchema.safeParse("2026-08-15").success).toBe(false);
  });

  it("accepts valid gate channels", () => {
    expect(gateChannelSchema.safeParse("dev").success).toBe(true);
    expect(gateChannelSchema.safeParse("alt").success).toBe(true);
    expect(gateChannelSchema.safeParse("main").success).toBe(true);
  });

  it("rejects unknown gate channel", () => {
    expect(gateChannelSchema.safeParse("prod").success).toBe(false);
  });

  it("accepts valid environments", () => {
    expect(environmentSchema.safeParse("dev").success).toBe(true);
    expect(environmentSchema.safeParse("staging").success).toBe(true);
  });

  it("accepts valid certification statuses", () => {
    expect(certificationStatusSchema.safeParse("pass").success).toBe(true);
    expect(certificationStatusSchema.safeParse("fail").success).toBe(true);
    expect(certificationStatusSchema.safeParse("stale").success).toBe(true);
  });

  it("rejects unknown certification status", () => {
    expect(certificationStatusSchema.safeParse("unknown").success).toBe(false);
  });

  it("accepts safe semantic path", () => {
    expect(safeSemanticPathSchema.safeParse("src/index.ts").success).toBe(true);
  });

  it("rejects absolute path", () => {
    expect(safeSemanticPathSchema.safeParse("/etc/passwd").success).toBe(false);
  });

  it("rejects backslash path", () => {
    expect(safeSemanticPathSchema.safeParse("src\\index.ts").success).toBe(false);
  });

  it("rejects path with ..", () => {
    expect(safeSemanticPathSchema.safeParse("../secret").success).toBe(false);
  });

  it("accepts safe locator without credentials", () => {
    expect(safeLocatorSchema.safeParse("https://example.com/path").success).toBe(true);
  });
});

describe("certification contracts: strict schema enforcement", () => {
  function makeValidBuildConfig() {
    return {
      schema: "werkstatt/build-config@1",
      buildConfigHash: VALID_DIGEST,
      toolchainId: "toolchain-1",
      sourceRef: "src/index.ts",
      contentHash: VALID_DIGEST,
    };
  }

  function makeValidDeploymentPlan() {
    return {
      schema: "werkstatt/deployment-plan@1",
      deploymentPlanHash: VALID_DIGEST,
      channel: "dev",
      target: "target-1",
      environmentRefs: ["env-1"],
    };
  }

  function makeValidObservedEnvironment() {
    return {
      schema: "werkstatt/observed-environment@1",
      environment: "dev",
      environmentIdentityHash: VALID_DIGEST,
      observedAt: VALID_TIMESTAMP,
    };
  }

  function makeValidReleaseCandidate() {
    return {
      schema: "werkstatt/release-candidate@1",
      candidateId: "cand-my-candidate",
      systemId: "system-1",
      releaseVersion: "1.0.0",
      sourceHash: VALID_DIGEST,
      contentHash: VALID_DIGEST,
      artifactHash: VALID_DIGEST,
      buildConfig: makeValidBuildConfig(),
      deploymentPlan: makeValidDeploymentPlan(),
      policyBundleRoot: VALID_DIGEST,
      toolchainId: "toolchain-1",
      observedEnvironment: makeValidObservedEnvironment(),
      observedAt: VALID_TIMESTAMP,
    };
  }

  it("parses valid release candidate", () => {
    const result = releaseCandidateV1Schema.safeParse(makeValidReleaseCandidate());
    expect(result.success).toBe(true);
  });

  it("rejects release candidate with unknown field", () => {
    const input = makeValidReleaseCandidate() as Record<string, unknown>;
    input.extra = "field";
    expect(releaseCandidateV1Schema.safeParse(input).success).toBe(false);
  });

  it("rejects release candidate with wrong schema id", () => {
    const input = makeValidReleaseCandidate();
    (input as { schema: string }).schema = "werkstatt/wrong@1";
    expect(releaseCandidateV1Schema.safeParse(input).success).toBe(false);
  });

  it("rejects build config with unknown field", () => {
    const input = makeValidBuildConfig() as Record<string, unknown>;
    input.extra = "field";
    expect(buildConfigV1Schema.safeParse(input).success).toBe(false);
  });

  it("parses valid policy bundle", () => {
    const input = {
      schema: "werkstatt/certification-policy-bundle@1",
      policyBundleId: "policy-1",
      version: "1.0.0",
      profileId: "profile-1",
      resolvedRequirements: [
        {
          requirementId: "req-1",
          source: "RFC-0853",
          description: "strict schemas",
          mandatory: true,
        },
      ],
      producerManifests: [],
      rubricManifests: [],
      toolchainManifests: [],
      issuerManifests: [],
      riskPolicy: { maxStale: 0, maxIncomplete: 0, blockOnFail: true },
      retention: { minRetentionDays: 30, maxRetentionDays: 365 },
      materializedAt: VALID_TIMESTAMP,
    };
    expect(certificationPolicyBundleV1Schema.safeParse(input).success).toBe(true);
  });

  it("rejects policy bundle with unknown field", () => {
    const input = {
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
      materializedAt: VALID_TIMESTAMP,
      extra: "field",
    };
    expect(certificationPolicyBundleV1Schema.safeParse(input).success).toBe(false);
  });

  it("parses valid evidence envelope with resolved redaction", () => {
    const input = {
      schema: "werkstatt/evidence-envelope@1",
      evidenceId: "ev-my-evidence",
      candidateId: "cand-my-candidate",
      producerId: "producer-1",
      producerAttemptId: "att-my-attempt",
      producedAt: VALID_TIMESTAMP,
      result: {
        schema: "werkstatt/evidence-result@1",
        producerId: "producer-1",
        producerAttemptId: "att-my-attempt",
        diagnostics: [],
        bindingHash: VALID_DIGEST,
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
      freshness: {
        expiresAt: VALID_TIMESTAMP,
        staleAfter: VALID_TIMESTAMP,
      },
    };
    expect(evidenceEnvelopeV1Schema.safeParse(input).success).toBe(true);
  });

  it("rejects evidence envelope with unresolved redaction", () => {
    const input = {
      schema: "werkstatt/evidence-envelope@1",
      evidenceId: "ev-my-evidence",
      candidateId: "cand-my-candidate",
      producerId: "producer-1",
      producerAttemptId: "att-my-attempt",
      producedAt: VALID_TIMESTAMP,
      result: {
        schema: "werkstatt/evidence-result@1",
        producerId: "producer-1",
        producerAttemptId: "att-my-attempt",
        diagnostics: [],
        bindingHash: VALID_DIGEST,
        applicability: { appliesTo: ["req-1"], scope: "gate" },
      },
      payloads: [],
      redaction: {
        schema: "werkstatt/redaction-report@1",
        policyVersion: "1.0.0",
        detectedSecrets: 1,
        detectedPii: 0,
        resolved: false,
        unresolvedSecrets: 1,
        unresolvedPii: 0,
      },
      freshness: {
        expiresAt: VALID_TIMESTAMP,
        staleAfter: VALID_TIMESTAMP,
      },
    };
    const result = evidenceEnvelopeV1Schema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("parses valid dossier event", () => {
    const input = {
      schema: "werkstatt/dossier-event@1",
      eventId: "evt-my-event",
      eventKind: "evidence-admitted",
      candidateId: "cand-my-candidate",
      authoritySequence: 1,
      previousEventHash: null,
      eventPayloadRef: VALID_DIGEST,
      recordedAt: VALID_TIMESTAMP,
    };
    expect(dossierEventV1Schema.safeParse(input).success).toBe(true);
  });

  it("rejects dossier event with unknown event kind", () => {
    const input = {
      schema: "werkstatt/dossier-event@1",
      eventId: "evt-my-event",
      eventKind: "unknown",
      candidateId: "cand-my-candidate",
      authoritySequence: 1,
      previousEventHash: null,
      eventPayloadRef: VALID_DIGEST,
      recordedAt: VALID_TIMESTAMP,
    };
    expect(dossierEventV1Schema.safeParse(input).success).toBe(false);
  });

  it("parses valid gate decision", () => {
    const input = {
      schema: "werkstatt/gate-decision@1",
      decisionId: "dec-my-decision",
      candidateId: "cand-my-candidate",
      policyBundleRoot: VALID_DIGEST,
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
      reasons: ["all checks passed"],
      actionPackRef: null,
      decidedAt: VALID_TIMESTAMP,
    };
    expect(gateDecisionV1Schema.safeParse(input).success).toBe(true);
  });

  it("parses valid main verification decision", () => {
    const input = {
      schema: "werkstatt/main-verification-decision@1",
      decisionId: "dec-my-decision",
      candidateId: "cand-my-candidate",
      policyBundleRoot: VALID_DIGEST,
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
      reasons: ["all checks passed"],
      actionPackRef: null,
      rootDossierRef: VALID_DIGEST,
      priorOperationRef: null,
      decidedAt: VALID_TIMESTAMP,
    };
    expect(mainVerificationDecisionV1Schema.safeParse(input).success).toBe(true);
  });

  it("rejects main verification decision with wrong gate", () => {
    const input = {
      schema: "werkstatt/main-verification-decision@1",
      decisionId: "dec-my-decision",
      candidateId: "cand-my-candidate",
      policyBundleRoot: VALID_DIGEST,
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
      reasons: ["all checks passed"],
      actionPackRef: null,
      rootDossierRef: VALID_DIGEST,
      priorOperationRef: null,
      decidedAt: VALID_TIMESTAMP,
    };
    expect(mainVerificationDecisionV1Schema.safeParse(input).success).toBe(false);
  });

  it("parses valid action pack", () => {
    const input = {
      schema: "werkstatt/certification-action-pack@1",
      actionPackId: "pack-1",
      candidateId: "cand-my-candidate",
      decisionId: "dec-my-decision",
      tasks: [],
      createdAt: VALID_TIMESTAMP,
    };
    expect(certificationActionPackV1Schema.safeParse(input).success).toBe(true);
  });

  it("parses valid deployment operation event", () => {
    const input = {
      schema: "werkstatt/deployment-operation-event@1",
      eventId: "evt-my-event",
      operationId: "op-my-operation",
      candidateId: "cand-my-candidate",
      channel: "dev",
      target: "target-1",
      environment: "dev",
      deploymentPlanHash: VALID_DIGEST,
      environmentIdentityHash: VALID_DIGEST,
      authoritySequence: 1,
      previousEventHash: null,
      eventKind: "operation-started",
      result: null,
      recordedAt: VALID_TIMESTAMP,
    };
    expect(deploymentOperationEventV1Schema.safeParse(input).success).toBe(true);
  });

  it("rejects deployment operation event with unknown field", () => {
    const input = {
      schema: "werkstatt/deployment-operation-event@1",
      eventId: "evt-my-event",
      operationId: "op-my-operation",
      candidateId: "cand-my-candidate",
      channel: "dev",
      target: "target-1",
      environment: "dev",
      deploymentPlanHash: VALID_DIGEST,
      environmentIdentityHash: VALID_DIGEST,
      authoritySequence: 1,
      previousEventHash: null,
      eventKind: "operation-started",
      result: null,
      recordedAt: VALID_TIMESTAMP,
      extra: "field",
    };
    expect(deploymentOperationEventV1Schema.safeParse(input).success).toBe(false);
  });
});
