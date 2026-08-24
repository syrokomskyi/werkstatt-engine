import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadCache,
  saveCache,
  getCachedEntry,
  setCachedEntry,
  clearCachedEntry,
  CACHE_FILENAME,
} from "./cache.ts";
import type { DHTSiteEntry } from "./types.ts";

function makeEntry(siteId: string): DHTSiteEntry {
  return {
    siteId,
    owner: "did:web:example.com#v1",
    workshopEndpoint: "10.0.0.1:7947",
    mirrors: [],
    registeredAt: "2025-01-01T00:00:00.000Z",
    lastUpdated: "2025-01-01T00:00:00.000Z",
    signature: "zFakeSignature123",
  };
}

describe("dht/cache", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dht-cache-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loadCache returns empty cache when file does not exist", async () => {
    const cache = await loadCache(tmpDir);
    expect(cache.entries).toEqual({});
  });

  it("setCachedEntry and getCachedEntry round-trip", async () => {
    const entry = makeEntry("test-bundle");
    await setCachedEntry(tmpDir, "test-bundle", entry, 300000);

    const cache = await loadCache(tmpDir);
    const cached = getCachedEntry(cache, "test-bundle");
    expect(cached).not.toBeNull();
    expect(cached!.siteId).toBe("test-bundle");
    expect(cached!.owner).toBe("did:web:example.com#v1");
  });

  it("getCachedEntry returns null for expired entries", async () => {
    const entry = makeEntry("test-bundle");
    // Set with 1ms TTL, then wait for expiry
    await setCachedEntry(tmpDir, "test-bundle", entry, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cache = await loadCache(tmpDir);
    const cached = getCachedEntry(cache, "test-bundle");
    expect(cached).toBeNull();
  });

  it("getCachedEntry returns null for missing site", async () => {
    const cache = await loadCache(tmpDir);
    const cached = getCachedEntry(cache, "nonexistent");
    expect(cached).toBeNull();
  });

  it("clearCachedEntry removes entry", async () => {
    const entry = makeEntry("test-bundle");
    await setCachedEntry(tmpDir, "test-bundle", entry, 300000);
    await clearCachedEntry(tmpDir, "test-bundle");

    const cache = await loadCache(tmpDir);
    expect(cache.entries["test-bundle"]).toBeUndefined();
  });

  it("saveCache and loadCache round-trip", async () => {
    const cache = {
      entries: {
        "site-a": {
          ...makeEntry("site-a"),
          cachedAt: "2025-01-01T00:00:00.000Z",
          expiresAt: "2025-01-01T00:05:00.000Z",
        },
      },
    };
    await saveCache(tmpDir, cache);

    const loaded = await loadCache(tmpDir);
    expect(loaded.entries["site-a"]).toBeDefined();
    expect(loaded.entries["site-a"]!.siteId).toBe("site-a");
  });

  it("CACHE_FILENAME is werkstatt.dht.cache.json", () => {
    expect(CACHE_FILENAME).toBe("werkstatt.dht.cache.json");
  });
});
