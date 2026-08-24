/*
<MODULE_CONTRACT>
<purpose>Registers and executes the icons.generate command for generating Astro icon components from LordIcon JSON files.</purpose>
<non-goals>
  <item>Do not modify source JSON files.</item>
  <item>Do not handle icon asset downloading or licensing.</item>
  <item>Do not validate icon content or animation integrity.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Initial implementation of icons.generate command for @warpgogol/werkstatt-site/ui package.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "../types.ts";

export const iconsModule: KernelModule = {
  name: "icons",
  version: "0.1.0",

  async register(registry) {
    const { runIconsGenerate } = await import("./index.ts");
    // ── icons.generate ─────────────────────────────────────────────────────────
    registry.registerCommand({
      name: "icons.generate",
      description:
        "Generate Astro icon components for @warpgogol/werkstatt-site/ui package. " +
        "Reads JSON files from packages/ui/src/assets/icons/lordicon/ " +
        "and outputs components to packages/ui/src/icons/gen/lordicon/.",
      scope: "workspace",
      flags: {},
      reads: ["packages/ui/src/assets/icons/lordicon/**/*.json"],
      cacheable: false,
      execute: runIconsGenerate,
    });
  },
};
