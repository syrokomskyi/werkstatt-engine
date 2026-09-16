/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/leitstand/index.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0806: replace leitstand.service.deploy with dev-deploy, promote, and rollback commands.</item>
  <item>RFC-0842: add leitstand.pipeline.check command for release pipeline state inspection.</item>
  <item>RFC-0866: add leitstand.certify command and shared deploy-execution pipeline.</item>
  <item>RFC-0927: add leitstand.hotfix.dev-deploy composite command export.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <history>RFC-0358, RFC-0379, RFC-0608, RFC-0627, RFC-0628, RFC-0751</history>
</CHANGE_SUMMARY>
*/

export {
  runLeitstandDevDeploy,
  type DevDeployResult,
  runLeitstandPropagate,
  type LeitstandPropagateData,
  runLeitstandPromote,
  type LeitstandPromoteData,
  runLeitstandStatus,
  type LeitstandStatusData,
  runLeitstandRollback,
  type LeitstandRollbackData,
  runLeitstandHealth,
  type LeitstandHealthData,
  runLeitstandPipelineCheck,
  type PipelineCheckResult,
  runLeitstandHotfixDevDeploy,
  type HotfixDevDeployResult,
} from "./leitstand-commands.ts";
export { runLeitstandCertify, type CertifyInput, type CertifyResult } from "./certify.ts";
export {
  executeDeployPhases,
  type DeployExecutionContext,
  type DeployExecutionResult,
} from "./deploy-execution.ts";
export { runLeitstandServiceDevDeploy } from "./service-dev-deploy.ts";
export { runLeitstandServicePromote } from "./service-promote.ts";
export type {
  PreDeployGateResult,
  ServiceDevDeployData,
  ServicePromoteData,
} from "./service-deploy-helpers.ts";
export type {
  DeploymentAdapter,
  CommandRunner,
  PropagateInput,
  RollbackInput,
  RollbackResult,
  HealthInput,
} from "./adapter.ts";

export { createLeitstandModule } from "./leitstand.module.ts";
