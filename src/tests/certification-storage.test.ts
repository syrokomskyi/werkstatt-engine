import { describe, it, expect } from "vitest";
import {
  createInMemoryStorageAdapter,
  verifyStoredObject,
  createDossierRepository,
  appendDossierEvent,
  rebuildRootHash,
  buildRootReference,
  verifyDossierIntegrity,
  checkRetentionGc,
  createTombstone,
  verifyDurableReplica,
} from "../certification/storage/index.ts";
import type { CertificationDossierEventV1 } from "../certification/contracts/dossier.ts";
import type { Sha256Digest } from "../fingerprint/primitives.ts";

const DIGEST_A = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Sha256Digest;
const DIGEST_B = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Sha256Digest;
const DIGEST_C = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Sha256Digest;

function mkEvent(
  candidateId: string,
  seq: number,
  prevHash: Sha256Digest | null,
  payloadRef: Sha256Digest,
): CertificationDossierEventV1 {
  return {
    schema: "werkstatt/dossier-event@1",
    eventId: `evt-${seq}`,
    eventKind: "evidence-admitted",
    candidateId,
    authoritySequence: seq,
    previousEventHash: prevHash,
    eventPayloadRef: payloadRef,
    recordedAt: "2026-01-01T00:00:00Z",
  };
}

describe("createInMemoryStorageAdapter", () => {
  it("stores and retrieves objects", async () => {
    const adapter = createInMemoryStorageAdapter("test");
    const bytes = new Uint8Array([1, 2, 3]);
    const putResult = await adapter.putObject({
      digest: DIGEST_A,
      bytes,
      mediaType: "application/octet-stream",
    });
    expect(putResult.sizeBytes).toBe(3);

    const headResult = await adapter.headObject(DIGEST_A);
    expect(headResult.exists).toBe(true);
    expect(headResult.sizeBytes).toBe(3);

    const retrieved = await adapter.getObject(DIGEST_A);
    expect(retrieved).toEqual(bytes);
  });

  it("returns exists=false for missing objects", async () => {
    const adapter = createInMemoryStorageAdapter("test");
    const head = await adapter.headObject(DIGEST_B);
    expect(head.exists).toBe(false);
  });

  it("throws on getObject for missing objects", async () => {
    const adapter = createInMemoryStorageAdapter("test");
    await expect(adapter.getObject(DIGEST_B)).rejects.toThrow();
  });

  it("appends audit records", async () => {
    const adapter = createInMemoryStorageAdapter("test");
    const record = new Uint8Array([10, 20]);
    const result = await adapter.appendAuditRecord(record);
    expect(result.locator).toContain("audit");
    expect(adapter._auditRecords.length).toBe(1);
  });

  it("putObject is idempotent", async () => {
    const adapter = createInMemoryStorageAdapter("test");
    const bytes = new Uint8Array([1, 2, 3]);
    await adapter.putObject({ digest: DIGEST_A, bytes, mediaType: "application/octet-stream" });
    await adapter.putObject({ digest: DIGEST_A, bytes, mediaType: "application/octet-stream" });
    expect(adapter._objects.size).toBe(1);
  });
});

describe("verifyStoredObject", () => {
  it("verifies a stored object", async () => {
    const adapter = createInMemoryStorageAdapter("test");
    await adapter.putObject({
      digest: DIGEST_A,
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "application/octet-stream",
    });
    const result = await verifyStoredObject(adapter, DIGEST_A, 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.verified).toBe(true);
      expect(result.sizeBytes).toBe(3);
    }
  });

  it("fails for missing object", async () => {
    const adapter = createInMemoryStorageAdapter("test");
    const result = await verifyStoredObject(adapter, DIGEST_B);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-STORAGE-01");
    }
  });

  it("fails on size mismatch", async () => {
    const adapter = createInMemoryStorageAdapter("test");
    await adapter.putObject({
      digest: DIGEST_A,
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "application/octet-stream",
    });
    const result = await verifyStoredObject(adapter, DIGEST_A, 99);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-STORAGE-02");
    }
  });
});

