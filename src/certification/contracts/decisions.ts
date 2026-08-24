import { z } from "zod";
import {
  digestSchema,
  decisionIdSchema,
  humanReadableIdSchema,
  utcTimestampSchema,
  authoritySequenceSchema,
  certificationStatusSchema,
} from "./identifiers.ts";

export const coverageReportV1Schema = z
  .object({
    schema: z.literal("werkstatt/coverage-report@1"),
    totalRequirements: z.number().int().nonnegative().max(1000),
    coveredRequirements: z.number().int().nonnegative().max(1000),
    uncoveredRequirements: z.array(humanReadableIdSchema).max(1000),
  })
  .strict();

export type CoverageReportV1 = z.infer<typeof coverageReportV1Schema>;

export const selectedEvidenceV1Schema = z
  .object({
    evidenceId: humanReadableIdSchema,
    evidenceHash: digestSchema,
    selectedAt: utcTimestampSchema,
  })
  .strict();

export type SelectedEvidenceV1 = z.infer<typeof selectedEvidenceV1Schema>;

export const gateDecisionV1Schema = z
  .object({
    schema: z.literal("werkstatt/gate-decision@1"),
    decisionId: decisionIdSchema,
    candidateId: humanReadableIdSchema,
    policyBundleRoot: digestSchema,
    gate: z.enum(["dev", "alt", "main"]),
    evaluationCut: authoritySequenceSchema,
    selectedEvidence: z.array(selectedEvidenceV1Schema).max(10000),
    status: certificationStatusSchema,
    coverage: coverageReportV1Schema,
    reasons: z.array(z.string().min(1).max(4096)).max(100),
    actionPackRef: digestSchema.nullable(),
    decidedAt: utcTimestampSchema,
  })
  .strict();

export type GateDecisionV1 = z.infer<typeof gateDecisionV1Schema>;

export const mainVerificationDecisionV1Schema = z
  .object({
    schema: z.literal("werkstatt/main-verification-decision@1"),
    decisionId: decisionIdSchema,
    candidateId: humanReadableIdSchema,
    policyBundleRoot: digestSchema,
    gate: z.literal("main"),
    evaluationCut: authoritySequenceSchema,
    selectedEvidence: z.array(selectedEvidenceV1Schema).max(10000),
    status: certificationStatusSchema,
    coverage: coverageReportV1Schema,
    reasons: z.array(z.string().min(1).max(4096)).max(100),
    actionPackRef: digestSchema.nullable(),
    rootDossierRef: digestSchema,
    priorOperationRef: digestSchema.nullable(),
    decidedAt: utcTimestampSchema,
  })
  .strict();

export type MainVerificationDecisionV1 = z.infer<typeof mainVerificationDecisionV1Schema>;

export const certificationHealthDecisionV1Schema = z
  .object({
    schema: z.literal("werkstatt/certification-health-decision@1"),
    candidateId: humanReadableIdSchema,
    currentStatus: certificationStatusSchema,
    lastDecisionId: decisionIdSchema.nullable(),
    lastDecisionAt: utcTimestampSchema.nullable(),
    staleEvidenceCount: z.number().int().nonnegative().max(10000),
    incompleteCount: z.number().int().nonnegative().max(1000),
    assessedAt: utcTimestampSchema,
  })
  .strict();

export type CertificationHealthDecisionV1 = z.infer<typeof certificationHealthDecisionV1Schema>;
