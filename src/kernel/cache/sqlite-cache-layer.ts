/*
<MODULE_CONTRACT>
<purpose>
RFC-0382: SQLite-backed cache layer using better-sqlite3. Provides persistent,
file-backed caching with WAL mode and busy timeout for concurrent access.
Self-healing: corrupt DB is deleted and recreated on open error.
</purpose>
<non-goals>
  <item>Do not implement RFC-specific cache helpers — that lives in rfc-cache.ts.</item>
  <item>Do not handle cache invalidation logic — callers check mtime + contentHash.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0382: initial implementation — SqliteCacheLayer with WAL mode, busy timeout, self-healing.</item>
  <item>RFC-0382 post-review: remove staleEntries placeholder from status() output.</item>
  <item>ADR-0023: add close() method for explicit SQLite connection cleanup after pipeline completion.</item>
</CHANGE_SUMMARY>
*/

import { existsSync, statSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

import type { CacheEntry, CacheLayer, CacheNamespaceStatus, CacheStatus } from "./cache-layer.ts";

const require_ = createRequire(import.meta.url);

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS cache_entries (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  data TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, key)
);

CREATE TABLE IF NOT EXISTS cache_stats (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (namespace, key)
);
`;

interface CacheRow {
  data: string;
  mtime: number;
  content_hash: string;
  schema_version: number;
  updated_at: number;
}

interface NamespaceCountRow {
  namespace: string;
  entries: number;
}

interface StatsAggregateRow {
  total_hits: number | null;
  total_misses: number | null;
}

export class SqliteCacheLayer implements CacheLayer {
  readonly available = true;
  readonly unavailableReason: undefined;
  private readonly dbPath: string;
  private db: import("better-sqlite3").Database;

  constructor(dbPath: string) {
    this.dbPath = dbPath;

    try {
      const BetterSqlite3 = require_("better-sqlite3") as typeof import("better-sqlite3");
      mkdirSync(dirname(dbPath), { recursive: true });
      this.db = new BetterSqlite3(dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("busy_timeout = 5000");
      this.db.exec(SCHEMA_DDL);
    } catch (err) {
      // Self-healing: delete corrupt DB and retry once
      if (existsSync(dbPath)) {
        try {
          unlinkSync(dbPath);
        } catch {
          // ignore unlink errors
        }
      }
      const BetterSqlite3 = require_("better-sqlite3") as typeof import("better-sqlite3");
      mkdirSync(dirname(dbPath), { recursive: true });
      this.db = new BetterSqlite3(dbPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("busy_timeout = 5000");
      this.db.exec(SCHEMA_DDL);
      if (err instanceof Error) {
        // pipeline-log-ok: self-healing corrupt cache DB — operational runtime warning, not a pipeline diagnostic
        console.warn(`cache DB was corrupt and has been recreated: ${err.message}`);
      }
    }
  }

  async get(namespace: string, key: string): Promise<CacheEntry | null> {
    const row = this.db
      .prepare<[string, string]>(
        "SELECT data, mtime, content_hash, schema_version, updated_at FROM cache_entries WHERE namespace = ? AND key = ?",
      )
      .get(namespace, key) as CacheRow | undefined;

    if (!row) {
      this.incrementMiss(namespace, key);
      return null;
    }

    this.incrementHit(namespace, key);
    return {
      key,
      data: JSON.parse(row.data),
      mtime: row.mtime,
      contentHash: row.content_hash,
      updatedAt: row.updated_at,
    };
  }

  async set(
    namespace: string,
    key: string,
    data: unknown,
    mtime: number,
    contentHash: string,
  ): Promise<void> {
    const dataJson = JSON.stringify(data);
    const now = Date.now();
    this.db
      .prepare<[string, string, string, number, string, number]>(
        `INSERT INTO cache_entries (namespace, key, data, mtime, content_hash, schema_version, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET
           data = excluded.data,
           mtime = excluded.mtime,
           content_hash = excluded.content_hash,
           schema_version = excluded.schema_version,
           updated_at = excluded.updated_at`,
      )
      .run(namespace, key, dataJson, mtime, contentHash, now);
  }

  async clear(namespace?: string): Promise<void> {
    if (namespace) {
      this.db.prepare("DELETE FROM cache_entries WHERE namespace = ?").run(namespace);
      this.db.prepare("DELETE FROM cache_stats WHERE namespace = ?").run(namespace);
    } else {
      this.db.exec("DELETE FROM cache_entries");
      this.db.exec("DELETE FROM cache_stats");
    }
  }

  async status(): Promise<CacheStatus> {
    let dbSizeBytes = 0;
    try {
      dbSizeBytes = statSync(this.dbPath).size;
    } catch {
      dbSizeBytes = 0;
    }

    const namespaceRows = this.db
      .prepare<[]>("SELECT namespace, COUNT(*) as entries FROM cache_entries GROUP BY namespace")
      .all() as NamespaceCountRow[];

    const namespaces: CacheNamespaceStatus[] = [];

    for (const ns of namespaceRows) {
      const statsRow = this.db
        .prepare<[string]>(
          "SELECT COALESCE(SUM(hits), 0) as total_hits, COALESCE(SUM(misses), 0) as total_misses FROM cache_stats WHERE namespace = ?",
        )
        .get(ns.namespace) as StatsAggregateRow;

      const totalHits = statsRow?.total_hits ?? 0;
      const totalMisses = statsRow?.total_misses ?? 0;
      const total = totalHits + totalMisses;
      const hitRatio = total > 0 ? totalHits / total : 0;

      namespaces.push({
        name: ns.namespace,
        entries: ns.entries,
        hitRatio,
      });
    }

    return {
      available: true,
      dbPath: this.dbPath,
      dbSizeBytes,
      namespaces,
    };
  }

  private incrementHit(namespace: string, key: string): void {
    this.db
      .prepare<[string, string]>(
        `INSERT INTO cache_stats (namespace, key, hits, misses) VALUES (?, ?, 1, 0)
         ON CONFLICT(namespace, key) DO UPDATE SET hits = hits + 1`,
      )
      .run(namespace, key);
  }

  private incrementMiss(namespace: string, key: string): void {
    this.db
      .prepare<[string, string]>(
        `INSERT INTO cache_stats (namespace, key, hits, misses) VALUES (?, ?, 0, 1)
         ON CONFLICT(namespace, key) DO UPDATE SET misses = misses + 1`,
      )
      .run(namespace, key);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
