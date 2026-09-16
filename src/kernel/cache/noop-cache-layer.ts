/*
<MODULE_CONTRACT>
<purpose>
RFC-0382: No-op fallback cache layer. Used when better-sqlite3 is not
installed or the native binary is incompatible. All operations are no-ops;
get() always returns null. Commands continue to work by parsing files directly.
</purpose>
<non-goals>
  <item>Do not implement any real caching — this is the fallback when SQLite is unavailable.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>The noop layer satisfies the port with zero storage — it is the default when caching is off.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0382: initial implementation — NoopCacheLayer fallback.</item>
  <item>ADR-0023: add close() no-op for CacheLayer interface parity.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type {
  CacheEntry,
  CacheEntryInfo,
  CacheLayer,
  CacheListFilter,
  CacheStatus,
} from "./cache-layer.ts";

export class NoopCacheLayer implements CacheLayer {
  readonly available = false;
  readonly unavailableReason: string;
  private readonly dbPath: string;

  constructor(dbPath: string, reason: string) {
    this.dbPath = dbPath;
    this.unavailableReason = reason;
  }

  async get(_namespace: string, _key: string): Promise<CacheEntry | null> {
    return null;
  }

  async set(
    _namespace: string,
    _key: string,
    _data: unknown,
    _mtime: number,
    _contentHash: string,
  ): Promise<void> {
    // no-op
  }

  async clear(_namespace?: string): Promise<void> {
    // no-op
  }

  async status(): Promise<CacheStatus> {
    return {
      available: false,
      unavailableReason: this.unavailableReason,
      dbPath: this.dbPath,
      dbSizeBytes: 0,
      namespaces: [],
    };
  }

  async close(): Promise<void> {
    // no-op — no resources to release
  }

  async list(_filter?: CacheListFilter): Promise<CacheEntryInfo[]> {
    return [];
  }
}
