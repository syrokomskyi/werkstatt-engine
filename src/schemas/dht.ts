/*
<MODULE_CONTRACT>
<purpose>
RFC-0565: Zod schemas for the S/Kademlia-hardened DHT site registry and content
placement subsystem. Defines machine-checkable contracts for DHT site entries,
config, lookup results, placement results, and workshop capacity. These schemas
are the operations-layer contract consumed by @warpgogol/site-kernel DHT commands.
</purpose>
<non-goals>
  <item>Do not perform file IO or network operations — pure shape only.</item>
  <item>Do not define DHT routing protocol logic — that lives in site-kernel.</item>
  <item>Do not define Ed25519 signing logic — that lives in @warpgogol/werkstatt-shared/passport/dht-sign.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0565: initial DHT schemas (DHTSiteEntry, DHTConfig, DHTLookupResult, DHTPlacementResult, WorkshopCapacity).</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";

const kebabRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const didWebRe = /^did:web:[a-z0-9.-]+#.+$/;
const endpointRe = /^.+:\d+$/;

export const dhtSiteEntrySchema = z.object({
  siteId: z.string().regex(kebabRe, "siteId must be kebab-case, lowercase, latin-only"),
  owner: z
    .string()
    .regex(didWebRe, "owner must be a did:web identifier (did:web:<domain>#<key-version>)")
    .describe("VC subject id of the site owner (RFC-0558, RFC-0561)"),
  workshopEndpoint: z.string().regex(endpointRe, "workshopEndpoint must be host:port format"),
  mirrors: z.array(z.string().url()).default([]),
  registeredAt: z.string().datetime(),
  lastUpdated: z.string().datetime(),
  signature: z.string().min(1, "signature must be a non-empty Ed25519 multibase signature"),
});

export const dhtConfigSchema = z.object({
  bindAddr: z.string().regex(endpointRe, "bindAddr must be host:port format"),
  bootstrapNodes: z
    .array(z.string().regex(endpointRe, "each bootstrapNode must be host:port format"))
    .default([]),
  replicationFactor: z.number().int().min(1).max(20).default(5),
  lookupTimeoutMs: z.number().int().min(100).default(5000),
  cacheTtlMs: z.number().int().min(1000).default(300000),
});

export const dhtLookupResultSchema = z.object({
  found: z.boolean(),
  entry: dhtSiteEntrySchema.nullable(),
  hops: z.number().int().min(0),
  latencyMs: z.number().int().min(0),
  cached: z.boolean().default(false),
  signatureValid: z.boolean().default(true),
  diagnostics: z.array(z.string()).optional(),
});

export const dhtPlacementReasonSchema = z.enum([
  "least-loaded",
  "nearest",
  "owner-preference",
  "local-fallback",
]);

export const workshopCapacitySchema = z.object({
  workshopId: z.string().min(1),
  endpoint: z.string().regex(endpointRe, "endpoint must be host:port format"),
  availableSlots: z.number().int().min(0),
  storageLimitMb: z.number().int().min(0).default(0),
  bandwidthLimitMbps: z.number().int().min(0).default(0),
  activeMissions: z.number().int().min(0).default(0),
  maxMissions: z.number().int().min(1).default(1),
  cpuLoad: z.number().min(0).max(1).default(0),
  diskFree: z.number().int().min(0).default(0),
  updatedAt: z.string().datetime(),
  signature: z.string().min(1),
});

export const dhtPlacementResultSchema = z.object({
  siteId: z.string().regex(kebabRe, "siteId must be kebab-case"),
  assignedWorkshop: z.string().min(1),
  reason: dhtPlacementReasonSchema,
  capacity: workshopCapacitySchema.nullable(),
});

export const dhtCacheEntrySchema = dhtSiteEntrySchema.extend({
  cachedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export type DHTSiteEntry = z.infer<typeof dhtSiteEntrySchema>;
export type DHTConfig = z.infer<typeof dhtConfigSchema>;
export type DHTLookupResult = z.infer<typeof dhtLookupResultSchema>;
export type DHTPlacementReason = z.infer<typeof dhtPlacementReasonSchema>;
export type WorkshopCapacity = z.infer<typeof workshopCapacitySchema>;
export type DHTPlacementResult = z.infer<typeof dhtPlacementResultSchema>;
export type DHTCacheEntry = z.infer<typeof dhtCacheEntrySchema>;
