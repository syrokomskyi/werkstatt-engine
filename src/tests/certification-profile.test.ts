import { describe, it, expect } from "vitest";
import {
  certificationProfileV1Schema,
  certificationRequirementV1Schema,
  producerDeclarationV1Schema,
  retentionPolicyV1Schema,
  hashCertificationProfileV1,
  validateCertificationProfileV1,
} from "../certification/profile/index.ts";
import type {
  CertificationProfileV1,
  CertificationRequirementV1,
  ProducerDeclarationV1,
  SiteQualityDimension,
} from "../certification/profile/index.ts";

const ALL_DIMENSIONS: SiteQualityDimension[] = [
  "candidate-integrity",
  "business-truth-compliance",
  "editorial-localization",
  "information-architecture-discoverability",
  "ux-conversion",
  "visual-accessibility",
  "performance-runtime",
  "security-operational-readiness",
  "independent-qualitative-evaluation",
];

function mkProducer(id: string, command?: string): ProducerDeclarationV1 {
  return {
    id,
    kind: "kernel-command",
    command: command ?? `cmd.${id}`,
    outputSchema: "werkstatt/evidence@1",
    versionSource: "package-version",
    requiredPayloadRoles: ["diagnostics"],
  };
}

function mkReq(
  id: string,
  dimension: SiteQualityDimension,
  producerId: string,
  opts?: Partial<{
    classification: CertificationRequirementV1["classification"];
    gates: CertificationRequirementV1["gates"];
    maxAgeSeconds: number | null;
    driftAction: CertificationRequirementV1["driftAction"];
    normativeRefs: string[];
  }>,
): CertificationRequirementV1 {
  return {
    id,
    title: `Requirement ${id}`,
    dimension,
    gates: opts?.gates ?? ["dev-deploy", "propagate-alt", "promote-main", "continuous-health"],
    classification: opts?.classification ?? "required",
    applicability: { kind: "always" },
    producerId,
    evidenceSchema: "werkstatt/evidence@1",
    environments: ["dev", "alt", "main"],
    reuse: { environmentIndependent: true, allowedFrom: ["dev", "alt", "main"] },
    freshness: { maxAgeSeconds: opts?.maxAgeSeconds ?? 300 },
    execution: { timeoutMs: 30000, maxAttempts: 3, backoffMs: [100, 200, 400] },
    criticality: "ordinary",
    driftAction: opts?.driftAction ?? "retry",
    remediation: {
      classification: "product-fix",
      ownerRole: "author-agent",
      reproduceCommand: `reproduce ${id}`,
      verificationCommand: `verify ${id}`,
    },
    normativeRefs: opts?.normativeRefs ?? ["spec#section"],
  };
}

function mkProfile(opts?: Partial<CertificationProfileV1>): CertificationProfileV1 {
  const producers: Record<string, ProducerDeclarationV1> = {};
  const requirements: CertificationRequirementV1[] = [];
  for (const dim of ALL_DIMENSIONS) {
    const pid = `prod.${dim}`;
    producers[pid] = mkProducer(pid);
    requirements.push(mkReq(`req.${dim}`, dim, pid));
  }
  return {
    schema: "werkstatt/certification-profile@1",
    id: "test-profile",
    version: "1.0.0",
    plugin: { id: "werkstatt-site", profileId: "astro-typescript-turborepo" },
    dimensions: [...ALL_DIMENSIONS],
    producers,
    requirements,
    retentionPolicy: {
      minRetentionDays: 30,
      maxRetentionDays: 365,
      tombstoneAfterDays: 365,
    },
    ...opts,
  };
}

const CTX = {
  pluginId: "werkstatt-site",
  profileId: "astro-typescript-turborepo",
  registeredCommands: new Set<string>(),
};

