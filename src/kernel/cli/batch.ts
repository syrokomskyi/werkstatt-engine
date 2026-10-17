/*
<MODULE_CONTRACT>
<purpose>batch execution for werkstatt run — load a command manifest, execute each entry sequentially through executeKernelCommand in one process boot, aggregate per-entry results, and emit pretty or JSON output.</purpose>
<non-goals>
  <item>Do not parse command-declared flags — entry argv tails flow through executeKernelCommand unchanged.</item>
  <item>Do not run entries in parallel — sequential execution only (DNA-105 isolation, one context per entry).</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>The executor is injectable so tests can verify sequencing and aggregation without a real registry.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1309: new batch runner — manifest loading (run/argv entry forms), per-entry flag override through consumeCommonFlags, stop-on-fail, aggregate exit codes, JSON payload per RFC-0972.</item>
</CHANGE_SUMMARY>
*/

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as yamlParse } from "yaml";
import type {
  ExecuteKernelCommandOptions,
  KernelExecutionReport,
} from "@warpgogol/werkstatt-shared/kernel";
import { consumeCommonFlags, printFilesModified } from "./flags.ts";

/** Usage-level failure — manifests that are missing, unparseable, or shape-invalid. */
export class BatchUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchUsageError";
  }
}

export interface BatchEntryResult {
  run: string;
  status: "pass" | "fail" | "error";
  exitCode: number;
  summary?: string;
}

export interface BatchReport {
  command: "werkstatt.run.batch";
  status: "pass" | "fail";
  results: BatchEntryResult[];
}

export interface BatchGlobals {
  siteName?: string;
  allSites?: boolean;
  dryRun?: boolean;
  force?: boolean;
  quiet?: boolean;
  stopOnFail?: boolean;
  outputFormat?: "pretty" | "json";
}

export type BatchExecutor = (
  options: ExecuteKernelCommandOptions,
) => Promise<KernelExecutionReport | KernelExecutionReport[]>;

export interface BatchRunOutcome {
  report: BatchReport;
  /** Aggregate exit code for pretty mode; JSON mode always exits 0 (RFC-0972). */
  exitCode: number;
}

interface BatchManifestEntry {
  run?: unknown;
  argv?: unknown;
}

/** Reject `--batch` combined with a positional command name (RFC-1309). */
export function assertBatchHasNoPositional(remaining: string[]): void {
  if (remaining.length > 0) {
    throw new BatchUsageError(
      `--batch cannot be combined with a positional command name (got \`${remaining[0]}\`).`,
    );
  }
}

function entryLabel(tokens: string[]): string {
  return tokens.join(" ");
}

function entryTokens(entry: BatchManifestEntry, index: number): string[] {
  const hasRun = typeof entry.run === "string";
  const hasArgv = Array.isArray(entry.argv);
  if (hasRun === hasArgv) {
    throw new BatchUsageError(
      `batch manifest entry ${index} must provide exactly one of \`run\` (string) or \`argv\` (array).`,
    );
  }
  if (hasArgv) {
    const argv = entry.argv as unknown[];
    if (argv.length === 0 || !argv.every((token) => typeof token === "string")) {
      throw new BatchUsageError(`batch manifest entry ${index} has a malformed \`argv\` array.`);
    }
    return argv as string[];
  }
  const tokens = (entry.run as string).split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) {
    throw new BatchUsageError(`batch manifest entry ${index} has an empty \`run\` string.`);
  }
  return tokens;
}

