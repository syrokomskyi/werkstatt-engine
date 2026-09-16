/*
<MODULE_CONTRACT>
<purpose>Thin re-export shim over runtime/* (RFC-0303 split): kernel command/pipeline
execution, registry assembly, argv parsing, and RFC-0086 diagnostic formatting.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Kernel runtime must surface command diagnostics without hiding non-zero command results.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0303: split into runtime/{argv,registry,execute-command,execute-pipeline,diagnostics,shared}.ts; this file is now a thin re-export shim so every existing "./runtime.ts" import keeps working unchanged.</item>
  <item>RFC-0686: export buildSchedule, executeScheduledSteps, ScheduledStep, ScheduleError from runtime/pipeline-scheduler.ts.</item>
  <item>ADR-0022: export registry cache control functions (getOrBuildRegistry, getOrBuildWorkspaceRegistry, clearRegistryCache, setRegistryCacheEnabled, isRegistryCacheEnabled) from runtime/registry-cache.ts.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant: Kernel runtime must surface command diagnostics without hiding non-zero command results.

export { parseKernelArgv, resolveCommandFlags, KERNEL_UNIVERSAL_FLAGS } from "./runtime/argv.ts";
export {
  listSiteWorkspaces,
  listRegisteredKernelCommandNames,
  listRegisteredKernelCommands,
  listRegisteredKernelPipelines,
  loadAppRuntime,
} from "./runtime/registry.ts";
export { executeKernelCommand, executeRegisteredCommand } from "./runtime/execute-command.ts";
export { executeKernelPipeline } from "./runtime/execute-pipeline.ts";
export {
  buildSchedule,
  executeScheduledSteps,
  type ScheduledStep,
  type StepExecutionResult,
  ScheduleError,
} from "./runtime/pipeline-scheduler.ts";
export { formatFailureDiagnostics } from "./runtime/diagnostics.ts";
export {
  getOrBuildRegistry,
  getOrBuildWorkspaceRegistry,
  clearRegistryCache,
  setRegistryCacheEnabled,
  isRegistryCacheEnabled,
} from "./runtime/registry-cache.ts";
