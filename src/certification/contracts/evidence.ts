import { z } from "zod";
import { diagnosticSchema } from "../../schemas/diagnostic.ts";
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
