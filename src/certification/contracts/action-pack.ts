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
