/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/workflow/workflow.module.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not register app-specific workflow commands.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Module registers the command only — workflow logic lives in sibling modules.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0075: Add workflow command module.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createWorkflowModule(): Promise<ModuleExport> {
const { runWorkflowLint, runWorkflowList, runWorkflowAmendList } =
      await import("./handlers.ts");
  return {
  name: "workflow",
  version: "0.1.0",
    declarations: [],
  commands: [
    {
      name: "workflow.lint",
      contract: "workflow",
      rules: [],
      modulePath: "packages/werkstatt-engine/src/kernel/workflow/workflow.module.ts",
      description:
        "Validate .agents/workflows AND .agents/workflows-amend markdown frontmatter, command references, " +
        "and per-chain phase links (RFC-0075 + RFC-0136).",
      scope: "workspace",
      flags: {},
      supportsAllSites: true,
      reads: [".agents/workflows/**/*.md", ".windsurf/workflows/**/*.md"],
      execute: runWorkflowLint,
    },
    {
      name: "workflow.list",
      modulePath: "packages/werkstatt-engine/src/kernel/workflow/workflow.module.ts",
      description:
        "List .agents/workflows entries with phase, IO summary, and next workflow (RFC-0075).",
      scope: "workspace",
      flags: {},
      supportsAllSites: true,
      reads: [".agents/workflows/**/*.md", ".windsurf/workflows/**/*.md"],
      execute: runWorkflowList,
    },
    {
      name: "workflow-amend.list",
      modulePath: "packages/werkstatt-engine/src/kernel/workflow/workflow.module.ts",
      description:
        "List .agents/workflows-amend entries with phase, IO summary, and next workflow (RFC-0136).",
      scope: "workspace",
      flags: {},
      supportsAllSites: true,
      reads: [".agents/workflows-amend/**/*.md"],
      execute: runWorkflowAmendList,
    }
  ],
  pipelines: [

  ]};
}
;
