/*
<MODULE_CONTRACT>
<purpose>
RFC-0565: TypeScript contracts for the S/Kademlia-hardened DHT site registry and
content placement subsystem. Re-exports types from @warpgogol/werkstatt-shared/ontology/operations
so that DHT command handlers in site-kernel consume the same canonical types as
all other platform operations.
</purpose>
<non-goals>
  <item>Do not implement command handlers — those live in lookup.ts, register.ts, placement.ts, etc.</item>
  <item>Do not implement DHT routing — that lives in node.ts.</item>
  <item>Do not define Zod schemas — those live in @warpgogol/werkstatt-engine/schemas/dht.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0565: initial type contracts for DHT subsystem — re-exports from ontology.</item>
</CHANGE_SUMMARY>
*/

export type {
  DHTSiteEntry,
  DHTConfig,
  DHTLookupResult,
  DHTPlacementReason,
  WorkshopCapacity,
  DHTPlacementResult,
  DHTCacheEntry,
} from "@warpgogol/werkstatt-engine/schemas";

export {
  dhtSiteEntrySchema,
  dhtConfigSchema,
  dhtLookupResultSchema,
  dhtPlacementReasonSchema,
  workshopCapacitySchema,
  dhtPlacementResultSchema,
  dhtCacheEntrySchema,
} from "@warpgogol/werkstatt-engine/schemas";
