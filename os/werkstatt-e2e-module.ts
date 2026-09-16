/*
<MODULE_CONTRACT>
  <purpose>Register the werkstatt.e2e.cold command with the kernel registry and module loader (RFC-0965).</purpose>

  <non-goals>
    <item>Do not implement cold run logic — delegate to src/e2e/cold.ts.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0965: initial werkstatt-e2e module registering werkstatt.e2e.cold.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
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
