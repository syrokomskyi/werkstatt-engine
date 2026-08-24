import { z } from "zod";
import {
  humanReadableIdSchema,
  digestSchema,
  utcTimestampSchema,
  environmentSchema,
} from "../contracts/identifiers.ts";

export const siteQualityDimensionSchema = z.enum([
  "candidate-integrity",
  "business-truth-compliance",
  "editorial-localization",
  "information-architecture-discoverability",
  "ux-conversion",
  "visual-accessibility",
  "performance-runtime",
  "security-operational-readiness",
  "independent-qualitative-evaluation",
]);

export type SiteQualityDimension = z.infer<typeof siteQualityDimensionSchema>;

export const certificationGateSchema = z.enum(["dev-deploy", "propagate-alt", "promote-main"]);

export type CertificationGate = z.infer<typeof certificationGateSchema>;

export const requirementClassSchema = z.enum(["required", "conditional", "advisory"]);

export type RequirementClass = z.infer<typeof requirementClassSchema>;

export const remediationClassSchema = z.enum([
  "product-fix",
  "infrastructure-retry",
  "policy-defect",
]);

export type RemediationClass = z.infer<typeof remediationClassSchema>;

export const driftActionSchema = z.enum(["retry", "incident-only", "rollback"]);

export type DriftAction = z.infer<typeof driftActionSchema>;

export const ownerRoleSchema = z.enum(["author-agent", "platform-agent", "operator-agent"]);

export type OwnerRole = z.infer<typeof ownerRoleSchema>;

export const producerKindSchema = z.enum(["kernel-command", "evaluator-agent", "remote-workload"]);

export type ProducerKind = z.infer<typeof producerKindSchema>;

export const versionSourceSchema = z.enum(["package-version", "module-hash", "evaluator-profile"]);

export type VersionSource = z.infer<typeof versionSourceSchema>;

export const criticalitySchema = z.enum(["ordinary", "critical"]);

export type Criticality = z.infer<typeof criticalitySchema>;

export const applicabilityRuleV1Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("always"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("entitlement"),
      ref: z.string().min(1).max(256),
      expected: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("config"),
      ref: z.string().min(1).max(256),
      predicate: z.string().min(1).max(256),
    })
    .strict(),
  z
    .object({
      kind: z.literal("surface"),
      ref: z.string().min(1).max(256),
      predicate: z.string().min(1).max(256),
    })
    .strict(),
]);

export type ApplicabilityRuleV1 = z.infer<typeof applicabilityRuleV1Schema>;

export const freshnessV1Schema = z
  .object({
    maxAgeSeconds: z.number().int().nonnegative().nullable(),
    schedule: z.string().min(1).max(128).optional(),
  })
  .strict();

export type FreshnessV1 = z.infer<typeof freshnessV1Schema>;

export const executionV1Schema = z
  .object({
    timeoutMs: z.number().int().positive().max(600000),
    maxAttempts: z.number().int().min(1).max(10),
    backoffMs: z.array(z.number().int().nonnegative().max(60000)).max(10),
  })
  .strict();

export type ExecutionV1 = z.infer<typeof executionV1Schema>;

export const remediationV1Schema = z
  .object({
    classification: remediationClassSchema,
    ownerRole: ownerRoleSchema,
    reproduceCommand: z.string().min(1).max(256),
    verificationCommand: z.string().min(1).max(256),
  })
  .strict();

export type RemediationV1 = z.infer<typeof remediationV1Schema>;

export const reuseV1Schema = z
  .object({
    environmentIndependent: z.boolean(),
    allowedFrom: z.array(environmentSchema).max(10),
  })
  .strict();

export type ReuseV1 = z.infer<typeof reuseV1Schema>;

export const certificationRequirementV1Schema = z
  .object({
    id: humanReadableIdSchema,
    title: z.string().min(1).max(256),
    dimension: z.union([siteQualityDimensionSchema, z.literal("core")]),
    gates: z
      .array(z.union([certificationGateSchema, z.literal("continuous-health")]))
      .min(1)
      .max(5),
    classification: requirementClassSchema,
    applicability: applicabilityRuleV1Schema,
    producerId: humanReadableIdSchema,
    evidenceSchema: z.string().min(1).max(128),
    environments: z.array(environmentSchema).min(1).max(5),
    reuse: reuseV1Schema,
    freshness: freshnessV1Schema,
    execution: executionV1Schema,
    criticality: criticalitySchema,
    driftAction: driftActionSchema,
    remediation: remediationV1Schema,
    normativeRefs: z.array(z.string().min(1).max(256)).min(1).max(20),
  })
  .strict();

export type CertificationRequirementV1 = z.infer<typeof certificationRequirementV1Schema>;

export const producerDeclarationV1Schema = z
  .object({
    id: humanReadableIdSchema,
    kind: producerKindSchema,
    command: z.string().min(1).max(256).optional(),
    moduleId: z.string().min(1).max(256).optional(),
    outputSchema: z.string().min(1).max(128),
    versionSource: versionSourceSchema,
    requiredPayloadRoles: z.array(z.string().min(1).max(128)).max(20),
  })
  .strict();

export type ProducerDeclarationV1 = z.infer<typeof producerDeclarationV1Schema>;

export const evaluatorPolicyV1Schema = z
  .object({
    ordinaryEvaluators: z.number().int().min(1).max(10),
    criticalEvaluators: z.number().int().min(1).max(10),
    borderlineEvaluators: z.number().int().min(1).max(10),
    confidenceMargin: z.number().min(0).max(100),
  })
  .strict();

export type EvaluatorPolicyV1 = z.infer<typeof evaluatorPolicyV1Schema>;

export const retentionPolicyV1Schema = z
  .object({
    minRetentionDays: z.number().int().nonnegative().max(36500),
    maxRetentionDays: z.number().int().nonnegative().max(36500),
    tombstoneAfterDays: z.number().int().nonnegative().max(36500),
  })
  .strict()
  .refine((v) => v.minRetentionDays <= v.maxRetentionDays, {
    message: "CERT-PROFILE-01: minRetentionDays must not exceed maxRetentionDays",
  });

export type RetentionPolicyV1 = z.infer<typeof retentionPolicyV1Schema>;

export const certificationProfileV1Schema = z
  .object({
    schema: z.literal("werkstatt/certification-profile@1"),
    id: humanReadableIdSchema,
    version: z.string().min(1).max(64),
    plugin: z
      .object({
        id: humanReadableIdSchema,
        profileId: humanReadableIdSchema,
      })
      .strict(),
    dimensions: z.array(siteQualityDimensionSchema).min(1).max(20),
    producers: z.record(z.string().min(1).max(256), producerDeclarationV1Schema),
    requirements: z.array(certificationRequirementV1Schema).min(1).max(1000),
    evaluatorPolicy: evaluatorPolicyV1Schema.optional(),
    retentionPolicy: retentionPolicyV1Schema,
  })
  .strict();

export type CertificationProfileV1 = z.infer<typeof certificationProfileV1Schema>;

export const profileSourceRefV1Schema = z
  .object({
    sourcePath: z.string().min(1).max(1024),
    sourceFileHash: digestSchema,
    canonicalHash: digestSchema,
    parsedAt: utcTimestampSchema,
  })
  .strict();

export type ProfileSourceRefV1 = z.infer<typeof profileSourceRefV1Schema>;
