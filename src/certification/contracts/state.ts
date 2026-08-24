import { z } from "zod";
import {
  digestSchema,
  operationIdSchema,
  eventIdSchema,
  humanReadableIdSchema,
  utcTimestampSchema,
  authoritySequenceSchema,
  gateChannelSchema,
  environmentSchema,
  certificationStatusSchema,
} from "./identifiers.ts";

export const artifactReadinessV1Schema = z
  .object({
    schema: z.literal("werkstatt/artifact-readiness@1"),
    candidateId: humanReadableIdSchema,
    artifactHash: digestSchema,
    ready: z.boolean(),
    checkedAt: utcTimestampSchema,
  })
  .strict();

export type ArtifactReadinessV1 = z.infer<typeof artifactReadinessV1Schema>;

export const deploymentOperationStateV1Schema = z
  .object({
    schema: z.literal("werkstatt/deployment-operation-state@1"),
    operationId: operationIdSchema,
    candidateId: humanReadableIdSchema,
    channel: gateChannelSchema,
    target: humanReadableIdSchema,
    environment: environmentSchema,
    deploymentPlanHash: digestSchema,
    environmentIdentityHash: digestSchema,
    authoritySequence: authoritySequenceSchema,
    previousEventHash: digestSchema.nullable(),
    state: z.enum(["pending", "in-progress", "succeeded", "failed", "rolled-back"]),
    result: z
      .object({
        status: certificationStatusSchema,
        message: z.string().min(1).max(4096),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type DeploymentOperationStateV1 = z.infer<typeof deploymentOperationStateV1Schema>;

export const deploymentOperationEventV1Schema = z
  .object({
    schema: z.literal("werkstatt/deployment-operation-event@1"),
    eventId: eventIdSchema,
    operationId: operationIdSchema,
    candidateId: humanReadableIdSchema,
    channel: gateChannelSchema,
    target: humanReadableIdSchema,
    environment: environmentSchema,
    deploymentPlanHash: digestSchema,
    environmentIdentityHash: digestSchema,
    authoritySequence: authoritySequenceSchema,
    previousEventHash: digestSchema.nullable(),
    eventKind: z.enum([
      "operation-started",
      "operation-succeeded",
      "operation-failed",
      "operation-rolled-back",
    ]),
    result: z
      .object({
        status: certificationStatusSchema,
        message: z.string().min(1).max(4096),
      })
      .strict()
      .nullable(),
    recordedAt: utcTimestampSchema,
  })
  .strict();

export type DeploymentOperationEventV1 = z.infer<typeof deploymentOperationEventV1Schema>;
