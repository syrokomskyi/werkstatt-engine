import { test, expect } from "vitest";
import {
  dhtSiteEntrySchema,
  dhtConfigSchema,
  dhtLookupResultSchema,
  dhtPlacementReasonSchema,
  workshopCapacitySchema,
  dhtPlacementResultSchema,
  dhtCacheEntrySchema,
} from "../schemas/dht.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidSiteEntry() {
  return {
    siteId: "warpgogol-com",
    owner: "did:web:warpgogol.com#key-1",
    workshopEndpoint: "localhost:4242",
    mirrors: ["https://mirror1.example.com"],
    registeredAt: "2026-01-01T00:00:00.000Z",
    lastUpdated: "2026-01-02T00:00:00.000Z",
    signature: "sig123",
  };
}

function makeValidCapacity() {
  return {
    workshopId: "ws-1",
    endpoint: "localhost:4242",
    availableSlots: 5,
    storageLimitMb: 1000,
    bandwidthLimitMbps: 100,
    activeMissions: 2,
    maxMissions: 10,
    cpuLoad: 0.3,
    diskFree: 500,
    updatedAt: "2026-01-01T00:00:00.000Z",
    signature: "sig456",
  };
}

// ---------------------------------------------------------------------------
// dhtSiteEntrySchema
// ---------------------------------------------------------------------------

test("dhtSiteEntrySchema accepts valid entry", () => {
  const result = dhtSiteEntrySchema.safeParse(makeValidSiteEntry());
  expect(result.success).toBe(true);
});

test("dhtSiteEntrySchema accepts empty mirrors (default)", () => {
  const entry = { ...makeValidSiteEntry(), mirrors: [] };
  const result = dhtSiteEntrySchema.safeParse(entry);
  expect(result.success).toBe(true);
});

test("dhtSiteEntrySchema rejects non-kebab siteId", () => {
  const entry = { ...makeValidSiteEntry(), siteId: "WarpgogolCom" };
  const result = dhtSiteEntrySchema.safeParse(entry);
  expect(result.success).toBe(false);
});

test("dhtSiteEntrySchema rejects invalid did:web owner", () => {
  const entry = { ...makeValidSiteEntry(), owner: "https://warpgogol.com" };
  const result = dhtSiteEntrySchema.safeParse(entry);
  expect(result.success).toBe(false);
});

test("dhtSiteEntrySchema rejects invalid workshopEndpoint (no port)", () => {
  const entry = { ...makeValidSiteEntry(), workshopEndpoint: "localhost" };
  const result = dhtSiteEntrySchema.safeParse(entry);
  expect(result.success).toBe(false);
});

test("dhtSiteEntrySchema rejects non-URL mirrors", () => {
  const entry = { ...makeValidSiteEntry(), mirrors: ["not-a-url"] };
  const result = dhtSiteEntrySchema.safeParse(entry);
  expect(result.success).toBe(false);
});

test("dhtSiteEntrySchema rejects empty signature", () => {
  const entry = { ...makeValidSiteEntry(), signature: "" };
  const result = dhtSiteEntrySchema.safeParse(entry);
  expect(result.success).toBe(false);
});

test("dhtSiteEntrySchema rejects non-ISO datetime", () => {
  const entry = { ...makeValidSiteEntry(), registeredAt: "2026-01-01" };
  const result = dhtSiteEntrySchema.safeParse(entry);
  expect(result.success).toBe(false);
});

// ---------------------------------------------------------------------------
// dhtConfigSchema
// ---------------------------------------------------------------------------

test("dhtConfigSchema accepts valid config with all fields", () => {
  const result = dhtConfigSchema.safeParse({
    bindAddr: "0.0.0.0:4242",
    bootstrapNodes: ["1.2.3.4:4242"],
    replicationFactor: 10,
    lookupTimeoutMs: 3000,
    cacheTtlMs: 60000,
  });
  expect(result.success).toBe(true);
});

