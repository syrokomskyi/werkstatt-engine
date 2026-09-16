/*
<MODULE_CONTRACT>
<purpose>Facilitates the registration of semantic layer validation commands per RFC-0042.</purpose>
<non-goals>
  <item>Do not implement content generation — validation only.</item>
  <item>Do not manage semantic builder logic — only check outputs.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>TODO: record current design decisions</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0042: Created semantic module with page validation command.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../../runtime/desired-state.ts";

export async function createSemanticModule(): Promise<ModuleExport> {
const { runSemanticPageValidate } = await import("./handlers.ts");
    // ── semantic.page.validate ─────────────────────────────────────────────────;
  return {
  name: "semantic",
  version: "0.1.0",

    declarations: [],
  commands: [
    {
      name: "semantic.page.validate",
      contract: "semantic",
      rules: [],
      modulePath: "packages/werkstatt-engine/src/kernel/semantic/semantic.module.ts",
      description:
        "[RFC-0042] Validate that semantic outputs (llms.txt, pages) do not contain " +
        "NEED_THIS_* markers indicating missing required content. " +
        "Use --strict to fail even in development. " +
        "Use --path to specify custom directory (default: dist/llms). " +
        "Use --json for machine-readable output.",
      scope: "app",
      reads: ["<app>/dist/llms/**"],
      execute: runSemanticPageValidate,
    }
  ],
  pipelines: [

  ]};
}
;
