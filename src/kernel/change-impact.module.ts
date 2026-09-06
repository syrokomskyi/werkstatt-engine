/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel/src/change-impact.module.ts as an authored site-kernel authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0332: initial implementation.</item>
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
