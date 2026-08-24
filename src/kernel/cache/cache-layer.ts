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
<CHANGE_SUMMARY>
  <item>RFC-0382: initial implementation — CacheLayer interface, CacheEntry, CacheStatus, createCacheLayer factory.</item>
  <item>RFC-0382 post-review: remove unused staleEntries placeholder from CacheNamespaceStatus.</item>
  <item>ADR-0023: add close() method for explicit resource cleanup after pipeline completion.</item>
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
