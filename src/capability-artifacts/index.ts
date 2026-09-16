/*
<MODULE_CONTRACT>
<purpose>capability-artifacts index — re-export the capability artifact store public surface.</purpose>
<non-goals>
  <item>Do not implement store logic here — the store lives in store.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export type {
  ArtifactProvenanceV1,
  CapabilityArtifactV1,
  ArtifactPublishRequestV1,
  ArtifactPublishResultV1,
  ArtifactPublishFailureV1,
  ArtifactPublishOutcomeV1,
  ArtifactStoreV1,
  ArtifactVerifyResultV1,
  ArtifactVerifyFailureV1,
  ArtifactVerifyOutcomeV1,
  SandboxProviderAdmissionV1,
  ProviderAdmissionStoreV1,
  ProviderAdmitResultV1,
  ProviderAdmitFailureV1,
  ProviderAdmitOutcomeV1,
  CapabilityInvocationV1,
} from "./store.ts";

export {
  createInMemoryArtifactStore,
  createProviderAdmissionStore,
} from "./store.ts";
