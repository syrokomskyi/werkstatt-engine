/*
<MODULE_CONTRACT>
<purpose>RFC-0358/RFC-0379/RFC-0666: Zod schemas for deployment config, channel model, and propagation results. secretsFile field kept as z.string().optional() for detection (sternsystem.validate rejects any value); secretRefSchema removed as dead code.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0358: initial leitstand schemas.</item>
  <item>RFC-0379: remove cloudflare-pages/vercel from adapter enum, add null; replace flat target/credentials/lastPropagation with channel model (channels + per-channel lastPropagated with operational state).</item>
  <item>RFC-0595: add RouteFact with contentHash: string | null and optional redirectTarget.</item>
  <item>RFC-0624: add purgeResult to lastPropagatedChannelSchema, purgeResultSchema, deploymentConfigSchema, purge tracking.</item>
  <item>RFC-0627: add channels.dev (required), make channels.alt required, add dev to lastPropagated.</item>
  <item>RFC-0666: remove secretRefSchema and SecretRef (dead code); change secretsFile field to z.string().optional() for detection (sternsystem.validate rejects any value).</item>
  <item>RFC-0790: add deploymentStaticConfigSchema (adapter + channels only, no lastPropagated) for system-config.yaml.</item>
  <item>RFC-0926: add optional workerVersionId to propagationResultSchema and lastPropagatedChannelSchema for release-aware rollback.</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";

export const deploymentAdapterNameSchema = z.enum(["cloudflare-workers", "netlify", "null"]);

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
