/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/pipeline-budget.module.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not implement aggregation logic here — see pipeline-budgets.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Module registers the command only — budget logic lives in pipeline-budgets.ts.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0270: initial implementation.</item>
  <item>RFC-0963: register pipeline.budget.validate command.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createPipelineBudgetModule(): Promise<ModuleExport> {
const { runPipelineBudgetGenerate } = await import("./pipeline-budgets.ts");
    const { runPipelineBudgetValidate } = await import("./pipeline-budget-validate.ts");
  return {
  name: "pipeline-budget",
  version: "0.1.0",

    declarations: [],
  commands: [
    {
      name: "pipeline.budget.generate",
      modulePath: "packages/werkstatt-engine/src/kernel/pipeline-budget.module.ts",
      description:
        "Aggregate the local pipeline step telemetry history into docs/pipeline-budgets.generated.yaml " +
        "(p50/p95/expectedDurationMs per pipeline+command+app). Use --dry-run to preview without writing (RFC-0270).",
      scope: "workspace",
      mutatesState: true,
      writes: ["docs/pipeline-budgets.generated.yaml"],
      generates: [{ path: "docs/pipeline-budgets.generated.yaml", phase: "build.prepare" }],
      cacheable: false,
      flags: {
        "dry-run": {
          kind: "boolean",
          description: "Preview the aggregation without writing the budgets file.",
        },
      },
      execute: runPipelineBudgetGenerate,
    },
    {
      name: "pipeline.budget.validate",
      contract: "pipeline",
      rules: [],
      modulePath: "packages/werkstatt-engine/src/kernel/pipeline-budget.module.ts",
      description:
        "Compare fresh telemetry p95 against committed budgets in docs/pipeline-budgets.generated.yaml (RFC-0963). " +
        "Returns BUDGET-01 for breaches, BUDGET-02 for steps with no telemetry. Supports --site and --tolerance flags.",
      scope: "workspace",
      mutatesState: false,
      cacheable: false,
      flags: {
        site: {
          kind: "string",
          description: "Filter validation to a specific site id.",
        },
        tolerance: {
          kind: "string",
          description:
            "Multiplier applied to expectedDurationMs to compute the breach threshold (default: 1.5).",
        },
      },
      execute: runPipelineBudgetValidate,
    }
  ],
  pipelines: [

  ]};
}
;
