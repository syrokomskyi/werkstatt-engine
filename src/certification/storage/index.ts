/*
<MODULE_CONTRACT>
<purpose>certification storage index — re-export the storage adapter and repository surface.</purpose>
<non-goals>
  <item>Do not implement storage here — it lives in sibling modules.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export type {
  StoragePutInputV1,
  StoragePutResultV1,
  StorageHeadResultV1,
  CertificationStorageAdapterV1,
  InMemoryStorageAdapterV1,
  StorageVerifyResultV1,
  StorageVerifyFailureV1,
  StorageVerifyOutcomeV1,
} from "./adapter.ts";

export { createInMemoryStorageAdapter, verifyStoredObject } from "./adapter.ts";

export type { R2StorageConfig } from "./r2-adapter.ts";
export { createR2StorageAdapter } from "./r2-adapter.ts";

export type {
  DossierRepositoryV1,
  DossierAppendInputV1,
  DossierAppendResultV1,
  DossierAppendFailureV1,
  DossierAppendOutcomeV1,
  DossierIntegrityVerifyResultV1,
  DossierIntegrityVerifyFailureV1,
  DossierIntegrityVerifyOutcomeV1,
} from "./repository.ts";

export {
  createDossierRepository,
  appendDossierEvent,
  rebuildRootHash,
  buildRootReference,
  verifyDossierIntegrity,
} from "./repository.ts";

export type {
  ProtectedReference,
  RetentionPolicyInputV1,
  RetentionEntryV1,
  RetentionTombstoneV1,
  RetentionGcCheckInputV1,
  RetentionGcCheckResultV1,
  DurableReplicaVerifyInputV1,
  DurableReplicaV1,
  DurableReplicaVerifyResultV1,
  DurableReplicaVerifyFailureV1,
  DurableReplicaVerifyOutcomeV1,
} from "./retention.ts";

export { checkRetentionGc, createTombstone, verifyDurableReplica } from "./retention.ts";
