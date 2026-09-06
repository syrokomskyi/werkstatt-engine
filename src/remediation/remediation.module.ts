/*
<MODULE_CONTRACT>
<purpose>
RFC-1027: registers remediation.catalog.generate and remediation.hint.validate
commands. The generate command emits docs/remediation-catalog.generated.yaml
from REMEDIATION_CATALOG. The validate command cross-references catalog keys
with validator rules[] declarations.
</purpose>
<non-goals>
  <item>Do not implement catalog or validation logic here — see remediation-catalog-generate.ts and remediation-hint-validate.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1027: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../runtime/desired-state.ts";

export async function createRemediationModule(): Promise<ModuleExport> {
  const { runRemediationCatalogGenerate } = await import("./remediation-catalog-generate.ts");
  const { runRemediationHintValidate } = await import("./remediation-hint-validate.ts");
  return {
    name: "remediation",
    version: "0.1.0",

    declarations: [],
    commands: [
      {
        name: "remediation.catalog.generate",
        modulePath: "packages/werkstatt-engine/src/remediation/remediation.module.ts",
        description:
          "Emit docs/remediation-catalog.generated.yaml from REMEDIATION_CATALOG, " +
          "cross-referencing validator rules[] declarations to identify uncovered ruleIds (RFC-1027).",
        scope: "workspace",
        mutatesState: true,
        writes: ["docs/remediation-catalog.generated.yaml"],
        cacheable: false,
        generates: [
          {
            path: "docs/remediation-catalog.generated.yaml",
            phase: "build.post",
          },
        ],
        flags: {},
        execute: runRemediationCatalogGenerate,
      },
      {
        name: "remediation.hint.validate",
        modulePath: "packages/werkstatt-engine/src/remediation/remediation.module.ts",
        description:
          "Validate that all validator diagnostics include remediation hints — " +
          "either via REMEDIATION_CATALOG or fixHint. In --mode strict, missing hints " +
          "are blocking errors (REMEDIATION-01). In --mode warning (default), they are warnings (RFC-1027).",
        scope: "workspace",
        mutatesState: false,
        cacheable: false,
        contract: "remediation",
        rules: ["REMEDIATION-01", "REMEDIATION-02"],
        flags: {
          mode: {
            kind: "string",
            description: "Validation mode: 'warning' (default) or 'strict'.",
          },
        },
        execute: runRemediationHintValidate,
      },
    ],
    pipelines: [],
  };
}
