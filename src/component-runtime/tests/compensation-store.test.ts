import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CompensationStore, resolveCompensationStorePath } from "../compensation-store.ts";
import type { CompensationResult } from "../../component/contracts.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";

const VALID_HASH = `sha256:${"a".repeat(64)}` as Sha256Digest;

describe("CompensationStore", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: CompensationStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(process.cwd(), "tmp-comp-store-"));
    dbPath = join(tmpDir, "compensation-evidence.db");
    store = new CompensationStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the database file on construction", () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it("returns null for non-existent operation hash", () => {
    const result = store.get(VALID_HASH);
    expect(result).toBeNull();
  });

  it("saves and retrieves a verified compensation result", () => {
    const result: CompensationResult = {
      operationHash: VALID_HASH,
      compensationHash: `sha256:${"b".repeat(64)}` as Sha256Digest,
      verified: true,
      probeResults: [
        {
          probe: {
            type: "http-status",
            target: "https://example.com",
            expected: "200",
            timeoutMs: 5000,
          },
          passed: true,
          actualValue: "200",
          latencyMs: 42,
        },
      ],
      verifiedAt: "2026-09-01T00:00:00.000Z",
    };

    store.save(result);
    const retrieved = store.get(VALID_HASH);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.operationHash).toBe(VALID_HASH);
    expect(retrieved!.verified).toBe(true);
    expect(retrieved!.probeResults).toHaveLength(1);
    expect(retrieved!.probeResults[0].passed).toBe(true);
    expect(retrieved!.probeResults[0].actualValue).toBe("200");
  });

  it("saves and retrieves a failed compensation result with failureReason", () => {
    const result: CompensationResult = {
      operationHash: VALID_HASH,
      compensationHash: `sha256:${"b".repeat(64)}` as Sha256Digest,
      verified: false,
      probeResults: [
        {
          probe: {
            type: "dns-resolved",
            target: "dev.example.com",
            expected: "1.2.3.4",
            timeoutMs: 5000,
          },
          passed: false,
          actualValue: "5.6.7.8",
          latencyMs: 10,
        },
      ],
      verifiedAt: "2026-09-01T00:00:00.000Z",
      failureReason: "1 probe(s) failed",
    };

    store.save(result);
    const retrieved = store.get(VALID_HASH);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.verified).toBe(false);
    expect(retrieved!.failureReason).toBe("1 probe(s) failed");
  });

  it("overwrites existing result on re-save (INSERT OR REPLACE)", () => {
    const result1: CompensationResult = {
      operationHash: VALID_HASH,
      compensationHash: `sha256:${"b".repeat(64)}` as Sha256Digest,
      verified: false,
      probeResults: [],
      verifiedAt: "2026-09-01T00:00:00.000Z",
      failureReason: "initial failure",
    };

    store.save(result1);

    const result2: CompensationResult = {
      operationHash: VALID_HASH,
      compensationHash: `sha256:${"b".repeat(64)}` as Sha256Digest,
      verified: true,
      probeResults: [],
      verifiedAt: "2026-09-01T01:00:00.000Z",
    };

    store.save(result2);
    const retrieved = store.get(VALID_HASH);

    expect(retrieved!.verified).toBe(true);
    expect(retrieved!.failureReason).toBeUndefined();
  });

  it("resolveCompensationStorePath builds correct path", () => {
    const path = resolveCompensationStorePath("/missions", "m000001");
    expect(path).toBe("/missions/m000001/compensation-evidence.db");
  });
});
