/*
<MODULE_CONTRACT>
<purpose>RFC-0358/RFC-0379/RFC-0666: Zod schemas for deployment config, channel model, and propagation results. secretsFile field kept as z.string().optional() for detection (sternsystem.validate rejects any value); secretRefSchema removed as dead code.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0790: add deploymentStaticConfigSchema (adapter + channels only, no lastPropagated) for system-config.yaml.</item>
  <item>RFC-0926: add optional workerVersionId to propagationResultSchema and lastPropagatedChannelSchema for release-aware rollback.</item>
  <item>RFC-1091: add github-pages to deploymentAdapterNameSchema enum.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <history>RFC-0358, RFC-0379, RFC-0595, RFC-0624, RFC-0627, RFC-0666</history>
</CHANGE_SUMMARY>
*/

import { z } from "zod";

export const deploymentAdapterNameSchema = z.enum([
  "cloudflare-workers",
  "github-pages",
  "netlify",
  "null",
]);

export const deploymentChannelSchema = z.object({
  workerName: z.string(),
  url: z.string().url(),
  // RFC-0666: secretsFile kept as z.string().optional() for detection — sternsystem.validate rejects any value.
  // secretRefSchema removed (dead code — env vars were never set).
  secretsFile: z.string().optional(),
});

export const purgeResultSchema = z.object({
  success: z.boolean(),
  purgedUrls: z.number(),
  error: z.string().optional(),
});

export const lastPropagatedChannelSchema = z.object({
  releaseId: z.string(),
  at: z.string().datetime(),
  healthy: z.boolean(),
  state: z.enum(["succeeded", "failed", "failed-stale", "in-progress"]),
  operationId: z.string(),
  leaseExpiresAt: z.string().datetime().nullable(),
  purgeResult: purgeResultSchema.optional(),
  workerVersionId: z.string().optional(),
});

export const healthCheckSchema = z.object({
  name: z.string(),
  url: z.string(),
  status: z.number().int(),
  passed: z.boolean(),
  detail: z.string(),
  expectedHash: z.string().optional(),
  actualHash: z.string().optional(),
});

export const propagationResultSchema = z.object({
  systemId: z.string(),
  releaseId: z.string(),
  state: z.enum(["succeeded", "failed", "failed-stale", "in-progress"]),
  deploymentUrl: z.string(),
  workerVersionId: z.string().optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  healthChecks: z.array(healthCheckSchema),
});

export const routeFactSchema = z.object({
  path: z.string(),
  contentHash: z.string().nullable(),
  redirectTarget: z.string().optional(),
});

export type DeploymentAdapterName = z.infer<typeof deploymentAdapterNameSchema>;
export type DeploymentChannel = z.infer<typeof deploymentChannelSchema>;
export type LastPropagatedChannel = z.infer<typeof lastPropagatedChannelSchema>;
export type PurgeResult = z.infer<typeof purgeResultSchema>;
export const deploymentStaticConfigSchema = z.object({
  adapter: deploymentAdapterNameSchema,
  channels: z.object({
    dev: deploymentChannelSchema,
    alt: deploymentChannelSchema,
    main: deploymentChannelSchema,
  }),
});

export type DeploymentStaticConfig = z.infer<typeof deploymentStaticConfigSchema>;
export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type PropagationResult = z.infer<typeof propagationResultSchema>;
export type RouteFact = z.infer<typeof routeFactSchema>;
