/*
<MODULE_CONTRACT>
<purpose>Register the werkstatt.commands.validate command with the kernel registry and module loader (RFC-0903, DNA-82).</purpose>

<non-goals>
  <item>Do not implement validation logic — delegate to plugin/commands-validate.ts.</item>
  <item>Do not add to PACKAGES_CHECK_PIPELINE — gated adoption per RFC-0903.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0903: initial werkstatt-commands-validate module registering werkstatt.commands.validate.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
