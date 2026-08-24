import { z } from "zod";
import {
  digestSchema,
  humanReadableIdSchema,
  utcTimestampSchema,
  authoritySequenceSchema,
} from "./identifiers.ts";

export const issuerRegistryEntryV1Schema = z
  .object({
    schema: z.literal("werkstatt/issuer-registry-entry@1"),
    issuerId: humanReadableIdSchema,
    version: z.string().min(1).max(64),
    publicKeyRef: z.string().min(1).max(1024),
    publicKeyHash: digestSchema,
    admittedAt: utcTimestampSchema,
    admittedBy: humanReadableIdSchema,
  })
  .strict();

export type IssuerRegistryEntryV1 = z.infer<typeof issuerRegistryEntryV1Schema>;

export const attestationVerificationV1Schema = z
  .object({
    schema: z.literal("werkstatt/attestation-verification@1"),
    issuerId: humanReadableIdSchema,
    statementDigest: digestSchema,
    verifiedAt: utcTimestampSchema,
    verified: z.boolean(),
  })
  .strict();

export type AttestationVerificationV1 = z.infer<typeof attestationVerificationV1Schema>;

export const signedDecisionV1Schema = z
  .object({
    schema: z.literal("werkstatt/signed-decision@1"),
    decisionId: humanReadableIdSchema,
    decisionDigest: digestSchema,
    issuerId: humanReadableIdSchema,
    signatureDigest: digestSchema,
    signedAt: utcTimestampSchema,
  })
  .strict();

export type SignedDecisionV1 = z.infer<typeof signedDecisionV1Schema>;

export const signedRootV1Schema = z
  .object({
    schema: z.literal("werkstatt/signed-root@1"),
    rootDigest: digestSchema,
    issuerId: humanReadableIdSchema,
    signatureDigest: digestSchema,
    signedAt: utcTimestampSchema,
  })
  .strict();

export type SignedRootV1 = z.infer<typeof signedRootV1Schema>;

export const operationAuthorizationV1Schema = z
  .object({
    schema: z.literal("werkstatt/operation-authorization@1"),
    operationId: humanReadableIdSchema,
    authorizedBy: humanReadableIdSchema,
    authoritySequence: authoritySequenceSchema,
    authorizedAt: utcTimestampSchema,
    scope: z.string().min(1).max(256),
  })
  .strict();

export type OperationAuthorizationV1 = z.infer<typeof operationAuthorizationV1Schema>;

export const nonAuthoritativePreviewV1Schema = z
  .object({
    schema: z.literal("werkstatt/non-authoritative-preview@1"),
    previewId: humanReadableIdSchema,
    candidateId: humanReadableIdSchema,
    previewDigest: digestSchema,
    generatedAt: utcTimestampSchema,
    disclaimer: z.string().min(1).max(4096),
  })
  .strict();

export type NonAuthoritativePreviewV1 = z.infer<typeof nonAuthoritativePreviewV1Schema>;