describe("certificationProfileV1Schema", () => {
  it("parses a valid profile", () => {
    const profile = mkProfile();
    const result = certificationProfileV1Schema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields", () => {
    const profile = mkProfile();
    const result = certificationProfileV1Schema.safeParse({
      ...profile,
      extraField: "bad",
    });
    expect(result.success).toBe(false);
  });

  it("rejects wrong schema literal", () => {
    const profile = mkProfile();
    const result = certificationProfileV1Schema.safeParse({
      ...profile,
      schema: "werkstatt/certification-profile@2",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty requirements", () => {
    const profile = mkProfile({ requirements: [] });
    const result = certificationProfileV1Schema.safeParse(profile);
    expect(result.success).toBe(false);
  });

  it("rejects empty dimensions", () => {
    const profile = mkProfile({ dimensions: [] });
    const result = certificationProfileV1Schema.safeParse(profile);
    expect(result.success).toBe(false);
  });
});

describe("retentionPolicyV1Schema", () => {
  it("rejects min > max", () => {
    const result = retentionPolicyV1Schema.safeParse({
      minRetentionDays: 400,
      maxRetentionDays: 365,
      tombstoneAfterDays: 365,
    });
    expect(result.success).toBe(false);
  });

  it("accepts min == max", () => {
    const result = retentionPolicyV1Schema.safeParse({
      minRetentionDays: 365,
      maxRetentionDays: 365,
      tombstoneAfterDays: 365,
    });
    expect(result.success).toBe(true);
  });
});

describe("producerDeclarationV1Schema", () => {
  it("rejects unknown kind", () => {
    const result = producerDeclarationV1Schema.safeParse({
      id: "p1",
      kind: "unknown",
      outputSchema: "werkstatt/evidence@1",
      versionSource: "package-version",
      requiredPayloadRoles: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts evaluator-agent without command", () => {
    const result = producerDeclarationV1Schema.safeParse({
      id: "p1",
      kind: "evaluator-agent",
      moduleId: "eval.module",
      outputSchema: "werkstatt/evidence@1",
      versionSource: "evaluator-profile",
      requiredPayloadRoles: ["rubric"],
    });
    expect(result.success).toBe(true);
  });
});

describe("certificationRequirementV1Schema", () => {
  it("rejects requirement with no normative refs", () => {
    const req = mkReq("req.test", "candidate-integrity", "prod.test", {
      normativeRefs: [],
    });
    const result = certificationRequirementV1Schema.safeParse(req);
    expect(result.success).toBe(false);
  });

  it("rejects requirement with no gates", () => {
    const req = mkReq("req.test", "candidate-integrity", "prod.test", {
      gates: [],
    });
    const result = certificationRequirementV1Schema.safeParse(req);
    expect(result.success).toBe(false);
  });
});

describe("hashCertificationProfileV1", () => {
  it("produces a deterministic hash", () => {
    const profile = mkProfile();
    const h1 = hashCertificationProfileV1(profile);
    const h2 = hashCertificationProfileV1(profile);
    expect(h1.ok).toBe(true);
    expect(h2.ok).toBe(true);
    if (h1.ok && h2.ok) {
      expect(h1.canonicalHash).toBe(h2.canonicalHash);
    }
  });

  it("hash changes when requirement changes", () => {
    const profile = mkProfile();
    const h1 = hashCertificationProfileV1(profile);
    const modified = mkProfile({
      requirements: profile.requirements.map((r, i) =>
        i === 0 ? { ...r, title: "Changed title" } : r,
      ),
    });
    const h2 = hashCertificationProfileV1(modified);
    expect(h1.ok).toBe(true);
    expect(h2.ok).toBe(true);
    if (h1.ok && h2.ok) {
      expect(h1.canonicalHash).not.toBe(h2.canonicalHash);
    }
  });

  it("hash is unaffected by key insertion order in producers", () => {
    const profile = mkProfile();
    const h1 = hashCertificationProfileV1(profile);
    const producerEntries = Object.entries(profile.producers);
    const reversedProducers: Record<string, ProducerDeclarationV1> = {};
    for (let i = producerEntries.length - 1; i >= 0; i--) {
      const [k, v] = producerEntries[i];
      reversedProducers[k] = v;
    }
    const reversedProfile = { ...profile, producers: reversedProducers };
    const h2 = hashCertificationProfileV1(reversedProfile);
    expect(h1.ok).toBe(true);
    expect(h2.ok).toBe(true);
    if (h1.ok && h2.ok) {
      expect(h1.canonicalHash).toBe(h2.canonicalHash);
    }
  });
});

describe("validateCertificationProfileV1", () => {
  it("valid profile with all dimensions covered passes", () => {
    const profile = mkProfile();
    const ctx = {
      ...CTX,
      registeredCommands: new Set(
        Object.values(profile.producers)
          .map((p) => p.command!)
          .filter(Boolean),
      ),
    };
    const result = validateCertificationProfileV1(profile, ctx);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("fails when plugin ID mismatch", () => {
    const profile = mkProfile();
    const result = validateCertificationProfileV1(profile, {
      ...CTX,
      pluginId: "wrong-plugin",
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.ruleId === "CERT-PROFILE-02")).toBe(true);
  });

  it("fails when profile ID mismatch", () => {
    const profile = mkProfile();
    const result = validateCertificationProfileV1(profile, {
      ...CTX,
      profileId: "wrong-profile",
    });
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.ruleId === "CERT-PROFILE-02")).toBe(true);
  });

  it("fails on duplicate requirement ID", () => {
    const profile = mkProfile();
    profile.requirements[1] = { ...profile.requirements[1], id: profile.requirements[0].id };
    const result = validateCertificationProfileV1(profile, CTX);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.ruleId === "CERT-PROFILE-03")).toBe(true);
  });

  it("fails on missing producer for required requirement", () => {
    const profile = mkProfile();
    profile.requirements[0] = { ...profile.requirements[0], producerId: "nonexistent" };
    const result = validateCertificationProfileV1(profile, CTX);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.ruleId === "CERT-PROFILE-05")).toBe(true);
  });

  it("fails on unregistered command", () => {
    const profile = mkProfile();
    const ctx = {
      ...CTX,
      registeredCommands: new Set<string>(),
    };
    const result = validateCertificationProfileV1(profile, ctx);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.ruleId === "CERT-PROFILE-04")).toBe(true);
  });

  it("fails on missing dimension coverage for Main", () => {
    const profile = mkProfile();
    profile.requirements[0] = {
      ...profile.requirements[0],
      gates: ["dev-deploy"],
    };
    const result = validateCertificationProfileV1(profile, CTX);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.ruleId === "CERT-PROFILE-10")).toBe(true);
  });

  it("fails on continuous-health without freshness", () => {
    const profile = mkProfile();
    profile.requirements[0] = {
      ...profile.requirements[0],
      gates: ["continuous-health"],
      freshness: { maxAgeSeconds: null },
    };
    const result = validateCertificationProfileV1(profile, CTX);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.ruleId === "CERT-PROFILE-09")).toBe(true);
  });

  it("fails on rollback driftAction for non-required", () => {
    const profile = mkProfile();
    profile.requirements[0] = {
      ...profile.requirements[0],
      classification: "advisory",
      driftAction: "rollback",
    };
    const result = validateCertificationProfileV1(profile, CTX);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.some((d) => d.ruleId === "CERT-PROFILE-08")).toBe(true);
  });

  it("dimension coverage reports all dimensions", () => {
    const profile = mkProfile();
    const result = validateCertificationProfileV1(profile, CTX);
    expect(result.dimensionCoverage.length).toBe(9);
    for (const dc of result.dimensionCoverage) {
      expect(dc.hasMainRequired).toBe(true);
    }
  });
});
