/*
<MODULE_CONTRACT>
<purpose>cli index — command-line interactions for managing kernel applications and executing commands.</purpose>
<non-goals>
  <item>Do not handle raw input validation beyond flag parsing.</item>
  <item>Do not manage application lifecycle or orchestration.</item>
  <item>Do not implement business logic for commands executed.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>CLI execution must route through registered kernel commands and preserve typed flag parsing.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0870: add pipeline hint to Unknown command and not-registered error messages.</item>
  <item>RFC-0972: global --json exit code policy — always exit 0 when outputFormat is json.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1326: single Cloudflare permission registry, token preflight, birth provisioning</item>
  <history>ADR-0022, RFC-0686</history>
</CHANGE_SUMMARY>
*/

import process from "node:process";
import {
  buildCommandManifest,
  executeKernelCommand,
  executeKernelPipeline,
  findWorkspaceRoot,
  listSiteWorkspaces,
} from "../index.ts";
import { setRegistryCacheEnabled } from "../runtime/registry-cache.ts";
import { flushFactoryTelemetry } from "../runtime/telemetry.ts";
import { pipelineHint } from "../pipeline-hint.ts";
import {
  argvRequestsHelp,
  argvRequestsJson,
  consumeCommonFlags,
  printFilesModified,
  printUsage,
} from "./flags.ts";
import { assertBatchHasNoPositional, BatchUsageError, runBatch } from "./batch.ts";
import { loadWorkshopEnvAllowlisted } from "../workshop-env.ts";
// @ai-invariant: CLI execution must route through registered kernel commands and preserve typed flag parsing.

/** RFC-0266: render one command's manifest entry (description + declared flags) for `--help`. */
async function printCommandHelp(workspaceRoot: string, commandName: string): Promise<void> {
  const manifest = await buildCommandManifest(workspaceRoot);
  const entry = manifest.commands.find((command) => command.name === commandName);
  if (!entry) {
    console.log(`Unknown command "${commandName}".${pipelineHint(commandName)}`);
    return;
  }
  console.log(`${entry.name} — ${entry.description}`);
  console.log(
    `  scope: ${entry.scope}  mutatesState: ${entry.mutatesState}  requiresNetwork: ${entry.requiresNetwork}`,
  );
  const flagNames = Object.keys(entry.flags);
  if (flagNames.length === 0) {
    console.log("  flags: (none declared)");
  } else {
    console.log("  flags:");
    for (const flagName of flagNames) {
      const flag = entry.flags[flagName]!;
      const requiredLabel = flag.required ? " (required)" : "";
      console.log(`    --${flagName} <${flag.kind}>${requiredLabel} — ${flag.description}`);
    }
  }
}

function printTopLevelError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (argvRequestsJson(process.argv.slice(2))) {
    console.log(
      JSON.stringify(
        {
          commandName: process.argv[3] ?? process.argv[2] ?? "werkstatt",
          exitCode: 1,
          ok: false,
          summary: message,
          logs: [],
        },
        null,
        2,
      ),
    );
    return;
  }

  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
}

export async function main() {
  const workspaceRoot = await findWorkspaceRoot();

  // RFC-1326: allow-listed workshop .env resolution replaces the blanket
  // dotenv/config import — only WORKSHOP_ENV_ALLOWLIST keys reach
  // process.env; site/service keys stay site-level via workpieceEnv.
  await loadWorkshopEnvAllowlisted(workspaceRoot);

  const [subcommand, ...rest] = process.argv.slice(2);

  // ADR-0022: --no-registry-cache disables the process-lifetime registry cache.
  // Must be set before any registry-building call.
  if (
    rest.some(
      (entry) =>
        entry === "--no-registry-cache" ||
        entry === "--no-registry-cache=true" ||
        entry === "--no-registry-cache=1",
    )
  ) {
    setRegistryCacheEnabled(false);
  }

  if (!subcommand) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (subcommand === "sites") {
    const [operation, ...argv] = rest;
    if (operation !== "list") {
      printUsage();
      process.exitCode = 1;
      return;
    }

    const { outputFormat } = consumeCommonFlags(argv);
    const result = await listSiteWorkspaces(workspaceRoot);
    if (outputFormat === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Workspace: ${result.workspaceRoot}`);
    for (const site of result.sites) {
      console.log(`- ${site.name}${site.configPath ? ` -> ${site.configPath}` : " -> no config"}`);
    }
    return;
  }

  if (subcommand === "run") {
    const { siteName, allSites, dryRun, force, quiet, batch, stopOnFail, outputFormat, remaining } =
      consumeCommonFlags(rest);
    const [commandName, ...argv] = remaining;

    // RFC-1309: --batch executes a manifest of commands in this one process;
    // it is mutually exclusive with a positional command name.
    if (batch !== undefined) {
      try {
        assertBatchHasNoPositional(commandName ? [commandName, ...argv] : []);
        const { report, exitCode } = await runBatch({
          workspaceRoot,
          manifestPath: batch,
          globals: {
            siteName,
            allSites,
            dryRun,
            force,
            quiet,
            stopOnFail,
            outputFormat,
          },
          execute: executeKernelCommand,
        });
        if (outputFormat === "json") {
          console.log(JSON.stringify(report, null, 2));
          process.exitCode = 0; // RFC-0972: JSON mode always exits 0
        } else {
          process.exitCode = exitCode;
        }
      } catch (error) {
        if (error instanceof BatchUsageError) {
          console.error(`usage error: ${error.message}`);
          process.exitCode = 1;
          return;
        }
        throw error;
      }
      return;
    }

    if (!commandName) {
      printUsage();
      process.exitCode = 1;
      return;
    }

    if (argvRequestsHelp(argv)) {
      await printCommandHelp(workspaceRoot, commandName);
      return;
    }

    const result = await executeKernelCommand({
      workspaceRoot,
      commandName,
      siteName,
      siteExplicit: siteName !== undefined,
      allSites,
      dryRun,
      force,
      quiet,
      outputFormat,
      argv,
    });

    if (outputFormat === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const reports = Array.isArray(result) ? result : [result];
      for (const report of reports) {
        printFilesModified(report, outputFormat);
      }
    }

    const allReports = Array.isArray(result) ? result : [result];
    const failed = allReports.find((report) => !report.ok);
    process.exitCode = outputFormat === "json" ? 0 : (failed?.exitCode ?? 0);
    return;
  }

  if (subcommand === "pipeline") {
    const {
      siteName,
      allSites,
      dryRun,
      force,
      concurrency,
      collectErrors,
      quiet,
      outputFormat,
      remaining: pipelineRemaining,
    } = consumeCommonFlags(rest);
    const [pipelineName] = pipelineRemaining;
    if (!pipelineName) {
      printUsage();
      process.exitCode = 1;
      return;
    }

    const result = await executeKernelPipeline({
      workspaceRoot,
      pipelineName,
      siteName,
      allSites,
      dryRun,
      force,
      quiet,
      outputFormat,
      ...(concurrency !== undefined ? { concurrency } : {}),
      ...(collectErrors ? { collectErrors: true } : {}),
    });

    if (outputFormat === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const reports = Array.isArray(result) ? result : [result];
      for (const report of reports) {
        printFilesModified(report, outputFormat);
      }
    }

    const allReports = Array.isArray(result) ? result : [result];
    const failed = allReports.find((report) => !report.ok);
    process.exitCode = outputFormat === "json" ? 0 : (failed?.exitCode ?? 0);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main()
  .catch((error) => {
    printTopLevelError(error);
    process.exitCode = 1;
  })
  .finally(() => flushFactoryTelemetry());