describe("createDossierRepository + appendDossierEvent", () => {
  it("creates an empty repository", () => {
    const repo = createDossierRepository("cand-001");
    expect(repo.events.length).toBe(0);
    expect(repo.rootHash).toBeNull();
  });

  it("appends events and computes root hash", () => {
    const repo = createDossierRepository("cand-001");
    const event = mkEvent("cand-001", 1, null, DIGEST_A);
    const result = appendDossierEvent(repo, { event });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repository.events.length).toBe(1);
      expect(result.repository.rootHash).not.toBeNull();
      expect(result.newRootHash).toBe(result.repository.rootHash);
    }
  });

  it("rejects event with wrong candidateId", () => {
    const repo = createDossierRepository("cand-001");
    const event = mkEvent("cand-002", 1, null, DIGEST_A);
    const result = appendDossierEvent(repo, { event });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DOSSIER-01");
    }
  });

  it("rejects event with wrong previousEventHash", () => {
    const repo = createDossierRepository("cand-001");
    const event = mkEvent("cand-001", 1, DIGEST_B, DIGEST_A);
    const result = appendDossierEvent(repo, { event });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-DOSSIER-02");
    }
  });

  it("chains events correctly", () => {
    let repo = createDossierRepository("cand-001");
    const event1 = mkEvent("cand-001", 1, null, DIGEST_A);
    const r1 = appendDossierEvent(repo, { event: event1 });
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      repo = r1.repository;
      const event2 = mkEvent("cand-001", 2, r1.eventHash, DIGEST_B);
      const r2 = appendDossierEvent(repo, { event: event2 });
      expect(r2.ok).toBe(true);
      if (r2.ok) {
        expect(r2.repository.events.length).toBe(2);
        expect(r2.repository.rootHash).not.toBe(r1.newRootHash);
      }
    }
  });

  it("root hash is location-independent (same events = same root)", () => {
    let repo1 = createDossierRepository("cand-001");
    let repo2 = createDossierRepository("cand-001");

    const event1 = mkEvent("cand-001", 1, null, DIGEST_A);
    const r1a = appendDossierEvent(repo1, { event: event1 });
    const r1b = appendDossierEvent(repo2, { event: event1 });
    if (r1a.ok && r1b.ok) {
      repo1 = r1a.repository;
      repo2 = r1b.repository;
      expect(r1a.newRootHash).toBe(r1b.newRootHash);

      const event2 = mkEvent("cand-001", 2, r1a.eventHash, DIGEST_B);
      const r2a = appendDossierEvent(repo1, { event: event2 });
      const r2b = appendDossierEvent(repo2, { event: event2 });
      if (r2a.ok && r2b.ok) {
        expect(r2a.newRootHash).toBe(r2b.newRootHash);
      }
    }
  });
});

describe("rebuildRootHash", () => {
  it("recomputes root from event hashes", () => {
    let repo = createDossierRepository("cand-001");
    const event = mkEvent("cand-001", 1, null, DIGEST_A);
    const r = appendDossierEvent(repo, { event });
    if (r.ok) {
      repo = r.repository;
      const rebuilt = rebuildRootHash(repo);
      expect(rebuilt).toBe(repo.rootHash);
    }
  });
});

describe("buildRootReference", () => {
  it("builds a root reference from the repository", () => {
    let repo = createDossierRepository("cand-001");
    const event = mkEvent("cand-001", 1, null, DIGEST_A);
    const r = appendDossierEvent(repo, { event });
    if (r.ok) {
      repo = r.repository;
      const ref = buildRootReference(repo);
      expect(ref.schema).toBe("werkstatt/dossier-root-reference@1");
      expect(ref.candidateId).toBe("cand-001");
      expect(ref.eventCount).toBe(1);
      expect(ref.rootHash).toBe(repo.rootHash);
    }
  });
});

describe("verifyDossierIntegrity", () => {
  it("verifies a valid chain", () => {
    let repo = createDossierRepository("cand-001");
    const event1 = mkEvent("cand-001", 1, null, DIGEST_A);
    const r1 = appendDossierEvent(repo, { event: event1 });
    if (r1.ok) {
      repo = r1.repository;
      const event2 = mkEvent("cand-001", 2, r1.eventHash, DIGEST_B);
      const r2 = appendDossierEvent(repo, { event: event2 });
      if (r2.ok) {
        repo = r2.repository;
        const verify = verifyDossierIntegrity(repo);
        expect(verify.ok).toBe(true);
        if (verify.ok) {
          expect(verify.valid).toBe(true);
          expect(verify.recomputedRootHash).toBe(repo.rootHash);
        }
      }
    }
  });

  it("detects chain break", () => {
    let repo = createDossierRepository("cand-001");
    const event1 = mkEvent("cand-001", 1, null, DIGEST_A);
    const r1 = appendDossierEvent(repo, { event: event1 });
    if (r1.ok) {
      repo = r1.repository;
      const tamperedEvent: CertificationDossierEventV1 = {
        ...mkEvent("cand-001", 2, r1.eventHash, DIGEST_B),
        previousEventHash: DIGEST_C,
      };
      const tamperedRepo = {
        ...repo,
        events: [...repo.events, tamperedEvent],
        eventHashes: [...repo.eventHashes, DIGEST_C],
      };
      const verify = verifyDossierIntegrity(tamperedRepo);
      expect(verify.ok).toBe(false);
      if (!verify.ok) {
        expect(verify.ruleId).toBe("CERT-DOSSIER-04");
      }
    }
  });
});

