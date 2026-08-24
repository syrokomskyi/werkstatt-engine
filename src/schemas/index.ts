/*
<MODULE_CONTRACT>
<purpose>
Barrel export for @warpgogol/werkstatt-shared/ontology/operations sub-path.
Re-exports platform operations schemas: handoff, sternsystem, werkstatt,
mission, release, leitstand, notausgang, materialization, artifact-store,
naming-policy. These schemas have no relationship to UI structural vocabulary
and are consumed primarily by @warpgogol/site-kernel-handoff.
</purpose>
<non-goals>
  <item>Do not re-export UI ontology schemas (constellation, biome, page-entry, etc.) — those live in @warpgogol/werkstatt-shared/ontology/schemas.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Architecture review 2026-07-10: extracted from schemas/index.ts to separate platform operations from UI ontology.</item>
</CHANGE_SUMMARY>
*/

// RFC-0221: site handoff bundle (lock + authored/derived manifest).
export {
  handoffCapabilitySchema,
  handoffEcosystemSchema,
  handoffBuildSchema,
  handoffLockSchema,
  handoffManifestEntrySchema,
  handoffManifestSchema,
} from "./handoff.ts";
export type {
  HandoffCapability,
  HandoffEcosystem,
  HandoffBuild,
  HandoffLock,
  HandoffManifestEntry,
  HandoffManifest,
} from "./handoff.ts";

// RFC-0354: Sternsystem bundle contract schemas.
export {
  systemPinSchema,
  mirrorStorageTypeSchema,
  mirrorEntrySchema,
  serviceSubdomainSchema,
  serviceEntrySchema,
  systemConfigSchema,
  systemStateSchema,
  servicesRegistrySchema,
} from "./sternsystem.ts";
export type {
  SystemPin,
  MirrorStorageType,
  MirrorEntry,
  ServiceSubdomain,
  ServiceEntry,
  SystemConfig,
  SystemState,
  ServicesRegistry,
} from "./sternsystem.ts";

// RFC-0362: Werkstatt consistency primitive schemas.
export { werkstattLockSchema, werkstattOperationRecordSchema } from "./werkstatt.ts";
export type { WerkstattLock, WerkstattOperationRecord } from "./werkstatt.ts";

// RFC-0355: Mission lifecycle and Bordbuch schemas.
export {
  missionStateSchema,
  missionManifestSchema,
  bordbuchEntryKindSchema,
  bordbuchEntryStatusSchema,
  bordbuchEntrySchema,
} from "./mission.ts";
export type {
  MissionState,
  MissionManifest,
  BordbuchEntryKind,
  BordbuchEntryStatus,
  BordbuchEntry,
} from "./mission.ts";

// RFC-0361: Centralized naming policy regexes and descriptors.
export {
  STERNSYSTEM_ID_REGEX,
  MISSION_ID_REGEX,
  RELEASE_ID_REGEX,
  BORDBUCH_EVENT_ID_REGEX,
  NON_ASCII_REGEX,
  STERNSYSTEM_ID_POLICY,
  MISSION_ID_POLICY,
  RELEASE_ID_POLICY,
  BORDBUCH_EVENT_ID_POLICY,
  isLatinOnly,
} from "./naming-policy.ts";

// RFC-0356: Materialization report schemas.
export {
  materializationReportSchema,
  validationReportSchema,
  authoredDiffSchema,
} from "./materialization.ts";
export type { MaterializationReport, ValidationReport, AuthoredDiff } from "./materialization.ts";

// RFC-0363: Release artifact store schemas.
export { releaseArtifactManifestSchema, releaseArtifactRefSchema } from "./artifact-store.ts";
export type { ReleaseArtifactManifest, ReleaseArtifactRef } from "./artifact-store.ts";

// RFC-0357/RFC-0851: Release discipline and behavior snapshot schemas.
export {
  releaseArtifactStateSchema,
  releaseStateSchema,
  legacyReleaseStateSchema,
  legacyReleaseDiagnosticSchema,
  releaseManifestSchema,
  releaseArtifactRefSchema as releaseArtifactRefSchemaV2,
  behaviorSnapshotDifferenceSchema,
  behaviorSnapshotDiffSchema,
  buildIdentitySchema,
} from "./release.ts";
export type {
  ReleaseArtifactState,
  ReleaseState,
  LegacyReleaseState,
  LegacyReleaseDiagnostic,
  ReleaseManifest,
  BuildIdentity,
  BehaviorSnapshotDifference,
  BehaviorSnapshotDiff,
} from "./release.ts";

// RFC-0358/RFC-0379: Leitstand fleet propagation schemas.
export {
  deploymentAdapterNameSchema,
  deploymentChannelSchema,
  lastPropagatedChannelSchema,
  purgeResultSchema,
  deploymentStaticConfigSchema,
  healthCheckSchema,
  propagationResultSchema,
  routeFactSchema,
} from "./leitstand.ts";
export type {
  DeploymentAdapterName,
  DeploymentChannel,
  LastPropagatedChannel,
  PurgeResult,
  DeploymentStaticConfig,
  HealthCheck,
  PropagationResult,
  RouteFact,
} from "./leitstand.ts";

// RFC-0359: Notausgang export schemas.
export {
  integrationSecretLocationSchema,
  integrationManifestSchema,
  integrationNullingSchema,
  notausgangManifestSchema,
} from "./notausgang.ts";
export type {
  IntegrationSecretLocation,
  IntegrationManifest,
  IntegrationNulling,
  NotausgangManifest,
} from "./notausgang.ts";

// RFC-0852: Engine-owned canonical Diagnostic schemas.
export {
  diagnosticSeveritySchema,
  diagnosticEvidenceSchema,
  diagnosticSchema,
  diagnosticRuleIdSchema,
  safeWorkspaceRelativePathSchema,
  safeDiagnosticUrlSchema,
  DIAGNOSTIC_LIMITS,
} from "./diagnostic.ts";
export type { DiagnosticSeverity, DiagnosticEvidence, Diagnostic } from "./diagnostic.ts";

// RFC-0565: DHT site registry and content placement schemas.
export {
  dhtSiteEntrySchema,
  dhtConfigSchema,
  dhtLookupResultSchema,
  dhtPlacementReasonSchema,
  workshopCapacitySchema,
  dhtPlacementResultSchema,
  dhtCacheEntrySchema,
} from "./dht.ts";
export type {
  DHTSiteEntry,
  DHTConfig,
  DHTLookupResult,
  DHTPlacementReason,
  WorkshopCapacity,
  DHTPlacementResult,
  DHTCacheEntry,
} from "./dht.ts";
