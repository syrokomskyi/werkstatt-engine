/*
<MODULE_CONTRACT>
<purpose>certification evaluators index — re-export the evaluator registry public surface.</purpose>
<non-goals>
  <item>Do not implement evaluators here — they live in the registry.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export type {
  RiskClass,
  EvaluatorVerdict,
  QualitativeRubricV1,
  RubricCriterionV1,
  EvaluatorInputBundleV1,
  CoverageManifestV1,
  CoverageCombinationV1,
  QualitativeEvaluationPayloadV1,
  CriterionVerdictV1,
  EvaluatorIdentityV1,
  EvaluatorHandlerV1,
  RegisteredEvaluatorV1,
  EvaluatorRegistryV1,
  EvaluatorRegisterResultV1,
  EvaluatorRegisterFailureV1,
  EvaluatorRegisterOutcomeV1,
  RiskRuleV1,
  RiskRoutingResultV1,
  ChangeProfileV1,
  EvaluatorIsolationCheckV1,
  EvaluatorIsolationFailureV1,
  EvaluatorIsolationOutcomeV1,
  ConsensusResultV1,
  ConsensusFailureV1,
  ConsensusOutcomeV1,
  EvaluatorValidationResultV1,
  EvaluatorValidationFailureV1,
  EvaluatorValidationOutcomeV1,
  EvaluatorExecutionRequestV1,
  EvaluatorExecutionSuccessV1,
  EvaluatorExecutionFailureV1,
  EvaluatorExecutionOutcomeV1,
} from "./registry.ts";

export {
  createEvaluatorRegistry,
  routeRisk,
  checkEvaluatorIsolation,
  aggregateConsensus,
  validateEvaluatorPayload,
  executeEvaluators,
  buildCoverageManifest,
} from "./registry.ts";
