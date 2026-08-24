import { describe, it, expect } from "vitest";
import {
  createProducerRegistry,
  evaluateApplicability,
  checkFalsePass,
  planRouteStateViewportMatrix,
  normalizeDiagnostics,
  executeProducer,
} from "../certification/producers/index.ts";
import type {
  ProducerContextV1,
  ProducerResultV1,
  ProducerDeclarationV1,
  ViewportSpecV1,
} from "../certification/producers/index.ts";
import type {
  ReleaseCandidateV1,
  CertificationPolicyBundleV1,
  ResolvedRequirementV1,
} from "../certification/index.ts";
import type { CertificationProfileV1 } from "../certification/profile/schemas.ts";
import type { ApplicabilityRuleV1 } from "../certification/profile/schemas.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import type { Diagnostic } from "../schemas/diagnostic.ts";

const D =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000" as string as Sha256Digest;
const D1 =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111" as string as Sha256Digest;
const TS = "2026-08-15T12:00:00Z";

function mkCandidate(): ReleaseCandidateV1 {
  return {
    schema: "werkstatt/release-candidate@1",
    candidateId: "cand-001",
    systemId: "system-001",
    releaseVersion: "1.0.0",
    sourceHash: D,
    contentHash: D1,
    artifactHash: D,
    buildConfig: {
      schema: "werkstatt/build-config@1",
      buildConfigHash: D,
      toolchainId: "toolchain-001",
      sourceRef: "src/",
      contentHash: D1,
    },
    deploymentPlan: {
      schema: "werkstatt/deployment-plan@1",
      deploymentPlanHash: D,
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

function mkProfile(producerIds: string[] = ["p1"]): CertificationProfileV1 {
  const producers: Record<string, ProducerDeclarationV1> = {};
  for (const id of producerIds) {
    producers[id] = {
      id,
      kind: "kernel-command",
      command: `cmd-${id}`,
      outputSchema: "werkstatt/evidence-result@1",
      versionSource: "package-version",
      requiredPayloadRoles: ["primary"],
    };
  }
  return {
    schema: "werkstatt/certification-profile@1",
    id: "site-profile-v1",
    version: "1.0.0",
    plugin: {
      id: "werkstatt-site",
      profileId: "astro-typescript-turborepo",
    },
    dimensions: ["candidate-integrity"],
    producers,
    requirements: [
      {
        id: "req-001",
        title: "test requirement",
        dimension: "core",
        gates: ["dev-deploy"],
        classification: "required",
        applicability: { kind: "always" },
        producerId: "p1",
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

function mkContext(): ProducerContextV1 {
  return {
    candidate: mkCandidate(),
    profile: mkProfile(),
    policyBundle: mkPolicyBundle(),
    environment: "dev",
    toolchainId: "toolchain-001",
    timestamp: TS,
  };
}

function mkProducerResult(
  producerId: string,
  opts: Partial<ProducerResultV1> = {},
): ProducerResultV1 {
  return {
    producerId,
    requirementIds: ["req-001"],
    diagnostics: [],
    applicabilityResults: [],
    bindingHash: D,
    producedAt: TS,
    ...opts,
  };
}

function mkDiagnostic(severity: "error" | "warning" | "info", ruleId: string): Diagnostic {
  return {
    ruleId,
    severity,
    message: `diagnostic ${ruleId}`,
    evidence: [],
  };
}

describe("createProducerRegistry", () => {
  it("registers a producer", () => {
    const reg = createProducerRegistry();
    const decl: ProducerDeclarationV1 = {
      id: "p1",
      kind: "kernel-command",
      command: "cmd-p1",
      outputSchema: "werkstatt/evidence-result@1",
      versionSource: "package-version",
      requiredPayloadRoles: ["primary"],
    };
    const result = reg.register(decl, async () => mkProducerResult("p1"));
    expect(result.ok).toBe(true);
    expect(reg.has("p1")).toBe(true);
    expect(reg.get("p1")?.declaration.id).toBe("p1");
  });

  it("rejects duplicate registration", () => {
    const reg = createProducerRegistry();
    const decl: ProducerDeclarationV1 = {
      id: "p1",
      kind: "kernel-command",
      command: "cmd-p1",
      outputSchema: "werkstatt/evidence-result@1",
      versionSource: "package-version",
      requiredPayloadRoles: ["primary"],
    };
    reg.register(decl, async () => mkProducerResult("p1"));
    const result = reg.register(decl, async () => mkProducerResult("p1"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-PRODUCER-01");
    }
  });

  it("lists registered producer IDs", () => {
    const reg = createProducerRegistry();
    reg.register(
      {
        id: "p1",
        kind: "kernel-command",
        command: "cmd-p1",
        outputSchema: "werkstatt/evidence-result@1",
        versionSource: "package-version",
        requiredPayloadRoles: ["primary"],
      },
      async () => mkProducerResult("p1"),
    );
    reg.register(
      {
        id: "p2",
        kind: "kernel-command",
        command: "cmd-p2",
        outputSchema: "werkstatt/evidence-result@1",
        versionSource: "package-version",
        requiredPayloadRoles: ["primary"],
      },
      async () => mkProducerResult("p2"),
    );
    expect([...reg.list()].sort()).toEqual(["p1", "p2"]);
  });

  it("validates against profile — all producers registered", () => {
    const reg = createProducerRegistry();
    reg.register(
      {
        id: "p1",
        kind: "kernel-command",
        command: "cmd-p1",
        outputSchema: "werkstatt/evidence-result@1",
        versionSource: "package-version",
        requiredPayloadRoles: ["primary"],
      },
      async () => mkProducerResult("p1"),
    );
    const result = reg.validateAgainstProfile(mkProfile(["p1"]));
    expect(result.ok).toBe(true);
  });

  it("validates against profile — missing producer", () => {
    const reg = createProducerRegistry();
    const result = reg.validateAgainstProfile(mkProfile(["p1", "p2"]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-PRODUCER-03");
      expect(result.missing).toContain("p1");
      expect(result.missing).toContain("p2");
    }
  });
});

describe("evaluateApplicability", () => {
  it("evaluates always rule", () => {
    const rule: ApplicabilityRuleV1 = { kind: "always" };
    const result = evaluateApplicability(rule, mkContext());
    expect(result.applicable).toBe(true);
  });

  it("evaluates entitlement rule", () => {
    const rule: ApplicabilityRuleV1 = { kind: "entitlement", ref: "ent-001", expected: true };
    const result = evaluateApplicability(rule, mkContext());
    expect(result.applicable).toBe(true);
    expect(result.reason).toContain("ent-001");
  });

  it("evaluates config rule", () => {
    const rule: ApplicabilityRuleV1 = { kind: "config", ref: "cfg-001", predicate: "equals" };
    const result = evaluateApplicability(rule, mkContext());
    expect(result.applicable).toBe(true);
    expect(result.reason).toContain("cfg-001");
  });

  it("evaluates surface rule", () => {
    const rule: ApplicabilityRuleV1 = { kind: "surface", ref: "surf-001", predicate: "exists" };
    const result = evaluateApplicability(rule, mkContext());
    expect(result.applicable).toBe(true);
    expect(result.reason).toContain("surf-001");
  });
});

describe("checkFalsePass", () => {
  it("passes for valid result with error diagnostics", () => {
    const result = mkProducerResult("p1", {
      diagnostics: [mkDiagnostic("error", "RULE-01")],
    });
    const check = checkFalsePass(result, mkProfile().requirements);
    expect(check.ok).toBe(true);
  });

  it("fails on empty results (empty-result success)", () => {
    const result = mkProducerResult("p1", {
      requirementIds: [],
      diagnostics: [],
    });
    const check = checkFalsePass(result, mkProfile().requirements);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.ruleId).toBe("CERT-PRODUCER-05");
    }
  });

  it("fails on summary-only warning success for mandatory requirements", () => {
    const result = mkProducerResult("p1", {
      diagnostics: [mkDiagnostic("warning", "WARN-01")],
      requirementIds: ["req-001"],
    });
    const check = checkFalsePass(result, mkProfile().requirements);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.ruleId).toBe("CERT-PRODUCER-06");
    }
  });

  it("passes for warnings on advisory requirements", () => {
    const profile = mkProfile();
    profile.requirements[0].classification = "advisory";
    const result = mkProducerResult("p1", {
      diagnostics: [mkDiagnostic("warning", "WARN-01")],
      requirementIds: ["req-001"],
    });
    const check = checkFalsePass(result, profile.requirements);
    expect(check.ok).toBe(true);
  });
});

describe("planRouteStateViewportMatrix", () => {
  it("generates full combination matrix", () => {
    const viewports: ViewportSpecV1[] = [
      { id: "desktop", width: 1280, height: 720, colorScheme: "light", isMobile: false },
      { id: "mobile", width: 375, height: 667, colorScheme: "light", isMobile: true },
    ];
    const plan = planRouteStateViewportMatrix(["/", "/about"], ["default", "loading"], viewports);
    expect(plan.combinations).toHaveLength(8);
    expect(plan.combinations[0].id).toBe("/::default::desktop");
    expect(plan.combinations[7].id).toBe("/about::loading::mobile");
  });

  it("handles empty inputs", () => {
    const plan = planRouteStateViewportMatrix([], [], []);
    expect(plan.combinations).toHaveLength(0);
  });

  it("handles single route/state/viewport", () => {
    const plan = planRouteStateViewportMatrix(
      ["/"],
      ["default"],
      [{ id: "desktop", width: 1280, height: 720, colorScheme: "light", isMobile: false }],
    );
    expect(plan.combinations).toHaveLength(1);
    expect(plan.combinations[0].route).toBe("/");
    expect(plan.combinations[0].state).toBe("default");
    expect(plan.combinations[0].viewport.id).toBe("desktop");
  });
});

describe("normalizeDiagnostics", () => {
  it("normalizes valid diagnostics", () => {
    const diagnostics: Diagnostic[] = [
      mkDiagnostic("error", "RULE-01"),
      mkDiagnostic("warning", "RULE-02"),
    ];
    const result = normalizeDiagnostics(diagnostics, "p1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics).toHaveLength(2);
    }
  });

  it("deduplicates by ruleId:file:line", () => {
    const diagnostics: Diagnostic[] = [
      { ...mkDiagnostic("error", "RULE-01"), file: "src/a.ts", line: 10 },
      { ...mkDiagnostic("error", "RULE-01"), file: "src/a.ts", line: 10 },
    ];
    const result = normalizeDiagnostics(diagnostics, "p1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("fails on missing ruleId", () => {
    const diagnostics = [{ ruleId: "", severity: "error" as const, message: "msg", evidence: [] }];
    const result = normalizeDiagnostics(diagnostics as unknown as Diagnostic[], "p1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-PRODUCER-08");
    }
  });
});

describe("executeProducer", () => {
  it("executes a registered producer successfully", async () => {
    const reg = createProducerRegistry();
    reg.register(
      {
        id: "p1",
        kind: "kernel-command",
        command: "cmd-p1",
        outputSchema: "werkstatt/evidence-result@1",
        versionSource: "package-version",
        requiredPayloadRoles: ["primary"],
      },
      async () =>
        mkProducerResult("p1", {
          diagnostics: [mkDiagnostic("error", "RULE-01")],
        }),
    );

    const result = await executeProducer(reg, {
      producerId: "p1",
      context: mkContext(),
      requirements: mkProfile().requirements,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence.schema).toBe("werkstatt/evidence-envelope@1");
      expect(result.evidence.producerId).toBe("p1");
      expect(result.result.diagnostics).toHaveLength(1);
    }
  });

  it("fails for unregistered producer", async () => {
    const reg = createProducerRegistry();
    const result = await executeProducer(reg, {
      producerId: "p-unknown",
      context: mkContext(),
      requirements: mkProfile().requirements,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-PRODUCER-09");
    }
  });

  it("fails when producer throws", async () => {
    const reg = createProducerRegistry();
    reg.register(
      {
        id: "p1",
        kind: "kernel-command",
        command: "cmd-p1",
        outputSchema: "werkstatt/evidence-result@1",
        versionSource: "package-version",
        requiredPayloadRoles: ["primary"],
      },
      async () => {
        throw new Error("handler crashed");
      },
    );

    const result = await executeProducer(reg, {
      producerId: "p1",
      context: mkContext(),
      requirements: mkProfile().requirements,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-PRODUCER-10");
    }
  });

  it("fails on false-pass detection", async () => {
    const reg = createProducerRegistry();
    reg.register(
      {
        id: "p1",
        kind: "kernel-command",
        command: "cmd-p1",
        outputSchema: "werkstatt/evidence-result@1",
        versionSource: "package-version",
        requiredPayloadRoles: ["primary"],
      },
      async () =>
        mkProducerResult("p1", {
          requirementIds: [],
          diagnostics: [],
        }),
    );

    const result = await executeProducer(reg, {
      producerId: "p1",
      context: mkContext(),
      requirements: mkProfile().requirements,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-PRODUCER-11");
    }
  });
});
