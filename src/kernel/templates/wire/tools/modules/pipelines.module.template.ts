/*
<MODULE_CONTRACT>
<purpose>Pipelines module for {{APP_NAME}} — declares site-level build and check pipelines as ModuleExport.pipelines (RFC-1038).</purpose>
<non-goals>
  <item>Do not implement commands here — only pipeline declarations.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>TODO: record current design decisions</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/
import type { ModuleExport } from "@warpgogol/werkstatt-engine/runtime/desired-state";
import type { KernelPipelineStep } from "@warpgogol/werkstatt-engine/kernel";
import {
  SITES_CHECK_PIPELINE,
  STANDARD_COMPASS_PIPELINE,
  SITES_BUILD_PREPARE_PIPELINE,
  SITES_BUILD_PREPARE_DEV_PIPELINE,
  SITES_BUILD_CHECK_PIPELINE,
  SITES_BUILD_POST_PIPELINE,
} from "@warpgogol/werkstatt-site/checks/pipelines";
import { STANDARD_INTEGRITY_PIPELINE } from "@warpgogol/werkstatt-engine/integrity";

const pipelines: { name: string; steps: KernelPipelineStep[] }[] = [
  { name: "build.prepare", steps: [...SITES_BUILD_PREPARE_PIPELINE] },
  { name: "build.prepare.dev", steps: [...SITES_BUILD_PREPARE_DEV_PIPELINE] },
  { name: "build.check", steps: [...SITES_BUILD_CHECK_PIPELINE] },
  { name: "build.post", steps: [...SITES_BUILD_POST_PIPELINE] },
  { name: "check", steps: [...SITES_CHECK_PIPELINE] },
  { name: "compass", steps: [...STANDARD_COMPASS_PIPELINE] },
  { name: "integrity.release", steps: [...STANDARD_INTEGRITY_PIPELINE] },
];

export const pipelinesModule: ModuleExport = {
  name: "pipelines",
  version: "0.1.0",
  declarations: [],
  commands: [],
  pipelines,
};
