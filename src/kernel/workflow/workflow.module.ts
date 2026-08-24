/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/workflow/workflow.module.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not register app-specific workflow commands.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0075: Add workflow command module.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "../types.ts";

export const workflowModule: KernelModule = {
  name: "workflow",
  version: "0.1.0",
  async register(registry) {
    const { runWorkflowLint, runWorkflowList, runWorkflowAmendList } =
      await import("./handlers.ts");
    registry.registerCommand({
      name: "workflow.lint",
      description:
        "Validate .agents/workflows AND .agents/workflows-amend markdown frontmatter, command references, " +
        "and per-chain phase links (RFC-0075 + RFC-0136).",
      scope: "workspace",
      flags: {},
      supportsAllSites: true,
      reads: [".agents/workflows/**/*.md", ".windsurf/workflows/**/*.md"],
      execute: runWorkflowLint,
    });
    registry.registerCommand({
      name: "workflow.list",
      description:
        "List .agents/workflows entries with phase, IO summary, and next workflow (RFC-0075).",
      scope: "workspace",
      flags: {},
      supportsAllSites: true,
      reads: [".agents/workflows/**/*.md", ".windsurf/workflows/**/*.md"],
      execute: runWorkflowList,
    });
    registry.registerCommand({
      name: "workflow-amend.list",
      description:
        "List .agents/workflows-amend entries with phase, IO summary, and next workflow (RFC-0136).",
      scope: "workspace",
      flags: {},
      supportsAllSites: true,
      reads: [".agents/workflows-amend/**/*.md"],
      execute: runWorkflowAmendList,
    });
  },
};
