/*
<MODULE_CONTRACT>
  <purpose>Register werkstatt.e2e.cold command with the kernel registry (RFC-0965).</purpose>
  <keywords>e2e, cold, proving, RFC-0965, module</keywords>
  <non-goals>
    <item>Do not implement cold run logic — delegate to src/e2e/cold.ts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0965: initial werkstatt-e2e module registering werkstatt.e2e.cold.</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "../src/kernel/types.ts";
import type { ModuleExport } from "../src/runtime/desired-state.ts";
import { runColdE2e, type ColdRunReport } from "../src/e2e/cold.ts";

export const werkstattE2eModule: ModuleExport = {
  name: "werkstatt-e2e",
  version: "0.1.0",
  declarations: [],
  commands: [
    {
      name: "werkstatt.e2e.cold",
      contract: "werkstatt",
      rules: [],
      modulePath: "packages/werkstatt-engine/os/werkstatt-e2e-module.ts",
      description:
        "Cold end-to-end proving run: clone, install, scaffold, validate, release in a disposable temp directory (RFC-0965). Flags: --keep, --until, --with-deploy, --timeout-minutes, --json.",
      scope: "workspace",
      supportsAllSites: false,
      longRunning: true,
      cacheable: false,
      flags: {
        keep: {
          kind: "boolean",
          description: "Keep the temp directory for debugging (default: delete on success)",
        },
        until: {
          kind: "string",
          description: "Pipeline phase to run to: closed (default) or dev",
          required: false,
        },
        "with-deploy": {
          kind: "boolean",
          description: "Continue to leitstand.ship --until dev (requires CF secrets in env)",
        },
        "timeout-minutes": {
          kind: "string",
          description: "Total timeout in minutes (default: 90)",
        },
        json: { kind: "boolean", description: "Output report as JSON" },
      },
      reads: [],
      async execute(
        input: KernelCommandInput,
        context: KernelRuntimeContext,
      ): Promise<KernelCommandResult<ColdRunReport>> {
        return runColdE2e(input, context);
      },
    },
  ],
  pipelines: [],
};
