/*
<MODULE_CONTRACT>
<purpose>dossier contract — Zod schemas for certification dossier events and records.</purpose>
<non-goals>
  <item>Do not write dossiers — this module defines the contract only.</item>
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
  eventIdSchema,
  humanReadableIdSchema,
  utcTimestampSchema,
  authoritySequenceSchema,
} from "./identifiers.ts";

export const dossierEventKindSchema = z.enum([
  "evidence-admitted",
  "decision-recorded",
  "incident",
  "tombstone",
  "manifest-projection",
  "root-reference",
]);

export type DossierEventKind = z.infer<typeof dossierEventKindSchema>;

export const dossierEventV1Schema = z
  .object({
    schema: z.literal("werkstatt/dossier-event@1"),
    eventId: eventIdSchema,
    eventKind: dossierEventKindSchema,
    candidateId: humanReadableIdSchema,
    authoritySequence: authoritySequenceSchema,
    previousEventHash: digestSchema.nullable(),
    eventPayloadRef: digestSchema,
    recordedAt: utcTimestampSchema,
  })
  .strict();

export type CertificationDossierEventV1 = z.infer<typeof dossierEventV1Schema>;

export const dossierManifestProjectionV1Schema = z
  .object({
    schema: z.literal("werkstatt/dossier-manifest-projection@1"),
    candidateId: humanReadableIdSchema,
    policyBundleRoot: digestSchema,
    evidenceCount: z.number().int().nonnegative().max(10000),
    decisionCount: z.number().int().nonnegative().max(1000),
    projectedAt: utcTimestampSchema,
  })
  .strict();

export type DossierManifestProjectionV1 = z.infer<typeof dossierManifestProjectionV1Schema>;

export const dossierIncidentV1Schema = z
  .object({
    schema: z.literal("werkstatt/dossier-incident@1"),
    incidentId: humanReadableIdSchema,
    candidateId: humanReadableIdSchema,
    severity: z.enum(["low", "medium", "high", "critical"]),
    description: z.string().min(1).max(4096),
    detectedAt: utcTimestampSchema,
  })
  .strict();

export type DossierIncidentV1 = z.infer<typeof dossierIncidentV1Schema>;

export const dossierTombstoneV1Schema = z
  .object({
    schema: z.literal("werkstatt/dossier-tombstone@1"),
    candidateId: humanReadableIdSchema,
    reason: z.string().min(1).max(4096),
    tombstonedAt: utcTimestampSchema,
  })
  .strict();

export type DossierTombstoneV1 = z.infer<typeof dossierTombstoneV1Schema>;

export const dossierRootReferenceV1Schema = z
  .object({
    schema: z.literal("werkstatt/dossier-root-reference@1"),
    rootHash: digestSchema,
    candidateId: humanReadableIdSchema,
    eventCount: z.number().int().nonnegative().max(100000),
  })
  .strict();

export type DossierRootReferenceV1 = z.infer<typeof dossierRootReferenceV1Schema>;