async function loadManifest(manifestPath: string): Promise<BatchManifestEntry[]> {
  const resolved = resolve(manifestPath);
  let raw: string;
  try {
    raw = await readFile(resolved, "utf-8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BatchUsageError(`cannot read batch manifest \`${manifestPath}\`: ${detail}`);
  }
  let parsed: unknown;
  try {
    parsed = yamlParse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BatchUsageError(
      `batch manifest \`${manifestPath}\` is not valid YAML/JSON: ${detail}`,
    );
  }
  const commands =
    parsed !== null && typeof parsed === "object"
      ? (parsed as { commands?: unknown }).commands
      : undefined;
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new BatchUsageError(
      `batch manifest \`${manifestPath}\` must declare a non-empty \`commands\` array.`,
    );
  }
  for (const [index, entry] of commands.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new BatchUsageError(`batch manifest entry ${index} must be an object.`);
    }
  }
  return commands as BatchManifestEntry[];
}

/**
 * Execute every manifest entry sequentially in this process. The process-lifetime
 * registry cache inside executeKernelCommand (ADR-0022) amortizes the boot across
 * entries — the runner itself performs no caching.
 */
export async function runBatch(options: {
  workspaceRoot: string;
  manifestPath: string;
  globals: BatchGlobals;
  execute: BatchExecutor;
}): Promise<BatchRunOutcome> {
  const { workspaceRoot, manifestPath, globals, execute } = options;
  const entries = await loadManifest(manifestPath);
  const outputFormat = globals.outputFormat ?? "pretty";
  const results: BatchEntryResult[] = [];
  let firstFailureExitCode: number | undefined;

  for (const [index, entry] of entries.entries()) {
    const tokens = entryTokens(entry, index);
    const label = entryLabel(tokens);
    const parsed = consumeCommonFlags(tokens);
    const [commandName, ...argv] = parsed.remaining;
    if (!commandName) {
      throw new BatchUsageError(`batch manifest entry ${index} resolves to no command name.`);
    }

    if (outputFormat === "pretty") {
      console.log(`=== ${label} ===`);
    }

    let exitCode: number;
    let summary: string | undefined;
    let status: BatchEntryResult["status"];
    try {
      const report = await execute({
        workspaceRoot,
        commandName,
        argv,
        siteName: parsed.siteName ?? globals.siteName,
        siteExplicit: parsed.siteName !== undefined || globals.siteName !== undefined,
        allSites: parsed.allSites || (globals.allSites ?? false),
        dryRun: parsed.dryRun || (globals.dryRun ?? false),
        force: parsed.force || (globals.force ?? false),
        quiet: parsed.quiet || (globals.quiet ?? false),
        outputFormat: parsed.outputFormat !== "pretty" ? parsed.outputFormat : outputFormat,
      });
      const reports = Array.isArray(report) ? report : [report];
      const failedReport = reports.find((r) => !r.ok);
      exitCode = failedReport?.exitCode ?? 0;
      summary = reports[0]?.summary;
      status = exitCode === 0 ? "pass" : "fail";
      for (const entryReport of reports) {
        printFilesModified(entryReport, outputFormat);
      }
    } catch (error) {
      // Unknown command names and resolution failures record as entry errors;
      // the batch continues unless --stop-on-fail.
      exitCode = 1;
      summary = error instanceof Error ? error.message : String(error);
      status = "error";
      if (outputFormat === "pretty") {
        console.error(`[batch] ${label} — error: ${summary}`);
      }
    }

    results.push({ run: label, status, exitCode, ...(summary ? { summary } : {}) });
    if (exitCode !== 0 && firstFailureExitCode === undefined) {
      firstFailureExitCode = exitCode;
    }
    if (exitCode !== 0 && globals.stopOnFail) {
      break;
    }
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failedEntries = results.filter((r) => r.status !== "pass");
  const report: BatchReport = {
    command: "werkstatt.run.batch",
    status: failedEntries.length === 0 ? "pass" : "fail",
    results,
  };

  if (outputFormat === "pretty") {
    console.log(`[batch] ${passed}/${results.length} commands passed`);
    for (const failed of failedEntries) {
      console.log(`[batch] failed: ${failed.run} (exit ${failed.exitCode})`);
    }
  }

  return { report, exitCode: firstFailureExitCode ?? 0 };
}
