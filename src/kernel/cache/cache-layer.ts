/*
<MODULE_CONTRACT>
<purpose>
RFC-0382: CacheLayer interface and factory for the kernel cache system.
Defines the contract for persistent, file-backed caching of parsed data
(RFC frontmatter, future namespaces). The factory tries better-sqlite3
and falls back to NoopCacheLayer when the native module is unavailable.
</purpose>
<non-goals>
  <item>Do not implement SQLite-specific logic — that lives in sqlite-cache-layer.ts.</item>
  <item>Do not implement RFC-specific cache helpers — that lives in rfc-cache.ts.</item>
  <item>Do not cache tsImport results or kernel config loading.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>CacheLayer is a port interface — storage backends implement it, callers depend on the port.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>ADR-0023: add close() method for explicit resource cleanup after pipeline completion.</item>
  <item>RFC-1028: add CacheEntryInfo interface and optional list() method for cache entry inspection.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1133: cache direct executeKernelCommand executions with flag-keyed results</item>
  <history>RFC-0382</history>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";

export interface CacheEntry {
  key: string;
  data: unknown;
  mtime: number;
  contentHash: string;
  updatedAt: number;
}

export interface CacheNamespaceStatus {
  name: string;
  entries: number;
  hitRatio: number;
}

export interface CacheStatus {
  available: boolean;
  unavailableReason?: string;
  dbPath: string;
  dbSizeBytes: number;
  namespaces: CacheNamespaceStatus[];
}

export interface CacheLayer {
  readonly available: boolean;
  readonly unavailableReason?: string;
  get(namespace: string, key: string): Promise<CacheEntry | null>;
  set(
    namespace: string,
    key: string,
    data: unknown,
    mtime: number,
    contentHash: string,
  ): Promise<void>;
  clear(namespace?: string): Promise<void>;
  status(): Promise<CacheStatus>;
  close(): Promise<void>;
  /** RFC-1028: list cache entries for inspection (validation.state.inspect). */
  list?(filter?: CacheListFilter): Promise<CacheEntryInfo[]>;
}

export interface CacheListFilter {
  namespace?: string;
  commandName?: string;
}

export interface CacheEntryInfo {
  namespace: string;
  key: string;
  commandName: string;
  siteName: string | null;
  inputsHash: string;
  moduleHash: string;
  /** RFC-1133: hash of cache-visible resolved flags ("" when none). */
  flagsHash: string;
  cachedAt: number;
  hitCount: number;
}

export const CACHE_DB_RELATIVE_PATH = join(".cache", "kernel-cache.db");

export function cacheDbPath(workspaceRoot: string): string {
  return join(workspaceRoot, CACHE_DB_RELATIVE_PATH);
}

export async function createCacheLayer(workspaceRoot: string): Promise<CacheLayer> {
  const dbPath = cacheDbPath(workspaceRoot);
  try {
    const { SqliteCacheLayer } = await import("./sqlite-cache-layer.ts");
    const layer = new SqliteCacheLayer(dbPath);
    return layer;
  } catch (err) {
    const reason =
      err instanceof Error
        ? `better-sqlite3 not installed or native binary incompatible: ${err.message}`
        : "better-sqlite3 not installed or native binary incompatible";
    const { NoopCacheLayer } = await import("./noop-cache-layer.ts");
    return new NoopCacheLayer(dbPath, reason);
  }
}
