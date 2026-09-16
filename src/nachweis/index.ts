/*
<MODULE_CONTRACT>
  <purpose>RFC-0707: Nachweis barrel — re-exports command handlers and I/O utilities. Module registration lives in nachweis.module.ts.</purpose>
  <non-goals>
    <item>Do not define createNachweisModule here — that lives in nachweis.module.ts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0874: add nachweis.measure.lighthouse handler and type exports.</item>
  <item>RFC-0875: add nachweis.measure.cloudflare-agent-readiness handler and type exports.</item>
  <item>RFC-0891: add nachweis.screenshot.process handler and NachweisScreenshotProcessResult type export.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <history>RFC-0707, RFC-0714, RFC-0873</history>
</CHANGE_SUMMARY>
*/

export {
  computeSourceSha256,
  generateRecordId,
  resolveNachweisR2Path,
  resolveNachweisPublicR2Path,
  uploadToR2,
  isMissingEnvError,
  resolveNachweisCachePath,
  readEntitledFeaturesFromCache,
  isNachweisEntitled,
  makeSkipResult,
  resolveNachweisPublicationPolicy,
  isConditionRequired,
  evaluateGateV2,
  validateAssessmentMetadata,
  type NachweisRecord,
  type NachweisIngestResult,
  type NachweisManifestEntry,
  type NachweisManifest,
  type NachweisPublicationGateV2,
  type NachweisGateConditionResult,
  type NachweisPublicationPolicyId,
  type GateStatus,
  type GateConditionId,
  type NachweisValidateResult,
  type NachweisViolation,
  type NachweisConsentUpdateResult,
  type NachweisPublishResult,
  type NachweisWithdrawResult,
  type NachweisApproveResult,
  type NachweisPublicDerivativeResult,
  type AssessmentBundleArtifact,
  type AssessmentBundleV1,
  type AssessmentIngestResult,
  type NachweisScreenshotProcessResult,
  assessmentBundleV1Schema,
  mediaTypeToExt,
  resolveAssessmentR2Path,
} from "./nachweis-io.ts";

export { runNachweisIngest } from "./nachweis-ingest.ts";
export { runNachweisValidate } from "./nachweis-validate.ts";
export { runNachweisManifestGenerate } from "./nachweis-manifest.ts";
export { runNachweisConsentUpdate } from "./nachweis-consent.ts";
export { runNachweisPublish } from "./nachweis-publish.ts";
export { runNachweisWithdraw } from "./nachweis-withdraw.ts";
export { runNachweisApprove } from "./nachweis-approve.ts";
export { runNachweisPublicDerivative } from "./nachweis-public-derivative.ts";
export { runNachweisAssessmentIngest } from "./nachweis-assessment-ingest.ts";
export { runNachweisLighthouseMeasure } from "./nachweis-lighthouse-measure.ts";
export { runNachweisCloudflareAgentReadinessMeasure } from "./nachweis-cloudflare-agent-readiness-measure.ts";
export { runNachweisScreenshotProcess } from "./nachweis-screenshot-process.ts";
export type {
  LighthouseCategoryProjection,
  LighthouseRunResult,
  LighthouseMeasureOptions,
  LighthouseMeasureResult,
} from "./nachweis-lighthouse-measure.ts";
export type { CloudflareAgentReadinessMeasureResult } from "./nachweis-cloudflare-agent-readiness-measure.ts";
export { createNachweisModule } from "./nachweis.module.ts";
