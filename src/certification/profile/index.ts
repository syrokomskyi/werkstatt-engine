/*
<MODULE_CONTRACT>
<purpose>certification profile index — re-export the profile schemas and validation surface.</purpose>
<non-goals>
  <item>Do not implement profile logic here — it lives in sibling modules.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export type {
  SiteQualityDimension,
  CertificationGate,
  RequirementClass,
  RemediationClass,
  DriftAction,
  OwnerRole,
  ProducerKind,
  VersionSource,
  Criticality,
  ApplicabilityRuleV1,
  FreshnessV1,
  ExecutionV1,
  RemediationV1,
  ReuseV1,
  CertificationRequirementV1,
  ProducerDeclarationV1,
  EvaluatorPolicyV1,
  RetentionPolicyV1,
  CertificationProfileV1,
  ProfileSourceRefV1,
} from "./schemas.ts";

export {
  siteQualityDimensionSchema,
  certificationGateSchema,
  requirementClassSchema,
  remediationClassSchema,
  driftActionSchema,
  ownerRoleSchema,
  producerKindSchema,
  versionSourceSchema,
  criticalitySchema,
  applicabilityRuleV1Schema,
  freshnessV1Schema,
  executionV1Schema,
  remediationV1Schema,
  reuseV1Schema,
  certificationRequirementV1Schema,
  producerDeclarationV1Schema,
  evaluatorPolicyV1Schema,
  retentionPolicyV1Schema,
  certificationProfileV1Schema,
  profileSourceRefV1Schema,
} from "./schemas.ts";

export type { ProfileHashResultV1, ProfileHashFailureV1, ProfileHashOutcomeV1 } from "./hash.ts";

export { hashCertificationProfileV1 } from "./hash.ts";

export type {
  ProfileValidationDiagnostic,
  ProfileValidationResultV1,
  ProfileValidationContextV1,
} from "./validate.ts";

export { validateCertificationProfileV1 } from "./validate.ts";

export { astroCertificationProfile } from "./astro-profile.ts";
