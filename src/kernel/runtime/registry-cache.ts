/*
<MODULE_CONTRACT>
<purpose>
Process-lifetime singleton cache for KernelRegistry instances (ADR-0022).
Avoids rebuilding the registry from scratch when executeKernelPipeline or
executeKernelCommand is called multiple times within the same Node.js process.
</purpose>
<non-goals>
  <item>Do not persist cache across processes — each process starts with an empty cache.</item>
  <item>Do not cache single-module registries built by buildRegistryForModule — only full registries are cached.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0022: initial implementation — process-lifetime Map keyed by config source path.</item>
</CHANGE_SUMMARY>
*/

import type { KernelAppConfig } from "../types.ts";
import type { KernelRegistry } from "../registry.ts";
import { buildRegistry } from "./registry.ts";
import { loadWorkspaceConfig } from "../discovery.ts";

const registryCache = new Map<string, KernelRegistry>();
let cacheEnabled = true;

/**
 * Returns a cached KernelRegistry for the given cache key, or builds and caches
 * a new one. The cache key must uniquely identify the config source within the
 * process (e.g. `workspace:<root>` or `site:<configPath>`).
 *
 * When the cache is disabled (via `setRegistryCacheEnabled(false)`), always
 * builds a fresh registry without reading from or writing to the cache.
 */
export async function getOrBuildRegistry(
  cacheKey: string,
  config: KernelAppConfig,
): Promise<KernelRegistry> {
  if (cacheEnabled) {
    const cached = registryCache.get(cacheKey);
    if (cached) {
      process.stderr.write(`  [registry] cache hit for ${cacheKey}\n`);
      return cached;
    }
  }

  const registry = await buildRegistry(config);

  if (cacheEnabled) {
    registryCache.set(cacheKey, registry);
  }

  return registry;
}

/**
 * Load workspace config and return a cached registry for it.
 * Returns undefined when no workspace config exists.
 */
export async function getOrBuildWorkspaceRegistry(
  workspaceRoot: string,
): Promise<KernelRegistry | undefined> {
  const config = await loadWorkspaceConfig(workspaceRoot);
  if (!config) return undefined;
  const cacheKey = `workspace:${workspaceRoot}`;
  return getOrBuildRegistry(cacheKey, config);
}

/**
 * Clear all cached registries. Called by the `--no-registry-cache` CLI flag
 * and by tests that need a fresh registry between runs.
 */
export function clearRegistryCache(): void {
  registryCache.clear();
}

/**
 * Enable or disable the registry cache. When disabled, `getOrBuildRegistry`
 * always builds a fresh registry and does not read from or write to the cache.
 * Calling with `false` also clears any existing cached entries.
 */
export function setRegistryCacheEnabled(enabled: boolean): void {
  cacheEnabled = enabled;
  if (!enabled) {
    registryCache.clear();
  }
}

/**
 * Returns true if the registry cache is currently enabled.
 */
export function isRegistryCacheEnabled(): boolean {
  return cacheEnabled;
}
