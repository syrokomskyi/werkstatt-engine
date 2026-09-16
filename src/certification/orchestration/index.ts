/*
<MODULE_CONTRACT>
<purpose>certification orchestration index — re-export the orchestrator public surface for consumers.</purpose>
<non-goals>
  <item>Do not implement orchestration here — it lives in orchestrator.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export type {
  OrchestratorState,
  ProducerDependencyNodeV1,
  ProducerPlanV1,
  ProducerPlanFailureV1,
  ProducerPlanOutcomeV1,
  GateLockV1,
  GateLockAcquireInputV1,
  GateLockManagerV1,
  GateLockAcquireResultV1,
  GateLockAcquireFailureV1,
  GateLockAcquireOutcomeV1,
  ProducerExecutionConfigV1,
  ProducerExecutionInputV1,
  ProducerExecutionHandlerV1,
  ProgressEventV1,
  ProgressCallbackV1,
  ProducerExecutionResultV1,
  ProducerExecutionFailureV1,
  ProducerExecutionOutcomeV1,
  OrchestratorOperationV1,
  OrchestratorResumePointV1,
  OrchestratorResumeResultV1,
  OrchestratorResumeFailureV1,
  OrchestratorResumeOutcomeV1,
} from "./orchestrator.ts";

export {
  planProducers,
  createGateLockManager,
  executeProducers,
  createResumePoint,
  computeResumePoint,
  DEFAULT_PRODUCER_CONFIG,
} from "./orchestrator.ts";
