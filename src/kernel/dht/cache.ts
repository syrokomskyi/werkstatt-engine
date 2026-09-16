/*
<MODULE_CONTRACT>
<purpose>
RFC-0565: Local DHT cache for lookup results. Stores DHT site entries with
TTL-based expiry in werkstatt.dht.cache.json. Cache invalidation is TTL-only
(compatible with ephemeral CLI lifecycle — no push invalidation, no daemon).
Dead-workshop detection is handled at lookup time by checking SWIM membership.
</purpose>
<non-goals>
  <item>Do not implement push-based cache invalidation — TTL-only per RFC-0565 design.</item>
  <item>Do not implement cache compaction — the cache file is small (a few hundred entries max).</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Cache entries expire by TTL — stale lookups are re-fetched rather than refreshed in place.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0565: initial implementation — TTL-based DHT cache.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dhtCacheEntrySchema, type DHTCacheEntry, type DHTSiteEntry } from "./types.ts";

const CACHE_FILENAME = "werkstatt.dht.cache.json";

interface CacheFile {
  entries: Record<string, DHTCacheEntry>;
}

export async function loadCache(workspaceRoot: string): Promise<CacheFile> {
  const cachePath = join(workspaceRoot, CACHE_FILENAME);
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (!parsed.entries || typeof parsed.entries !== "object") {
      return { entries: {} };
    }
    return parsed;
  } catch {
    return { entries: {} };
  }
}

export async function saveCache(workspaceRoot: string, cache: CacheFile): Promise<void> {
  const cachePath = join(workspaceRoot, CACHE_FILENAME);
  await writeFile(cachePath, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

export function getCachedEntry(
  cache: CacheFile,
  siteId: string,
  now: Date = new Date(),
): DHTSiteEntry | null {
  const cached = cache.entries[siteId];
  if (!cached) return null;

  const expiresAt = new Date(cached.expiresAt);
  if (now > expiresAt) {
    return null;
  }

  return {
    siteId: cached.siteId,
    owner: cached.owner,
    workshopEndpoint: cached.workshopEndpoint,
    mirrors: cached.mirrors,
    registeredAt: cached.registeredAt,
    lastUpdated: cached.lastUpdated,
    signature: cached.signature,
  };
}

export async function setCachedEntry(
  workspaceRoot: string,
  siteId: string,
  entry: DHTSiteEntry,
  ttlMs: number,
): Promise<void> {
  const cache = await loadCache(workspaceRoot);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  const cacheEntry: DHTCacheEntry = {
    ...entry,
    cachedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  // Validate before storing
  dhtCacheEntrySchema.parse(cacheEntry);

  cache.entries[siteId] = cacheEntry;
  await saveCache(workspaceRoot, cache);
}

export async function clearCachedEntry(workspaceRoot: string, siteId: string): Promise<void> {
  const cache = await loadCache(workspaceRoot);
  delete cache.entries[siteId];
  await saveCache(workspaceRoot, cache);
}

export { CACHE_FILENAME };
