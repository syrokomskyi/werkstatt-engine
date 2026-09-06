/*
<MODULE_CONTRACT>
<purpose>Register werkstatt.commands.validate command with the kernel registry (RFC-0903, DNA-82).</purpose>
<keywords>validate, commands, RFC-0903, DNA-82, module</keywords>
<non-goals>
  <item>Do not implement validation logic — delegate to plugin/commands-validate.ts.</item>
  <item>Do not add to PACKAGES_CHECK_PIPELINE — gated adoption per RFC-0903.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0903: initial werkstatt-commands-validate module registering werkstatt.commands.validate.</item>
</CHANGE_SUMMARY>
*/

import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "../src/kernel/types.ts";
import type { ModuleExport } from "../src/runtime/desired-state.ts";
import {
  runCommandsValidate,
  type CommandsValidateResult,
} from "../src/plugin/commands-validate.ts";

export const werkstattCommandsValidateModule: ModuleExport = {
  name: "werkstatt-commands-validate",
  version: "0.1.0",
    declarations: [],
  commands: [
    {
      name: "werkstatt.commands.validate",
      contract: "werkstatt",
      rules: [],
      modulePath: "packages/werkstatt-engine/os/werkstatt-commands-validate.module.ts",
      description:
        "Statically analyze kernel command handler return statements for DNA-82 compliance: explicit exitCode, [command.name]-prefixed summary, nextSteps on failure. Enforces RFC-0903.",
      scope: "workspace",
      supportsAllSites: false,
      flags: {
        mode: {
          kind: "string",
          description:
            "Violation severity: 'error' (blocking, default) or 'warning' (non-blocking).",
          default: "error",
        },
        json: {
          kind: "boolean",
          description: "Output diagnostics as JSON.",
          default: false,
        },
      },
      reads: [
        "packages/werkstatt/src/**",
        "packages/werkstatt-site/src/**",
        "packages/werkstatt-shared/src/**",
      ],
      cacheable: false,
      async execute(
        input: KernelCommandInput,
        context: KernelRuntimeContext,
      ): Promise<KernelCommandResult<CommandsValidateResult>> {
        const mode = (input.flags.mode as "error" | "warning") ?? "error";
        return runCommandsValidate(context.workspaceRoot, mode);
      },
    }
  ],
  pipelines: [

  ]};
