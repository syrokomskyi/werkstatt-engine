/*
<MODULE_CONTRACT>
<purpose>
RFC-0963: registers the validator.inventory.generate command, which emits
docs/validator-inventory.generated.yaml and enforces fail-closed on missing
contract/rules tags.
</purpose>
<non-goals>
  <item>Do not implement inventory logic here — see validator-inventory.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Module registers the command only — inventory generation lives in validator-inventory.ts.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0963: initial implementation.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createValidatorInventoryModule(): Promise<ModuleExport> {
const { runValidatorInventoryGenerate } = await import("./validator-inventory.ts");
  return {
  name: "validator-inventory",
  version: "0.1.0",

    declarations: [],
  commands: [
    {
      name: "validator.inventory.generate",
      modulePath: "packages/werkstatt-engine/src/kernel/validator-inventory.module.ts",
      description:
        "Emit docs/validator-inventory.generated.yaml mapping contracts to validators, rules, pipeline phase, and p95 timing (RFC-0963). " +
        "Fail-closed on missing contract/rules tags. Use --dry-run for warning-only mode during migration.",
      scope: "workspace",
      mutatesState: true,
      writes: ["docs/validator-inventory.generated.yaml"],
      cacheable: false,
      generates: [
        {
          path: "docs/validator-inventory.generated.yaml",
          phase: "build.post",
        },
      ],
      flags: {
        "dry-run": {
          kind: "boolean",
          description: "Emit warnings instead of failing on untagged validators.",
        },
      },
      execute: runValidatorInventoryGenerate,
    }
  ],
  pipelines: [

  ]};
}
;
