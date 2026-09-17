/*
<MODULE_CONTRACT>
<purpose>evidence contract — Zod schemas for certification evidence payload descriptors.</purpose>
<non-goals>
  <item>Do not collect evidence — this module defines the contract only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";
import { diagnosticSchema } from "@warpgogol/werkstatt-shared/kernel";
import {
  digestSchema,
  evidenceIdSchema,
  humanReadableIdSchema,
  utcTimestampSchema,
  authoritySequenceSchema,
  safeLocatorSchema,
} from "./identifiers.ts";

export const payloadDescriptorV1Schema = z
  .object({
    payloadDigest: digestSchema,
    mediaType: z.string().min(1).max(256),
    sizeBytes: z
      .number()
      .int()
      .nonnegative()
      .max(1024 * 1024 * 1024),
    role: z.enum(["primary", "supplementary", "contextual"]),
    locator: safeLocatorSchema.optional(),
  })
  .strict();

export type PayloadDescriptorV1 = z.infer<typeof payloadDescriptorV1Schema>;

export const redactionReportV1Schema = z
  .object({
    schema: z.literal("werkstatt/redaction-report@1"),
    policyVersion: z.string().min(1).max(64),
    detectedSecrets: z.number().int().nonnegative(),
    detectedPii: z.number().int().nonnegative(),
    resolved: z.boolean(),
    unresolvedSecrets: z.number().int().nonnegative(),
    unresolvedPii: z.number().int().nonnegative(),
  })
  .strict();

export type RedactionReportV1 = z.infer<typeof redactionReportV1Schema>;

export const attestationStatementV1Schema = z
  .object({
    schema: z.literal("werkstatt/attestation-statement@1"),
    issuerId: humanReadableIdSchema,
    statementDigest: digestSchema,
    signedAt: utcTimestampSchema,
  })
  .strict();

export type AttestationStatementV1 = z.infer<typeof attestationStatementV1Schema>;

export const authorityAdmissionV1Schema = z
  .object({
    schema: z.literal("werkstatt/authority-admission@1"),
    authoritySequence: authoritySequenceSchema,
    admittedAt: utcTimestampSchema,
    admittedBy: humanReadableIdSchema,
  })
  .strict();

export type AuthorityAdmissionV1 = z.infer<typeof authorityAdmissionV1Schema>;

export const evidenceResultV1Schema = z
  .object({
    schema: z.literal("werkstatt/evidence-result@1"),
    producerId: humanReadableIdSchema,
    producerAttemptId: humanReadableIdSchema,
    diagnostics: z.array(diagnosticSchema).max(1000),
    bindingHash: digestSchema,
    applicability: z
      .object({
        appliesTo: z.array(humanReadableIdSchema).max(100),
        scope: z.string().min(1).max(256),
      })
      .strict(),
  })
  .strict();

export type EvidenceResultV1 = z.infer<typeof evidenceResultV1Schema>;

export const evidenceEnvelopeV1Schema = z
  .object({
    schema: z.literal("werkstatt/evidence-envelope@1"),
    evidenceId: evidenceIdSchema,
    candidateId: humanReadableIdSchema,
    producerId: humanReadableIdSchema,
    producerAttemptId: humanReadableIdSchema,
    producedAt: utcTimestampSchema,
    result: evidenceResultV1Schema,
    payloads: z.array(payloadDescriptorV1Schema).max(100),
    redaction: redactionReportV1Schema,
    attestation: attestationStatementV1Schema.optional(),
    authorityAdmission: authorityAdmissionV1Schema.optional(),
    freshness: z
      .object({
        expiresAt: utcTimestampSchema,
        staleAfter: utcTimestampSchema,
      })
      .strict(),
  })
  .strict();

export type EvidenceEnvelopeV1 = z.infer<typeof evidenceEnvelopeV1Schema>;
