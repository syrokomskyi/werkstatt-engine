/*
<MODULE_CONTRACT>
<purpose>
RFC-1037: Persistent compensation evidence store using better-sqlite3.
Stores CompensationResult records keyed by operationHash so that compensation
evidence survives process restarts and can be re-verified later.
</purpose>
<non-goals>
  <item>Does not implement probe execution — that lives in compensation-verifier.ts.</item>
  <item>Does not implement Bordbuch recording — callers record Bordbuch entries separately.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1037: initial implementation — CompensationStore with SQLite-backed persistence.</item>
</CHANGE_SUMMARY>
*/

import { mkdirSync, existsSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

import type { CompensationResult, ProbeResult } from "../component/contracts.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";
import { isSha256Digest } from "../fingerprint/primitives.ts";

const require_ = createRequire(import.meta.url);

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS compensation_results (
  operation_hash TEXT PRIMARY KEY,
  compensation_hash TEXT NOT NULL,
  verified INTEGER NOT NULL,
  probe_results TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  failure_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_compensation_verified
  ON compensation_results(verified);
`;

interface CompensationRow {
  operation_hash: string;
  compensation_hash: string;
  verified: number;
  probe_results: string;
  verified_at: string;
  failure_reason: string | null;
}

export class CompensationStore {
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
        console.warn(`compensation-evidence DB was corrupt and has been recreated: ${err.message}`);
      }
    }
  }

  save(result: CompensationResult): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO compensation_results
        (operation_hash, compensation_hash, verified, probe_results, verified_at, failure_reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      result.operationHash,
      result.compensationHash,
      result.verified ? 1 : 0,
      JSON.stringify(result.probeResults),
      result.verifiedAt,
      result.failureReason ?? null,
    );
  }

  get(operationHash: Sha256Digest): CompensationResult | null {
    const row = this.db
      .prepare<[string]>("SELECT * FROM compensation_results WHERE operation_hash = ?")
      .get(operationHash) as CompensationRow | undefined;

    if (!row) {
      return null;
    }

    return deserializeRow(row);
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore close errors
    }
  }
}

function deserializeRow(row: CompensationRow): CompensationResult {
  const probeResults = JSON.parse(row.probe_results) as ProbeResult[];
  const operationHash = row.operation_hash as Sha256Digest;
  const compensationHash = row.compensation_hash as Sha256Digest;

  return {
    operationHash,
    compensationHash,
    verified: row.verified === 1,
    probeResults,
    verifiedAt: row.verified_at,
    failureReason: row.failure_reason ?? undefined,
  };
}

export function resolveCompensationStorePath(missionsDir: string, missionId: string): string {
  return `${missionsDir}/${missionId}/compensation-evidence.db`;
}
