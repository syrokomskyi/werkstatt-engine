/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/commit-message.module.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not implement lint logic here — see commit-message-lint.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>TODO: record current design decisions</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0265: initial implementation.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../runtime/desired-state.ts";

export async function createCommitMessageModule(): Promise<ModuleExport> {
const { runCommitMessageLint } = await import("./commit-message-lint.ts");
  return {
  name: "commit-message",
  version: "0.1.0",

    declarations: [],
  commands: [
    {
      name: "commit.message.lint",
      contract: "commit",
      rules: [],
      modulePath: "packages/werkstatt-engine/src/kernel/commit-message.module.ts",
      description:
        "Validate commit message hygiene for a git range (default: origin/main..HEAD): " +
        "subject length, conventional-commit shape, narration/markdown pollution, and " +
        "RFC-id reference for packages/os/** or docs/rfcs/** changes (RFC-0265). " +
        "Pass --range <rev-range> to override.",
      scope: "workspace",
      cacheable: false,
      flags: {
        range: {
          kind: "string",
          description: "git rev-range to lint (default: origin/main..HEAD).",
        },
      },
      execute: runCommitMessageLint,
    }
  ],
  pipelines: [

  ]};
}
;
