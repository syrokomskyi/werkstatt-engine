/*
<MODULE_CONTRACT>
<purpose>
RFC-0354: Zod schemas for the Sternsystem bundle contract — the durable site unit,
fleet registry, and version pin. These schemas are the machine-checkable contract
for all Sternsystem operations.
RFC-0561: fleetRegistryEntrySchema gains optional owner field (did:web VC subject id).
RFC-0574: replace repo/mirror with parameterized mirrors[] array.
RFC-0752: add cloudflareZoneId to fleetRegistryEntrySchema, services[] with subdomains to fleetRegistrySchema.
RFC-0751: extend serviceEntrySchema with deployment fields (kind, url, publicEndpoints, routes, upstreams, lastDeployed, healthCheckPath).
RFC-0790: add systemConfigSchema, systemStateSchema, servicesRegistrySchema for convention-based discovery (replaces fleetRegistrySchema).
</purpose>
<non-goals>
  <item>Do not perform file IO or git operations — pure shape only.</item>
  <item>Do not define mission or release schemas — those live in subsequent RFCs.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0964: add fleet.canary field to systemConfigSchema for wave orchestration.</item>
  <item>RFC-0966: add passportRequired to systemStateSchema for passport enforcement gating.</item>
  <item>RFC-0967: add ownershipRequired to systemStateSchema for ownership enforcement gating.</item>
  <item>RFC-1065: add lagebild to systemStateSchema for Lagebild connection metadata.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <history>RFC-0354, RFC-0479, RFC-0561, RFC-0574, RFC-0751, RFC-0752, RFC-0790, RFC-0806, RFC-0902</history>
</CHANGE_SUMMARY>
*/

import { z } from "zod";
import { starNameSchema } from "@warpgogol/werkstatt-shared/ontology/cosmic";
import { deploymentStaticConfigSchema, lastPropagatedChannelSchema } from "./leitstand.ts";

const semverRe = /^\d+\.\d+\.\d+$/;
const sha256Re = /^sha256:[0-9a-f]{64}$/;
const kebabRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const didWebRe = /^did:web:[a-z0-9.-]+#.+$/;

export const systemPinSchema = z.object({
  schemaVersion: z.string().min(1),
  systemId: z
    .string()
    .regex(kebabRe, "systemId must be kebab-case, lowercase, latin-only, no TLD suffix"),
  cosmicStar: starNameSchema,
  pinnedAt: z.string().datetime(),
  platform: z.object({
    version: z.string().regex(semverRe, "platform.version must be x.y.z"),
    commit: z.string().min(7),
    rfcHead: z.string().regex(/^RFC-\d{4}$/, "rfcHead must be RFC-NNNN"),
    platformSemanticHash: z
      .string()
      .regex(sha256Re, "platformSemanticHash must be sha256: prefixed hex"),
  }),
  migratorCursor: z.array(z.string()),
  capabilities: z.array(
    z.object({
      semanticId: z.string().min(1),
      version: z.string().min(1),
      intent: z.array(z.string()),
    }),
  ),
});

export const mirrorStorageTypeSchema = z.enum(["non-bare", "bare", "bundle"]);

export type MirrorStorageType = z.infer<typeof mirrorStorageTypeSchema>;

export const mirrorEntrySchema = z.object({
  path: z.string().min(1, "mirror path must be non-empty"),
  storageType: mirrorStorageTypeSchema,
});

export type MirrorEntry = z.infer<typeof mirrorEntrySchema>;

export const serviceSubdomainSchema = z.object({
  domain: z.string().min(1, "subdomain domain must be non-empty"),
  zone: z.string().min(1, "subdomain zone must be non-empty"),
});

