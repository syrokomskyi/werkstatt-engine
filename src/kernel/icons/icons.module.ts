/*
<MODULE_CONTRACT>
<purpose>Registers and executes the ui.icons.generate command for generating Astro icon components from LordIcon JSON files.</purpose>
<non-goals>
  <item>Do not modify source JSON files.</item>
  <item>Do not handle icon asset downloading or licensing.</item>
  <item>Do not validate icon content or animation integrity.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Module registers and executes ui.icons.generate — generation logic is inline because it is thin.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1147: renamed icons.generate to ui.icons.generate — the workspace platform command conflicted with the site-surface icons.generate (CMD-MAN-04); paths updated from deleted packages/ui to werkstatt-site domain/ui.</item>
  <item>RFC-1173: declare mutatesState on all kernel commands — collectDeclarationDiagnostics emits error-severity MUTATES-STATE-DECLARED, command.manifest.validate is the blocking consumer in packages.check, sweep declares the flag on every command definition (factories hardcode false for read-only check specs)</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createIconsModule(): Promise<ModuleExport> {
  const { runIconsGenerate } = await import("./index.ts");
  // ── ui.icons.generate ──────────────────────────────────────────────────────;
  return {
    name: "icons",
    version: "0.1.0",

    declarations: [],
    commands: [
      {
        name: "ui.icons.generate",
        mutatesState: true,
        modulePath: "packages/werkstatt-engine/src/kernel/icons/icons.module.ts",
        generates: [
          {
            path: "packages/werkstatt-site/src/domain/ui/icons/gen/{base}/{set}/",
            conditional: true,
            phase: "build.post",
          },
        ],
        description:
          "Generate Astro icon components for the werkstatt-site domain/ui package. " +
          "Reads JSON files from packages/werkstatt-site/src/domain/ui/assets/icons/ " +
          "and outputs components to packages/werkstatt-site/src/domain/ui/icons/gen/.",
        scope: "workspace",
        flags: {},
        reads: ["packages/werkstatt-site/src/domain/ui/assets/icons/**/*.json"],
        cacheable: false,
        execute: runIconsGenerate,
      },
    ],
    pipelines: [
      {
        name: "ui.icons.generate",
        steps: [{ command: "ui.icons.generate" }],
      },
    ],
  };
}