test("dhtConfigSchema applies defaults for optional fields", () => {
  const result = dhtConfigSchema.safeParse({
    bindAddr: "0.0.0.0:4242",
  });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.bootstrapNodes).toEqual([]);
    expect(result.data.replicationFactor).toBe(5);
    expect(result.data.lookupTimeoutMs).toBe(5000);
    expect(result.data.cacheTtlMs).toBe(300000);
  }
});

test("dhtConfigSchema rejects replicationFactor > 20", () => {
  const result = dhtConfigSchema.safeParse({
    bindAddr: "0.0.0.0:4242",
    replicationFactor: 21,
  });
  expect(result.success).toBe(false);
});

test("dhtConfigSchema rejects replicationFactor < 1", () => {
  const result = dhtConfigSchema.safeParse({
    bindAddr: "0.0.0.0:4242",
    replicationFactor: 0,
  });
  expect(result.success).toBe(false);
});

test("dhtConfigSchema rejects lookupTimeoutMs < 100", () => {
  const result = dhtConfigSchema.safeParse({
    bindAddr: "0.0.0.0:4242",
    lookupTimeoutMs: 50,
  });
  expect(result.success).toBe(false);
});

test("dhtConfigSchema rejects cacheTtlMs < 1000", () => {
  const result = dhtConfigSchema.safeParse({
    bindAddr: "0.0.0.0:4242",
    cacheTtlMs: 500,
  });
  expect(result.success).toBe(false);
});

test("dhtConfigSchema rejects invalid bindAddr", () => {
  const result = dhtConfigSchema.safeParse({
    bindAddr: "no-port-here",
  });
  expect(result.success).toBe(false);
});

// ---------------------------------------------------------------------------
// dhtLookupResultSchema
// ---------------------------------------------------------------------------

test("dhtLookupResultSchema accepts found result with entry", () => {
  const result = dhtLookupResultSchema.safeParse({
    found: true,
    entry: makeValidSiteEntry(),
    hops: 3,
    latencyMs: 150,
    cached: false,
    signatureValid: true,
  });
  expect(result.success).toBe(true);
});

test("dhtLookupResultSchema accepts not-found result with null entry", () => {
  const result = dhtLookupResultSchema.safeParse({
    found: false,
    entry: null,
    hops: 0,
    latencyMs: 10,
  });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.cached).toBe(false);
    expect(result.data.signatureValid).toBe(true);
  }
});

test("dhtLookupResultSchema rejects negative hops", () => {
  const result = dhtLookupResultSchema.safeParse({
    found: false,
    entry: null,
    hops: -1,
    latencyMs: 10,
  });
  expect(result.success).toBe(false);
});

test("dhtLookupResultSchema rejects negative latencyMs", () => {
  const result = dhtLookupResultSchema.safeParse({
    found: false,
    entry: null,
    hops: 0,
    latencyMs: -1,
  });
  expect(result.success).toBe(false);
});

test("dhtLookupResultSchema accepts optional diagnostics", () => {
  const result = dhtLookupResultSchema.safeParse({
    found: false,
    entry: null,
    hops: 0,
    latencyMs: 10,
    diagnostics: ["timeout", "retry"],
  });
  expect(result.success).toBe(true);
});

// ---------------------------------------------------------------------------
// dhtPlacementReasonSchema
// ---------------------------------------------------------------------------

test("dhtPlacementReasonSchema accepts all enum values", () => {
  for (const reason of ["least-loaded", "nearest", "owner-preference", "local-fallback"]) {
    expect(dhtPlacementReasonSchema.safeParse(reason).success).toBe(true);
  }
});

test("dhtPlacementReasonSchema rejects invalid reason", () => {
  expect(dhtPlacementReasonSchema.safeParse("random").success).toBe(false);
  expect(dhtPlacementReasonSchema.safeParse("").success).toBe(false);
});

// ---------------------------------------------------------------------------
// workshopCapacitySchema
// ---------------------------------------------------------------------------

test("workshopCapacitySchema accepts valid capacity", () => {
  const result = workshopCapacitySchema.safeParse(makeValidCapacity());
  expect(result.success).toBe(true);
});

