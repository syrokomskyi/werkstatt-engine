/*
<MODULE_CONTRACT>
<purpose>Removed by RFC-1038: KernelRegistry class deleted. ActualState and buildActualState
replace all registry functionality. This file is kept as an empty stub to avoid breaking
any stale imports that may reference it directly.</purpose>
<non-goals>
  <item>Do not re-introduce a registry class — use buildActualState from runtime/reconciler.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1026: add lifecycle-owned registrations — pipelineModules, moduleStates, inFlight, disposedCommandOrigins maps; unregisterModule, trackInFlight, drainInFlight, getModuleState methods; registerPipeline tracks currentModuleName.</item>
  <item>RFC-1038: delete KernelRegistry class — replaced by ActualState interface and buildActualState function in runtime/reconciler.ts.</item>
</CHANGE_SUMMARY>
*/
