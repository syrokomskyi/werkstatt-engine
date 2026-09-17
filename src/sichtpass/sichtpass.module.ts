/*
<MODULE_CONTRACT>
<purpose>sichtpass.module — sichtpass kernel module registering the sichtpass.generate command (RFC-0947).</purpose>


<non-goals>
  <item>Does not implement command handler — that lives in sichtpass-generate.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0947: initial sichtpass kernel module with sichtpass.generate command registration.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createSichtpassModule(): Promise<ModuleExport> {
  const { runSichtpassGenerate } = await import("./sichtpass-generate.ts");
  return {
    name: "sichtpass",
    version: "0.1.0",
      declarations: [],
  commands: [
    {
        name: "sichtpass.generate",
        modulePath: "packages/werkstatt-engine/src/sichtpass/sichtpass.module.ts",
        description:
          "RFC-0947: Generate a site-wide visibility snapshot with composite hash and deduplication. Appends sichtpass __site__ Bordbuch entry when composite hash changes.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        cacheable: false,
        flags: {
          system: { kind: "string", description: "Target system ID" },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [],
        writes: [],
        generates: [],
        execute: runSichtpassGenerate,
      }
  ],
  pipelines: [

  ]};
}
