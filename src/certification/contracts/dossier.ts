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
