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
  <item>TODO: record current design decisions</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0382: initial implementation — cacheModule with status and clear commands.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "../types.ts";
import type { ModuleExport } from "../../runtime/desired-state.ts";

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