describe("checkRetentionGc", () => {
  const policy = {
    compactAudit: "indefinite" as const,
    certifiedFullDossierAfterSupersessionDays: 730,
    unsuccessfulEvidenceDays: 180,
    certifiedHeavyPayloadDays: 365,
    unsuccessfulHeavyPayloadDays: 90,
    protectedReferences: ["current", "rollback-target", "open-incident", "audit-hold"] as const,
  };

  it("blocks deletion when protected by current reference", () => {
    const result = checkRetentionGc({
      payloadDigest: DIGEST_A,
      policy,
      protectedRefs: new Set(["current"]),
      ageDays: 999,
      isCertified: true,
    });
    expect(result.canDelete).toBe(false);
    expect(result.reason).toContain("protected");
  });

  it("blocks deletion when age is below threshold", () => {
    const result = checkRetentionGc({
      payloadDigest: DIGEST_A,
      policy,
      protectedRefs: new Set(),
      ageDays: 10,
      isCertified: true,
    });
    expect(result.canDelete).toBe(false);
    expect(result.reason).toContain("below retention threshold");
  });

  it("allows deletion when age exceeds threshold and no protection", () => {
    const result = checkRetentionGc({
      payloadDigest: DIGEST_A,
      policy,
      protectedRefs: new Set(),
      ageDays: 400,
      isCertified: true,
    });
    expect(result.canDelete).toBe(true);
  });

  it("uses unsuccessful threshold for non-certified payloads", () => {
    const result = checkRetentionGc({
      payloadDigest: DIGEST_A,
      policy,
      protectedRefs: new Set(),
      ageDays: 91,
      isCertified: false,
    });
    expect(result.canDelete).toBe(true);
  });

  it("blocks non-certified payload below unsuccessful threshold", () => {
    const result = checkRetentionGc({
      payloadDigest: DIGEST_A,
      policy,
      protectedRefs: new Set(),
      ageDays: 89,
      isCertified: false,
    });
    expect(result.canDelete).toBe(false);
  });
});

describe("createTombstone", () => {
  it("creates a tombstone from a retention entry", () => {
    const entry = {
      payloadDigest: DIGEST_A,
      sizeBytes: 1024,
      mediaType: "application/octet-stream",
      retentionPolicyHash: DIGEST_B,
      reason: "retention expired",
      deletedAt: "2026-01-01T00:00:00Z",
    };
    const tombstone = createTombstone(entry, "tomb-001");
    expect(tombstone.schema).toBe("werkstatt/retention-tombstone@1");
    expect(tombstone.tombstoneId).toBe("tomb-001");
    expect(tombstone.payloadDigest).toBe(DIGEST_A);
    expect(tombstone.reason).toBe("retention expired");
  });
});

describe("verifyDurableReplica", () => {
  it("succeeds when root hash matches", () => {
    const result = verifyDurableReplica(
      {
        adapterId: "r2-adapter",
        locator: "r2://bucket/dossier.json",
        verifiedRootHash: DIGEST_A,
        verifiedAt: "2026-01-01T00:00:00Z",
      },
      DIGEST_A,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.replica.adapterId).toBe("r2-adapter");
    }
  });

  it("fails when root hash does not match", () => {
    const result = verifyDurableReplica(
      {
        adapterId: "r2-adapter",
        locator: "r2://bucket/dossier.json",
        verifiedRootHash: DIGEST_B,
        verifiedAt: "2026-01-01T00:00:00Z",
      },
      DIGEST_A,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-STORAGE-03");
    }
  });
});
