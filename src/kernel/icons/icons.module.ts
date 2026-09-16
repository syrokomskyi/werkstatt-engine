/*
<MODULE_CONTRACT>
<purpose>Registers and executes the icons.generate command for generating Astro icon components from LordIcon JSON files.</purpose>
<non-goals>
  <item>Do not modify source JSON files.</item>
  <item>Do not handle icon asset downloading or licensing.</item>
  <item>Do not validate icon content or animation integrity.</item>
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

import type { ModuleExport } from "../../runtime/desired-state.ts";

export async function createIconsModule(): Promise<ModuleExport> {
  const { runIconsGenerate } = await import("./index.ts");
  // ── icons.generate ─────────────────────────────────────────────────────────;
  return {
    name: "icons",
    version: "0.1.0",

    declarations: [],
    commands: [
      {
        name: "icons.generate",
        modulePath: "packages/werkstatt-site/src/codegen/service.ts",
        generates: [
          {
            path: "src/components/icons/gen/{id}/{name}.astro",
            conditional: true,
            phase: "build.post",
          },
          { path: "src/components/icons/gen/index.ts", conditional: true, phase: "build.post" },
        ],
        description:
          "Generate Astro icon components for @warpgogol/werkstatt-site/ui package. " +
          "Reads JSON files from packages/ui/src/assets/icons/lordicon/ " +
          "and outputs components to packages/ui/src/icons/gen/lordicon/.",
        scope: "workspace",
        flags: {},
        reads: ["packages/ui/src/assets/icons/lordicon/**/*.json"],
        cacheable: false,
        execute: runIconsGenerate,
      },
    ],
    pipelines: [
      {
        name: "icons.generate",
        steps: [{ command: "icons.generate" }],
      },
    ],
  };
}
