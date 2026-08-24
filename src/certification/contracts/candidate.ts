import { z } from "zod";
import {
  digestSchema,
  candidateIdSchema,
  utcTimestampSchema,
  gateChannelSchema,
  environmentSchema,
  safeSemanticPathSchema,
  humanReadableIdSchema,
} from "./identifiers.ts";

export const buildConfigV1Schema = z
  .object({
    schema: z.literal("werkstatt/build-config@1"),
    buildConfigHash: digestSchema,
    toolchainId: humanReadableIdSchema,
    sourceRef: safeSemanticPathSchema,
    contentHash: digestSchema,
  })
  .strict();

export type BuildConfigV1 = z.infer<typeof buildConfigV1Schema>;

export const deploymentPlanV1Schema = z
  .object({
    schema: z.literal("werkstatt/deployment-plan@1"),
    deploymentPlanHash: digestSchema,
    channel: gateChannelSchema,
    target: humanReadableIdSchema,
    environmentRefs: z.array(humanReadableIdSchema).max(100),
  })
  .strict();

export type DeploymentPlanV1 = z.infer<typeof deploymentPlanV1Schema>;

export const observedEnvironmentV1Schema = z
  .object({
    schema: z.literal("werkstatt/observed-environment@1"),
    environment: environmentSchema,
    environmentIdentityHash: digestSchema,
    observedAt: utcTimestampSchema,
    providerRef: z.string().min(1).max(256).optional(),
    providerVersion: z.string().min(1).max(128).optional(),
  })
  .strict();

export type ObservedEnvironmentV1 = z.infer<typeof observedEnvironmentV1Schema>;

export const releaseCandidateV1Schema = z
  .object({
    schema: z.literal("werkstatt/release-candidate@1"),
    candidateId: candidateIdSchema,
    systemId: humanReadableIdSchema,
    releaseVersion: z.string().min(1).max(128),
    sourceHash: digestSchema,
    contentHash: digestSchema,
    artifactHash: digestSchema,
    buildConfig: buildConfigV1Schema,
    deploymentPlan: deploymentPlanV1Schema,
    policyBundleRoot: digestSchema,
    toolchainId: humanReadableIdSchema,
    observedEnvironment: observedEnvironmentV1Schema,
    observedAt: utcTimestampSchema,
  })
  .strict();

export type ReleaseCandidateV1 = z.infer<typeof releaseCandidateV1Schema>;
