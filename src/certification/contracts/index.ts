/*
<MODULE_CONTRACT>
<purpose>certification contracts index — re-export the full certification contract surface.</purpose>
<non-goals>
  <item>Do not declare schemas here — contracts live in sibling modules.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export {
  digestSchema,
  schemaIdSchema,
  candidateIdSchema,
  evidenceIdSchema,
  decisionIdSchema,
  actionIdSchema,
  eventIdSchema,
  operationIdSchema,
  attemptIdSchema,
  authoritySequenceSchema,
  humanReadableIdSchema,
  utcTimestampSchema,
  gateChannelSchema,
  environmentSchema,
  certificationStatusSchema,
  safeSemanticPathSchema,
  safeLocatorSchema,
} from "./identifiers.ts";
export type {
  GateChannel,
  Environment,
  CertificationStatus,
} from "./identifiers.ts";

export {
  buildConfigV1Schema,
  deploymentPlanV1Schema,
  observedEnvironmentV1Schema,
  releaseCandidateV1Schema,
} from "./candidate.ts";
export type {
  BuildConfigV1,
  DeploymentPlanV1,
  ObservedEnvironmentV1,
  ReleaseCandidateV1,
} from "./candidate.ts";

export {
  producerManifestV1Schema,
  rubricManifestV1Schema,
  toolchainManifestV1Schema,
  issuerManifestV1Schema,
  resolvedRequirementV1Schema,
  certificationPolicyBundleV1Schema,
} from "./policy-bundle.ts";
export type {
  ProducerManifestV1,
  RubricManifestV1,
  ToolchainManifestV1,
  IssuerManifestV1,
  ResolvedRequirementV1,
  CertificationPolicyBundleV1,
} from "./policy-bundle.ts";

export {
  payloadDescriptorV1Schema,
  redactionReportV1Schema,
  attestationStatementV1Schema,
  authorityAdmissionV1Schema,
  evidenceResultV1Schema,
  evidenceEnvelopeV1Schema,
} from "./evidence.ts";
export type {
  PayloadDescriptorV1,
  RedactionReportV1,
  AttestationStatementV1,
  AuthorityAdmissionV1,
  EvidenceResultV1,
  EvidenceEnvelopeV1,
} from "./evidence.ts";

export {
  dossierEventKindSchema,
  dossierEventV1Schema,
  dossierManifestProjectionV1Schema,
  dossierIncidentV1Schema,
  dossierTombstoneV1Schema,
  dossierRootReferenceV1Schema,
} from "./dossier.ts";
export type {
  DossierEventKind,
  CertificationDossierEventV1,
  DossierManifestProjectionV1,
  DossierIncidentV1,
  DossierTombstoneV1,
  DossierRootReferenceV1,
} from "./dossier.ts";

export {
  coverageReportV1Schema,
  selectedEvidenceV1Schema,
  gateDecisionV1Schema,
  mainVerificationDecisionV1Schema,
  certificationHealthDecisionV1Schema,
} from "./decisions.ts";
export type {
  CoverageReportV1,
  SelectedEvidenceV1,
  GateDecisionV1,
  MainVerificationDecisionV1,
  CertificationHealthDecisionV1,
} from "./decisions.ts";

export {
  actionAnchorV1Schema,
  actionDependencyV1Schema,
  actionTaskV1Schema,
  certificationActionPackV1Schema,
} from "./action-pack.ts";
export type {
  ActionAnchorV1,
  ActionDependencyV1,
  ActionTaskV1,
  CertificationActionPackV1,
} from "./action-pack.ts";

export {
  issuerRegistryEntryV1Schema,
  attestationVerificationV1Schema,
  signedDecisionV1Schema,
  signedRootV1Schema,
  operationAuthorizationV1Schema,
  nonAuthoritativePreviewV1Schema,
} from "./authority.ts";
export type {
  IssuerRegistryEntryV1,
  AttestationVerificationV1,
  SignedDecisionV1,
  SignedRootV1,
  OperationAuthorizationV1,
  NonAuthoritativePreviewV1,
} from "./authority.ts";

export {
  artifactReadinessV1Schema,
  deploymentOperationStateV1Schema,
  deploymentOperationEventV1Schema,
} from "./state.ts";
export type {
  ArtifactReadinessV1,
  DeploymentOperationStateV1,
  DeploymentOperationEventV1,
} from "./state.ts";
