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
  <item>RFC-1144: run read-only steps to completion in collect-errors pipeline mode

Scheduler: collectErrors option on executeScheduledSteps — read-only steps (ScheduledStep.readOnly, executor-resolved from mutatesState === false) run after dependency failures with ranAfterFailedDependency annotation; ranTainted set propagates taint transitively so mutating dependents still skip. Executor: mergeCollectErrorsOption OR-merges PipelineDeclaration.collectErrors with the CLI flag at registry resolution; readOnly annotated post-buildSchedule; taint flag copied to step reports; tainted failures marked in pretty output. Contracts: PipelineDeclaration.collectErrors, KernelExecutionReport.ranAfterFailedDependency, pipelines maps store full declarations. Declarations: collectErrors on validation-gate registrations (build.post, check, build.check, compass, integrity.release in the workpiece template; packages.check in checks module). Tests: 10 new cases covering AC-1..AC-6 plus transitive taint.</item>
</CHANGE_SUMMARY>
*/
import type { ModuleExport } from "@warpgogol/werkstatt-engine/runtime/desired-state";
import type { PipelineDeclaration } from "@warpgogol/werkstatt-engine/kernel";
import {
  SITES_CHECK_PIPELINE,
  STANDARD_COMPASS_PIPELINE,
  SITES_BUILD_PREPARE_PIPELINE,
  SITES_BUILD_PREPARE_DEV_PIPELINE,
  SITES_BUILD_CHECK_PIPELINE,
  SITES_BUILD_POST_PIPELINE,
} from "@warpgogol/werkstatt-site/checks/pipelines";
import { STANDARD_INTEGRITY_PIPELINE } from "@warpgogol/werkstatt-engine/integrity";

// RFC-1144: validation-gate pipelines declare collectErrors — read-only
// validators run to completion after a failure so one pass reports every
// failure. build.prepare* stays fail-fast (mutating generators).
const pipelines: PipelineDeclaration[] = [
  { name: "build.prepare", steps: [...SITES_BUILD_PREPARE_PIPELINE] },
  { name: "build.prepare.dev", steps: [...SITES_BUILD_PREPARE_DEV_PIPELINE] },
  { name: "build.check", steps: [...SITES_BUILD_CHECK_PIPELINE], collectErrors: true },
  { name: "build.post", steps: [...SITES_BUILD_POST_PIPELINE], collectErrors: true },
  { name: "check", steps: [...SITES_CHECK_PIPELINE], collectErrors: true },
  { name: "compass", steps: [...STANDARD_COMPASS_PIPELINE], collectErrors: true },
  { name: "integrity.release", steps: [...STANDARD_INTEGRITY_PIPELINE], collectErrors: true },
];

export const pipelinesModule: ModuleExport = {
  name: "pipelines",
  version: "0.1.0",
  declarations: [],
  commands: [],
  pipelines,
};
