/*
<MODULE_CONTRACT>
<purpose>certification producers index — re-export the producer registry public surface.</purpose>
<non-goals>
  <item>Do not implement producers here — they live in the registry.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export type {
  ProducerKind,
  ProducerContextV1,
  ProducerResultV1,
  ApplicabilityResultV1,
  ProducerHandlerV1,
  RegisteredProducerV1,
  ProducerRegistryV1,
  ProducerRegisterResultV1,
  ProducerRegisterFailureV1,
  ProducerRegisterOutcomeV1,
  ProducerValidationResultV1,
  ProducerValidationFailureV1,
  ProducerValidationOutcomeV1,
  FalsePassCheckResultV1,
  FalsePassCheckFailureV1,
  FalsePassCheckOutcomeV1,
  RouteStateViewportPlanV1,
  ViewportSpecV1,
  RouteStateViewportCombinationV1,
  DiagnosticNormalizationResultV1,
  DiagnosticNormalizationFailureV1,
  DiagnosticNormalizationOutcomeV1,
  ProducerExecutionRequestV1,
  ProducerExecutionSuccessV1,
  ProducerExecutionErrorV1,
  ProducerExecutionResultOutcomeV1,
} from "./registry.ts";

export type { ProducerDeclarationV1 } from "../profile/schemas.ts";

export {
  createProducerRegistry,
  evaluateApplicability,
  checkFalsePass,
  planRouteStateViewportMatrix,
  normalizeDiagnostics,
  executeProducer,
} from "./registry.ts";
