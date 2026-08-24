import { z } from "zod";
import { digestSchema, humanReadableIdSchema, utcTimestampSchema } from "./identifiers.ts";

export const producerManifestV1Schema = z
  .object({
    schema: z.literal("werkstatt/producer-manifest@1"),
    producerId: humanReadableIdSchema,
    version: z.string().min(1).max(64),
    capabilityId: humanReadableIdSchema,
    schemaHash: digestSchema,
  })
  .strict();

export type ProducerManifestV1 = z.infer<typeof producerManifestV1Schema>;

export const rubricManifestV1Schema = z
  .object({
    schema: z.literal("werkstatt/rubric-manifest@1"),
    rubricId: humanReadableIdSchema,
    version: z.string().min(1).max(64),
    criteria: z
      .array(
        z
          .object({
            criterionId: humanReadableIdSchema,
            description: z.string().min(1).max(4096),
            weight: z.number().min(0).max(100),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();

export type RubricManifestV1 = z.infer<typeof rubricManifestV1Schema>;

export const toolchainManifestV1Schema = z
  .object({
    schema: z.literal("werkstatt/toolchain-manifest@1"),
    toolchainId: humanReadableIdSchema,
    version: z.string().min(1).max(64),
    toolHash: digestSchema,
  })
  .strict();

export type ToolchainManifestV1 = z.infer<typeof toolchainManifestV1Schema>;

export const issuerManifestV1Schema = z
  .object({
    schema: z.literal("werkstatt/issuer-manifest@1"),
    issuerId: humanReadableIdSchema,
    version: z.string().min(1).max(64),
    publicKeyRef: z.string().min(1).max(1024),
    publicKeyHash: digestSchema,
  })
  .strict();

export type IssuerManifestV1 = z.infer<typeof issuerManifestV1Schema>;

export const resolvedRequirementV1Schema = z
  .object({
    requirementId: humanReadableIdSchema,
    source: z.string().min(1).max(256),
    description: z.string().min(1).max(4096),
    mandatory: z.boolean(),
  })
  .strict();

export type ResolvedRequirementV1 = z.infer<typeof resolvedRequirementV1Schema>;

export const certificationPolicyBundleV1Schema = z
  .object({
    schema: z.literal("werkstatt/certification-policy-bundle@1"),
    policyBundleId: humanReadableIdSchema,
    version: z.string().min(1).max(64),
    profileId: humanReadableIdSchema,
    resolvedRequirements: z.array(resolvedRequirementV1Schema).max(1000),
    producerManifests: z.array(producerManifestV1Schema).max(500),
    rubricManifests: z.array(rubricManifestV1Schema).max(100),
    toolchainManifests: z.array(toolchainManifestV1Schema).max(100),
    issuerManifests: z.array(issuerManifestV1Schema).max(100),
    riskPolicy: z
      .object({
        maxStale: z.number().int().nonnegative(),
        maxIncomplete: z.number().int().nonnegative(),
        blockOnFail: z.boolean(),
      })
      .strict(),
    retention: z
      .object({
        minRetentionDays: z.number().int().nonnegative(),
        maxRetentionDays: z.number().int().nonnegative(),
      })
      .strict(),
    materializedAt: utcTimestampSchema,
  })
  .strict();

export type CertificationPolicyBundleV1 = z.infer<typeof certificationPolicyBundleV1Schema>;
