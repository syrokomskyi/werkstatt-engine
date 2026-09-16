/*
<MODULE_CONTRACT>
<purpose>Removed by RFC-1038: KernelRegistry class deleted. ActualState and buildActualState
replace all registry functionality. This file is kept as an empty stub to avoid breaking
any stale imports that may reference it directly.</purpose>
<non-goals>
  <item>Do not re-introduce a registry class — use buildActualState from runtime/reconciler.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>The KernelRegistry class was removed by RFC-1038 — ActualState replaces it.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1026: add lifecycle-owned registrations — pipelineModules, moduleStates, inFlight, disposedCommandOrigins maps; unregisterModule, trackInFlight, drainInFlight, getModuleState methods; registerPipeline tracks currentModuleName.</item>
  <item>RFC-1038: delete KernelRegistry class — replaced by ActualState interface and buildActualState function in runtime/reconciler.ts.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export const REGISTRY_STUB_REMOVED_BY_RFC_1038 = true as const;
