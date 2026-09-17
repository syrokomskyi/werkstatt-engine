/*
<MODULE_CONTRACT>
<purpose>retention — certification artifact retention policy and protected reference tracking.</purpose>
<non-goals>
  <item>Do not delete artifacts — retention only decides what is protected.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { Sha256Digest } from "@warpgogol/werkstatt-shared/fingerprint";

export type ProtectedReference = "current" | "rollback-target" | "open-incident" | "audit-hold";

export interface RetentionPolicyInputV1 {
  compactAudit: "indefinite";
  certifiedFullDossierAfterSupersessionDays: number;
  unsuccessfulEvidenceDays: number;
  certifiedHeavyPayloadDays: number;
  unsuccessfulHeavyPayloadDays: number;
  protectedReferences: readonly ProtectedReference[];
}

export interface RetentionEntryV1 {
  payloadDigest: Sha256Digest;
  sizeBytes: number;
  mediaType: string;
  retentionPolicyHash: Sha256Digest;
  reason: string;
  deletedAt: string;
}

export interface RetentionTombstoneV1 {
  schema: "werkstatt/retention-tombstone@1";
  tombstoneId: string;
  payloadDigest: Sha256Digest;
  sizeBytes: number;
  mediaType: string;
  retentionPolicyHash: Sha256Digest;
  reason: string;
  tombstonedAt: string;
}

export interface RetentionGcCheckInputV1 {
  payloadDigest: Sha256Digest;
  policy: RetentionPolicyInputV1;
  protectedRefs: Set<ProtectedReference>;
  ageDays: number;
  isCertified: boolean;
}

export interface RetentionGcCheckResultV1 {
  canDelete: boolean;
  reason: string;
}

export function checkRetentionGc(input: RetentionGcCheckInputV1): RetentionGcCheckResultV1 {
  for (const ref of input.protectedRefs) {
    if (input.policy.protectedReferences.includes(ref)) {
      return {
        canDelete: false,
        reason: `payload is protected by reference "${ref}"`,
      };
    }
  }

  const maxDays = input.isCertified
    ? input.policy.certifiedHeavyPayloadDays
    : input.policy.unsuccessfulHeavyPayloadDays;

  if (input.ageDays < maxDays) {
    return {
      canDelete: false,
      reason: `payload age ${input.ageDays} days is below retention threshold ${maxDays} days`,
    };
  }

  return {
    canDelete: true,
    reason: `payload age ${input.ageDays} days exceeds retention threshold ${maxDays} days and no protected references`,
  };
}

export function createTombstone(
  entry: RetentionEntryV1,
  tombstoneId: string,
): RetentionTombstoneV1 {
  return {
    schema: "werkstatt/retention-tombstone@1",
    tombstoneId,
    payloadDigest: entry.payloadDigest,
    sizeBytes: entry.sizeBytes,
    mediaType: entry.mediaType,
    retentionPolicyHash: entry.retentionPolicyHash,
    reason: entry.reason,
    tombstonedAt: entry.deletedAt,
  };
}

export interface DurableReplicaVerifyInputV1 {
  adapterId: string;
  locator: string;
  verifiedRootHash: Sha256Digest;
  verifiedAt: string;
}

export interface DurableReplicaV1 {
  adapterId: string;
  locator: string;
  verifiedRootHash: Sha256Digest;
  verifiedAt: string;
}

export interface DurableReplicaVerifyResultV1 {
  ok: true;
  replica: DurableReplicaV1;
}

export interface DurableReplicaVerifyFailureV1 {
  ok: false;
  ruleId: "CERT-STORAGE-03";
  message: string;
}

export type DurableReplicaVerifyOutcomeV1 =
  DurableReplicaVerifyResultV1 | DurableReplicaVerifyFailureV1;

export function verifyDurableReplica(
  input: DurableReplicaVerifyInputV1,
  expectedRootHash: Sha256Digest,
): DurableReplicaVerifyOutcomeV1 {
  if (input.verifiedRootHash !== expectedRootHash) {
    return {
      ok: false,
      ruleId: "CERT-STORAGE-03",
      message: `durable replica root hash mismatch: expected ${expectedRootHash}, got ${input.verifiedRootHash}`,
    };
  }

  return {
    ok: true,
    replica: {
      adapterId: input.adapterId,
      locator: input.locator,
      verifiedRootHash: input.verifiedRootHash,
      verifiedAt: input.verifiedAt,
    },
  };
}
