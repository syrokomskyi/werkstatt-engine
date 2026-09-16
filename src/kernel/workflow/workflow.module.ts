/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/workflow/workflow.module.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not register app-specific workflow commands.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>TODO: record current design decisions</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0075: Add workflow command module.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../../runtime/desired-state.ts";

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