export const serviceEntrySchema = z.object({
  id: z
    .string()
    .regex(kebabRe, "service id must be kebab-case, lowercase, latin-only, no TLD suffix"),
  kind: z.enum(["proxy-worker", "scheduled-worker", "cloudflare-worker"]),
  workerName: z.string().min(1, "workerName must be non-empty"),
  hostedBy: z.enum(["studio"]),
  url: z.string().min(1, "url must be non-empty"),
  workersDevUrl: z.string().min(1, "workersDevUrl must be non-empty").optional(),
  publicEndpoints: z.boolean().default(false),
  routes: z.array(z.string()).optional(),
  upstreams: z.array(z.string()).optional(),
  subdomains: z.array(serviceSubdomainSchema).default([]),
  lastDeployed: z
    .object({
      at: z.string().datetime().nullable(),
      state: z.enum(["succeeded", "failed"]).nullable(),
      operationId: z.string().nullable(),
    })
    .default({ at: null, state: null, operationId: null }),
  lastDevDeployed: z
    .object({
      at: z.string().datetime().nullable(),
      state: z.enum(["succeeded", "failed"]).nullable(),
      operationId: z.string().nullable(),
    })
    .default({ at: null, state: null, operationId: null })
    .describe("RFC-0806: last dev-channel deployment state"),
  healthCheckPath: z.string().optional(),
});

// RFC-0790: Convention-based discovery schemas (replaces fleet registry)

export const systemConfigSchema = z.object({
  schemaVersion: z.string().min(1),
  id: z.string().regex(kebabRe, "id must be kebab-case, lowercase, latin-only, no TLD suffix"),
  cosmicStar: starNameSchema,
  mirrors: z.array(mirrorEntrySchema).min(1, "mirrors must contain at least 1 entry"),
  pinnedPlatform: z.string().regex(semverRe, "pinnedPlatform must be x.y.z"),
  status: z.enum(["registered", "active", "paused", "archived"]),
  registeredAt: z.string().datetime(),
  deployment: deploymentStaticConfigSchema.optional(),
  cloudflareZoneId: z
    .string()
    .min(1, "cloudflareZoneId must be non-empty")
    .optional()
    .describe("Cloudflare zone ID for DNS and Workers route management (RFC-0752)"),
  owner: z
    .string()
    .regex(didWebRe, "owner must be a did:web identifier (did:web:<domain>#<key-version>)")
    .optional()
    .describe("VC subject id of the site owner (RFC-0558, RFC-0561)"),
  notes: z.string().default(""),
  fleet: z
    .object({
      canary: z.boolean().default(false),
    })
    .optional()
    .describe("RFC-0964: fleet wave orchestration config"),
});

export const systemStateSchema = z.object({
  schemaVersion: z.string().min(1),
  systemId: z
    .string()
    .regex(kebabRe, "systemId must be kebab-case, lowercase, latin-only, no TLD suffix"),
  currentMission: z.string().nullable().default(null),
  lastRelease: z.string().nullable().default(null),
  lastPropagated: z
    .object({
      dev: lastPropagatedChannelSchema.optional(),
      alt: lastPropagatedChannelSchema.optional(),
      main: lastPropagatedChannelSchema.optional(),
    })
    .default({}),
  // RFC-0899: 4-digit PIN for dev/alt subdomain access protection. Null when not set.
  accessPin: z
    .string()
    .regex(/^\d{4}$/, "accessPin must be a 4-digit numeric string")
    .nullable()
    .default(null),
  // RFC-0966: Controls PASSPORT-01 warning vs blocking. false during rollout,
  // set to true by sternsystem.passport.generate after first successful generation.
  passportRequired: z.boolean().default(false),
  // RFC-0967: Controls OWNERSHIP-01 warning vs blocking. false during rollout,
  // set to true per-site when ready for blocking enforcement.
  ownershipRequired: z.boolean().default(false),
  // RFC-1065: Lagebild connection metadata. Undefined when not connected.
  lagebild: z
    .object({
      connected: z.boolean(),
      apiUrl: z.string(),
      tenantId: z.string(),
      sourceSystemId: z.string(),
      connectedAt: z.string(),
      channel: z.string(),
    })
    .optional(),
});

export const servicesRegistrySchema = z.object({
  schemaVersion: z.string().min(1),
  services: z.array(serviceEntrySchema),
});

export type SystemPin = z.infer<typeof systemPinSchema>;
export type ServiceSubdomain = z.infer<typeof serviceSubdomainSchema>;
export type ServiceEntry = z.infer<typeof serviceEntrySchema>;
export type SystemConfig = z.infer<typeof systemConfigSchema>;
export type SystemState = z.infer<typeof systemStateSchema>;
export type ServicesRegistry = z.infer<typeof servicesRegistrySchema>;
