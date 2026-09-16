/*
<MODULE_CONTRACT>
<purpose>Defines a constant sequence for integrity operations in release processes.</purpose>
<non-goals>
  <item>Do not define the implementation details of each command.</item>
  <item>Do not manage the execution context or orchestration of the pipeline.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
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
