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

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
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
