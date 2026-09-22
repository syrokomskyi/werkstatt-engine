/*
<MODULE_CONTRACT>
<purpose>
Narrow public surface of the kernel cache layer for cross-package consumers
(e.g. RFC-1127 predecessor lookup in mobile.layout.check). Re-exports only the
pieces commands need to locate and read cached command results — the executor
machinery (setCachedCommandResult, workspace-tree-index) stays internal.
</purpose>
<non-goals>
  <item>No new cache logic — this barrel only re-exports sibling modules.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1127: initial barrel — createCacheLayer, CacheLayer types, COMMAND_RESULT_CACHE_NAMESPACE, CachedCommandResultEntry, computeModuleHash for predecessor moduleHash comparison.</item>
  <item>RFC-1127: step 1 — cache barrel + parse fix

Add ./kernel/cache subpath export (narrow barrel: createCacheLayer, computeModuleHash, key helpers). Fix parseCommandResultCacheKey truncating algo-prefixed hashes (sha256:hex) — list() returned garbage moduleHash for all real keys.</item>
  <item>RFC-1128: lighthouse.budget.check cacheable via dist-input reads

cacheable: true + reads covering dist/**, .lighthouse-budget-ignore, astro.config.*, system-config.yaml. Export computeInputsHash from kernel/cache barrel for reads-coverage tests. 3 new contract tests (18 total pass).</item>
</CHANGE_SUMMARY>
*/

export {
  createCacheLayer,
  cacheDbPath,
  CACHE_DB_RELATIVE_PATH,
  type CacheLayer,
  type CacheEntry,
  type CacheEntryInfo,
  type CacheListFilter,
  type CacheStatus,
  type CacheNamespaceStatus,
} from "./cache-layer.ts";

export {
  COMMAND_RESULT_CACHE_NAMESPACE,
  COMMAND_RESULT_CACHE_SCHEMA_VERSION,
  buildCommandResultCacheKey,
  computeInputsHash,
  computeModuleHash,
  type CachedCommandResultEntry,
  type CommandResultCacheKey,
  type InputsMetadataEntry,
} from "./command-result-cache.ts";
