/*
<MODULE_CONTRACT>
<purpose>state contract — Zod schemas for certification artifact readiness and run state.</purpose>
<non-goals>
  <item>Do not transition state — this module defines the contract only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

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
