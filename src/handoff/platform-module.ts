/*
<MODULE_CONTRACT>
  <purpose>RFC-0478: platform kernel module — registers platform.consistency.validate command.</purpose>
  <non-goals>
    <item>Do not register sternsystem, mission, or handoff commands — those have their own modules.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0478: initial platform module for platform.consistency.validate.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";
import type { ModuleExport } from "../runtime/desired-state.ts";

export async function createPlatformModule(): Promise<ModuleExport> {
  const { runPlatformConsistencyValidate } = await import("./platform-consistency.ts");
  return {
    name: "platform",
    version: "0.1.0",
      declarations: [],
  commands: [
    {
        name: "platform.consistency.validate",
        contract: "platform",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/handoff/platform-module.ts",
        generates: [],
        description:
          "Validate that platformSemanticHash drift is accompanied by a version bump, and that versionBump RFCs correspond to actual version changes (RFC-0478).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          json: { kind: "boolean", description: "JSON output for agent consumption." },
          check: {
            kind: "boolean",
            description: "Read-only mode: validate without writing the log file (for CI).",
          },
        },
        reads: [
          "package.json",
          "packages/**",
          "docs/rfcs/**/*.md",
          "docs/platform-version-log.generated.yaml",
        ],
        writes: ["docs/platform-version-log.generated.yaml"],
        cacheable: false,
        execute: runPlatformConsistencyValidate,
        gate: {
          severity: "error",
          phase: "workspace",
          rules: ["PC-01", "PC-02", "PC-03"],
          blocks: ["release.prepare"],
        },
      }
  ],
  pipelines: [

  ]};
}
