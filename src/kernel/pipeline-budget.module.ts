/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/pipeline-budget.module.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not implement aggregation logic here — see pipeline-budgets.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0270: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "./types.ts";

export const pipelineBudgetModule: KernelModule = {
  name: "pipeline-budget",
  version: "0.1.0",

  async register(registry) {
    const { runPipelineBudgetGenerate } = await import("./pipeline-budgets.ts");
    registry.registerCommand({
      name: "pipeline.budget.generate",
      description:
        "Aggregate the local pipeline step telemetry history into docs/pipeline-budgets.generated.yaml " +
        "(p50/p95/expectedDurationMs per pipeline+command+app). Use --dry-run to preview without writing (RFC-0270).",
      scope: "workspace",
      mutatesState: true,
      writes: ["docs/pipeline-budgets.generated.yaml"],
      cacheable: false,
      flags: {
        "dry-run": {
          kind: "boolean",
          description: "Preview the aggregation without writing the budgets file.",
        },
      },
      execute: runPipelineBudgetGenerate,
    });
  },
};
