/*
<MODULE_CONTRACT>
<purpose>Facilitates command-line interactions for managing kernel applications and executing commands within a workspace.</purpose>
<non-goals>
  <item>Do not handle raw input validation beyond flag parsing.</item>
  <item>Do not manage application lifecycle or orchestration.</item>
  <item>Do not implement business logic for commands executed.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Return a JSON error envelope for top-level CLI exceptions when --json is requested.</item>
  <item>RFC-0686: add --concurrency flag for pipeline execution.</item>
  <item>ADR-0022: add --no-registry-cache flag to disable process-lifetime registry cache.</item>
  <item>RFC-0870: add pipeline hint to Unknown command and not-registered error messages.</item>
</CHANGE_SUMMARY>
*/

import "dotenv/config";
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
// @ai-invariant: CLI execution must route through registered kernel commands and preserve typed flag parsing.

function argvRequestsHelp(argv: string[]): boolean {
  return argv.some((entry) => entry === "--help" || entry === "-h");
}

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

function consumeCommonFlags(argv: string[]) {
  const remaining: string[] = [];
  let siteName: string | undefined;
  let allSites = false;
  let dryRun = false;
  let force = false;
  let noRegistryCache = false;
  let concurrency: number | undefined;
  let collectErrors = false;
  let outputFormat: "pretty" | "json" = "pretty";

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];

    if (entry === "--site") {
      siteName = argv[index + 1];
      index += 1;
      continue;
    }

    if (entry.startsWith("--site=")) {
      siteName = entry.slice("--site=".length);
      continue;
    }

    if (entry === "--all" || entry === "--all=true" || entry === "--all=1") {
      allSites = true;
      continue;
    }

    if (entry === "--dry-run" || entry === "--dry-run=true" || entry === "--dry-run=1") {
      dryRun = true;
      continue;
    }

    if (entry === "--force" || entry === "--force=true" || entry === "--force=1") {
      force = true;
      continue;
    }

    if (
      entry === "--no-registry-cache" ||
      entry === "--no-registry-cache=true" ||
      entry === "--no-registry-cache=1"
    ) {
      noRegistryCache = true;
      continue;
    }

    if (entry === "--json" || entry === "--json=true" || entry === "--json=1") {
      outputFormat = "json";
      continue;
    }

    if (
      entry === "--collect-errors" ||
      entry === "--collect-errors=true" ||
      entry === "--collect-errors=1"
    ) {
      collectErrors = true;
      continue;
    }

    if (entry === "--concurrency") {
      const value = argv[index + 1];
      const parsed = Number.parseInt(value ?? "", 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        concurrency = parsed;
        index += 1;
      }
      continue;
    }

    if (entry.startsWith("--concurrency=")) {
      const parsed = Number.parseInt(entry.slice("--concurrency=".length), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        concurrency = parsed;
      }
      continue;
    }

    remaining.push(entry);
  }

  return {
    siteName,
    allSites,
    dryRun,
    force,
    noRegistryCache,
    concurrency,
    collectErrors,
    outputFormat,
    remaining,
  };
}

function printUsage() {
  console.log("werkstatt sites list [--json]");
  console.log(
    "werkstatt run <command> [--site <name>] [--all] [--dry-run] [--no-registry-cache] [--json] [-- ...args]",
  );
  console.log(
    "werkstatt pipeline <name> [--site <name>] [--all] [--dry-run] [--force] [--no-registry-cache] [--concurrency N] [--collect-errors] [--json]",
  );
}

function argvRequestsJson(argv: string[]): boolean {
  return argv.some(
    (entry) => entry === "--json" || entry === "--json=true" || entry === "--json=1",
  );
}

/**
 * RFC-0326: print a `[Modified N file(s): ...] Re-read before editing.` line
 * to stdout in pretty mode when the report has a non-empty filesModified array.
 * In JSON mode, filesModified is already a top-level field on the report — no
 * extra printing needed.
 */
function printFilesModified(
  report: { filesModified?: string[] },
  outputFormat: "pretty" | "json",
): void {
  if (outputFormat === "json") return;
  const files = report.filesModified;
  if (!files || files.length === 0) return;
  console.log(`[Modified ${files.length} file(s): ${files.join(", ")}] Re-read before editing.`);
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

async function main() {
  const workspaceRoot = await findWorkspaceRoot();
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
    const { siteName, allSites, dryRun, force, outputFormat, remaining } = consumeCommonFlags(rest);
    const [commandName, ...argv] = remaining;
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
    process.exitCode = failed?.exitCode ?? 0;
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
    process.exitCode = failed?.exitCode ?? 0;
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
