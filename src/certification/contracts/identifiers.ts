/*
<MODULE_CONTRACT>
<purpose>identifiers contract — Zod schemas for certification digests and entity identifiers.</purpose>
<non-goals>
  <item>Do not compute digests — this module defines the contract only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";

const sha256Regex = /^sha256:[0-9a-f]{64}$/;
export const digestSchema = z.string().regex(sha256Regex) as unknown as z.ZodType<Sha256Digest>;

export const schemaIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^werkstatt\/[a-z0-9-]+@[0-9]+$/);

export const candidateIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^cand-[a-z0-9-]+$/);

export const evidenceIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^ev-[a-z0-9-]+$/);

export const decisionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^dec-[a-z0-9-]+$/);

export const actionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^act-[a-z0-9-]+$/);

export const eventIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^evt-[a-z0-9-]+$/);

export const operationIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^op-[a-z0-9-]+$/);

export const attemptIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^att-[a-z0-9-]+$/);

export const authoritySequenceSchema = z.number().int().nonnegative().max(999999);

export const humanReadableIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i);

const rfc3339Regex =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export const utcTimestampSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(rfc3339Regex);

export const gateChannelSchema = z.enum(["dev", "alt", "main"]);
export type GateChannel = z.infer<typeof gateChannelSchema>;

export const environmentSchema = z.enum(["dev", "alt", "main", "staging"]);
export type Environment = z.infer<typeof environmentSchema>;

export const certificationStatusSchema = z.enum([
  "pass",
  "fail",
  "stale",
  "incomplete",
  "blocked",
  "waived",
]);
export type CertificationStatus = z.infer<typeof certificationStatusSchema>;

const safePathRegex = /^[a-z0-9][a-z0-9._/-]*$/i;
export const safeSemanticPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((v) => safePathRegex.test(v) && !v.includes("..") && !v.includes("\\"), {
    message: "CERT-PATH-01: path must be workspace-relative POSIX without .. or backslashes",
  });

export const safeLocatorSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (v) =>
      !v.includes("://") ||
      v.startsWith("https://") ||
      v.startsWith("http://"),
    {
      message: "CERT-PATH-01: locator must not contain credentials or non-http schemes",
    },
  )
  .refine((v) => !v.includes("@") || !v.includes(":"), {
    message: "CERT-PATH-01: locator must not contain credentials",
  });
