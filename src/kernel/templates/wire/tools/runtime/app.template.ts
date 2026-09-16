/*
<MODULE_CONTRACT>
<purpose>App runtime helpers requiring an app-scoped kernel context.</purpose>
<non-goals>
  <item>Do not implement Astro path resolution here — delegate to site-kernel-astro.</item>
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
import { requireAstroSitePaths } from "@warpgogol/werkstatt-site/paths";
import type { DiscoveredSiteWorkspace, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";

export function requireApp(context: KernelRuntimeContext): DiscoveredSiteWorkspace {
  if (!context.site) throw new Error("This command requires an app-scoped runtime context.");
  return context.site;
}

export function requireAppAstroPaths(context: KernelRuntimeContext) {
  return requireAstroSitePaths(context);
}
