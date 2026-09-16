/*
<MODULE_CONTRACT>
<purpose>action-pack contract — Zod schemas for certification action anchors and packs.</purpose>
<non-goals>
  <item>Do not execute actions — this module defines the contract only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";
import { actionIdSchema, humanReadableIdSchema, utcTimestampSchema } from "./identifiers.ts";

export const actionAnchorV1Schema = z
  .object({
    anchorId: humanReadableIdSchema,
    target: z.string().min(1).max(256),
    description: z.string().min(1).max(4096),
  })
  .strict();

export type ActionAnchorV1 = z.infer<typeof actionAnchorV1Schema>;

export const actionDependencyV1Schema = z
  .object({
    dependsOn: actionIdSchema,
    type: z.enum(["hard", "soft"]),
  })
  .strict();

export type ActionDependencyV1 = z.infer<typeof actionDependencyV1Schema>;

export const actionTaskV1Schema = z
  .object({
    taskId: actionIdSchema,
    remediationClass: humanReadableIdSchema,
    description: z.string().min(1).max(4096),
    verificationCommand: z.string().min(1).max(1024),
    anchors: z.array(actionAnchorV1Schema).max(100),
    dependencies: z.array(actionDependencyV1Schema).max(100),
  })
  .strict();

export type ActionTaskV1 = z.infer<typeof actionTaskV1Schema>;

export const certificationActionPackV1Schema = z
  .object({
    schema: z.literal("werkstatt/certification-action-pack@1"),
    actionPackId: humanReadableIdSchema,
    candidateId: humanReadableIdSchema,
    decisionId: humanReadableIdSchema,
    tasks: z.array(actionTaskV1Schema).max(1000),
    createdAt: utcTimestampSchema,
  })
  .strict();

export type CertificationActionPackV1 = z.infer<typeof certificationActionPackV1Schema>;
