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