test("workshopCapacitySchema applies defaults for optional fields", () => {
  const result = workshopCapacitySchema.safeParse({
    workshopId: "ws-1",
    endpoint: "localhost:4242",
    availableSlots: 5,
    updatedAt: "2026-01-01T00:00:00.000Z",
    signature: "sig",
  });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.storageLimitMb).toBe(0);
    expect(result.data.bandwidthLimitMbps).toBe(0);
    expect(result.data.activeMissions).toBe(0);
    expect(result.data.maxMissions).toBe(1);
    expect(result.data.cpuLoad).toBe(0);
    expect(result.data.diskFree).toBe(0);
  }
});

test("workshopCapacitySchema rejects cpuLoad > 1", () => {
  const result = workshopCapacitySchema.safeParse({
    ...makeValidCapacity(),
    cpuLoad: 1.5,
  });
  expect(result.success).toBe(false);
});

test("workshopCapacitySchema rejects negative cpuLoad", () => {
  const result = workshopCapacitySchema.safeParse({
    ...makeValidCapacity(),
    cpuLoad: -0.1,
  });
  expect(result.success).toBe(false);
});

test("workshopCapacitySchema rejects maxMissions < 1", () => {
  const result = workshopCapacitySchema.safeParse({
    ...makeValidCapacity(),
    maxMissions: 0,
  });
  expect(result.success).toBe(false);
});

test("workshopCapacitySchema rejects negative availableSlots", () => {
  const result = workshopCapacitySchema.safeParse({
    ...makeValidCapacity(),
    availableSlots: -1,
  });
  expect(result.success).toBe(false);
});

// ---------------------------------------------------------------------------
// dhtPlacementResultSchema
// ---------------------------------------------------------------------------

test("dhtPlacementResultSchema accepts valid result with capacity", () => {
  const result = dhtPlacementResultSchema.safeParse({
    siteId: "warpgogol-com",
    assignedWorkshop: "ws-1",
    reason: "least-loaded",
    capacity: makeValidCapacity(),
  });
  expect(result.success).toBe(true);
});

test("dhtPlacementResultSchema accepts null capacity", () => {
  const result = dhtPlacementResultSchema.safeParse({
    siteId: "warpgogol-com",
    assignedWorkshop: "ws-1",
    reason: "local-fallback",
    capacity: null,
  });
  expect(result.success).toBe(true);
});

test("dhtPlacementResultSchema rejects non-kebab siteId", () => {
  const result = dhtPlacementResultSchema.safeParse({
    siteId: "INVALID",
    assignedWorkshop: "ws-1",
    reason: "nearest",
    capacity: null,
  });
  expect(result.success).toBe(false);
});

test("dhtPlacementResultSchema rejects empty assignedWorkshop", () => {
  const result = dhtPlacementResultSchema.safeParse({
    siteId: "warpgogol-com",
    assignedWorkshop: "",
    reason: "nearest",
    capacity: null,
  });
  expect(result.success).toBe(false);
});

// ---------------------------------------------------------------------------
// dhtCacheEntrySchema
// ---------------------------------------------------------------------------

test("dhtCacheEntrySchema accepts valid cache entry", () => {
  const result = dhtCacheEntrySchema.safeParse({
    ...makeValidSiteEntry(),
    cachedAt: "2026-01-01T12:00:00.000Z",
    expiresAt: "2026-01-01T12:05:00.000Z",
  });
  expect(result.success).toBe(true);
});

test("dhtCacheEntrySchema rejects without cachedAt", () => {
  const result = dhtCacheEntrySchema.safeParse({
    ...makeValidSiteEntry(),
    expiresAt: "2026-01-01T12:05:00.000Z",
  });
  expect(result.success).toBe(false);
});

test("dhtCacheEntrySchema rejects without expiresAt", () => {
  const result = dhtCacheEntrySchema.safeParse({
    ...makeValidSiteEntry(),
    cachedAt: "2026-01-01T12:00:00.000Z",
  });
  expect(result.success).toBe(false);
});
