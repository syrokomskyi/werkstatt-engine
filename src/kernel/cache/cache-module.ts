/*
<MODULE_CONTRACT>
<purpose>
RFC-0382: Kernel module registering kernel.cache.status and kernel.cache.clear
workspace commands. Provides cache diagnostics and explicit clearing.
</purpose>
<non-goals>
  <item>Do not implement cache storage — that lives in cache-layer.ts and sqlite-cache-layer.ts.</item>
  <item>Do not implement RFC-specific cache helpers — that lives in rfc-cache.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Module registers commands only — cache logic lives in the sibling modules.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0382: initial implementation — cacheModule with status and clear commands.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createCacheModule(): Promise<ModuleExport> {
const { runKernelCacheStatus, runKernelCacheClear } = await import("./cache-handlers.ts");
  return {
  name: "cache",
  version: "0.1.0",

    declarations: [],
  commands: [
    {
      name: "kernel.cache.status",
      modulePath: "packages/werkstatt-engine/src/kernel/cache/cache-module.ts",
      description:
        "RFC-0382: report the kernel cache state — availability, DB path, DB size, " +
        "namespace entry counts, and hit ratios. Use --json for machine-readable output.",
      scope: "workspace",
      flags: {},
      cacheable: false,
      execute: runKernelCacheStatus,
    },
    {
      name: "kernel.cache.clear",
      modulePath: "packages/werkstatt-engine/src/kernel/cache/cache-module.ts",
      generates: [],
      description:
        "RFC-0382: clear the kernel cache. Pass --namespace to clear only one namespace " +
        "(e.g. rfc_entries); without --namespace, clears all namespaces.",
      scope: "workspace",
      mutatesState: true,
      writes: [".cache/kernel-cache.db"],
      cacheable: false,
      flags: {
        namespace: {
          kind: "string",
          description: "Clear only this namespace (e.g. rfc_entries). Without, clears all.",
        },
      },
      execute: runKernelCacheClear,
    }
  ],
  pipelines: [

  ]};
}
;
