/*
<MODULE_CONTRACT>
<purpose>Register werkstatt.autonomy.validate command with the kernel registry (RFC-0772).</purpose>
<keywords>autonomy, validate, RFC-0772, module</keywords>
<non-goals>
  <item>Do not implement validation logic — delegate to plugin/autonomy-validate.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0772: initial werkstatt-autonomy module registering werkstatt.autonomy.validate.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelModule,
  KernelRuntimeContext,
} from "../src/kernel/types.ts";
import {
  runAutonomyValidate,
  type AutonomyValidateResult,
} from "../src/plugin/autonomy-validate.ts";

export const werkstattAutonomyModule: KernelModule = {
  name: "werkstatt-autonomy",
  version: "0.1.0",
  register(registry) {
    registry.registerCommand({
      name: "werkstatt.autonomy.validate",
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
    });
  },
};
