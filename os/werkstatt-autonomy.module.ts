/*
<MODULE_CONTRACT>
<purpose>Register werkstatt.autonomy.validate command with the kernel registry (RFC-0772).</purpose>

<non-goals>
  <item>Do not implement validation logic — delegate to plugin/autonomy-validate.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0772: initial werkstatt-autonomy module registering werkstatt.autonomy.validate.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../src/kernel/types.ts";
import type { ModuleExport } from "../src/runtime/desired-state.ts";
import {
  runAutonomyValidate,
  type AutonomyValidateResult,
} from "../src/plugin/autonomy-validate.ts";

export const werkstattAutonomyModule: ModuleExport = {
  name: "werkstatt-autonomy",
  version: "0.1.0",
    declarations: [],
  commands: [
    {
      name: "werkstatt.autonomy.validate",
      contract: "werkstatt",
      rules: [],
      modulePath: "packages/werkstatt-engine/os/werkstatt-autonomy.module.ts",
      description:
        "Scan packages/werkstatt/src/** for forbidden @warpgogol/* imports (excluding self-imports and shared schema packages). Enforces DNA-64 engine/plugin boundary (RFC-0772).",
      scope: "workspace",
      supportsAllSites: false,
      flags: {},
      reads: ["packages/werkstatt/src/**"],
      cacheable: false,
      async execute(
        _input: KernelCommandInput,
        context: KernelRuntimeContext,
      ): Promise<KernelCommandResult<AutonomyValidateResult>> {
        const result = await runAutonomyValidate(context.workspaceRoot);
        return {
          exitCode: result.status === "pass" ? 0 : 1,
          data: result,
          summary:
            result.status === "pass"
              ? `Autonomy guard passed — ${result.scannedFiles} files scanned, zero violations`
              : `Autonomy guard failed — ${result.violations.length} violation${result.violations.length === 1 ? "" : "s"} in ${result.scannedFiles} files`,
        };
      },
    }
  ],
  pipelines: [

  ]};
