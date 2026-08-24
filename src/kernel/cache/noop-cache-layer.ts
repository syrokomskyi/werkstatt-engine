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
<CHANGE_SUMMARY>
  <item>RFC-0382: initial implementation — NoopCacheLayer fallback.</item>
  <item>ADR-0023: add close() no-op for CacheLayer interface parity.</item>
</CHANGE_SUMMARY>
*/

import type { CacheEntry, CacheLayer, CacheStatus } from "./cache-layer.ts";

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
}
