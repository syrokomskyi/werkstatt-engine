/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/change-impact.module.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Module registers the command only — classification logic lives in change-impact.ts.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0332: initial implementation.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../runtime/desired-state.ts";

export async function createChangeImpactModule(): Promise<ModuleExport> {
const { runChangeImpactDerive } = await import("./change-impact.ts");
  return {
  name: "change-impact",
  version: "0.1.0",

    declarations: [],
  commands: [
    {
      name: "change.impact.derive",
      modulePath: "packages/werkstatt-engine/src/kernel/change-impact.module.ts",
      description:
        "RFC-0332: classify changed paths into none/low/medium/high impact, derive impacted " +
        "apps, and recommend a proportionate check profile. Advisory only — DNA-35 remains " +
        "the readiness signal.",
      scope: "workspace",
      mutatesState: false,
      cacheable: false,
      flags: {
        paths: {
          kind: "string",
          description: "Comma-separated explicit paths to classify (bypasses git).",
        },
        "git-base": {
          kind: "string",
          description: "Git ref to diff against (e.g. origin/main). Uses git diff --name-only.",
        },
      },
      execute: runChangeImpactDerive,
    }
  ],
  pipelines: [

  ]};
}
;
