/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/commit-message.module.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not implement lint logic here — see commit-message-lint.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Module registers the command only — lint logic lives in commit-message-lint.ts.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0265: initial implementation.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
