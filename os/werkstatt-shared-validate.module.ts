/*
<MODULE_CONTRACT>
<purpose>Register werkstatt.shared.validate command with the kernel registry (RFC-0868).</purpose>
<keywords>shared, validate, RFC-0868, module</keywords>
<non-goals>
  <item>Do not implement validation logic — delegate to plugin/shared-validate.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0868: initial werkstatt-shared module registering werkstatt.shared.validate.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelModule,
  KernelRuntimeContext,
} from "../src/kernel/types.ts";
import { runSharedValidate, type SharedValidateResult } from "../src/plugin/shared-validate.ts";

export const werkstattSharedValidateModule: KernelModule = {
  name: "werkstatt-shared-validate",
  version: "0.1.0",
  register(registry) {
    registry.registerCommand({
      name: "werkstatt.shared.validate",
      description:
        "Check SHARED-01 (werkstatt-shared dep declared), SHARED-02 (no site exemptions in autonomy-validate), SHARED-03 (no site imports in engine src). Enforces RFC-0868.",
      scope: "workspace",
      supportsAllSites: false,
      flags: {},
      reads: [
        "packages/werkstatt/package.json",
        "packages/werkstatt/src/plugin/autonomy-validate.ts",
        "packages/werkstatt/src/**",
      ],
      cacheable: false,
      async execute(
        _input: KernelCommandInput,
        context: KernelRuntimeContext,
      ): Promise<KernelCommandResult<SharedValidateResult>> {
        const result = await runSharedValidate(context.workspaceRoot);
        const failedChecks = result.checks.filter((c) => c.status === "fail");
        return {
          exitCode: result.status === "pass" ? 0 : 1,
          data: result,
          summary:
            result.status === "pass"
              ? `Shared boundary guard passed — SHARED-01/02/03 all pass`
              : `Shared boundary guard failed — ${failedChecks.map((c) => c.id).join(", ")}`,
        };
      },
    });
  },
};
