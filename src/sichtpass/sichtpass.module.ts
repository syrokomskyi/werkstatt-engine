/*
<MODULE_CONTRACT>
<purpose>RFC-0947: sichtpass kernel module — registers sichtpass.generate command.</purpose>


<non-goals>
  <item>Does not implement command handler — that lives in sichtpass-generate.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0947: initial sichtpass kernel module with sichtpass.generate command registration.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../runtime/desired-state.ts";

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
