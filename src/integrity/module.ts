/*
<MODULE_CONTRACT>
<purpose>Defines a constant sequence for integrity operations in release processes.</purpose>
<non-goals>
  <item>Do not define the implementation details of each command.</item>
  <item>Do not manage the execution context or orchestration of the pipeline.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Clarify module purpose and responsibilities for future reference.</item>
</CHANGE_SUMMARY>
*/

import type { KernelPipelineStep } from "@warpgogol/werkstatt-engine/kernel";

// @ai-invariant STANDARD_INTEGRITY_PIPELINE is the single authoritative ordered sequence for
// integrity release operations. Apps spread this constant into their pipelines to get
// the full workflow: build record → sign → verify release.
export const STANDARD_INTEGRITY_PIPELINE: KernelPipelineStep[] = [
  { command: "integrity.build-record" },
  { command: "integrity.sign" },
  { command: "integrity.verify-release" },
];
