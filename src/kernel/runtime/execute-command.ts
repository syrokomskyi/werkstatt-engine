/*
<MODULE_CONTRACT>
<purpose>
Single-command execution: run a registered KernelCommandDefinition against its resolved
runtime context (flags resolution, WorkspaceIO adapter selection, optional timeout race,
RFC-0086 failure diagnostic printing), and the public executeKernelCommand entry point that
resolves a workspace-scoped or app-scoped command from CLI options and runs it.
</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0303: split out of runtime.ts (Phase 3 file-size split, hot-path file 8/8).</item>
  <item>RFC-0326: extract intents from createDefaultIO() and surface as filesModified on the execution report for both real and dry runs.</item>
  <item>RFC-0579: propagate nextSteps from KernelCommandResult to KernelExecutionReport and render as "Next steps:" block in pretty mode.</item>
  <item>RFC-0635: inject force from context into input.flags.force so command handlers can read --force without declaring it in their flag schema.</item>
  <item>ADR-0022: workspace registry now uses process-lifetime cache via getOrBuildWorkspaceRegistry.</item>
  <item>RFC-0842: add assertAllSitesAllowed guard — rejects --all for commands where supportsAllSites is not true (covers false and undefined).</item>
  <item>RFC-0870: add pipeline hint to not-registered and no-target-site error messages.</item>
</CHANGE_SUMMARY>
*/

import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { createKernelLogger } from "../logger.ts";
import { pipelineHint } from "../pipeline-hint.ts";
import { loadWorkspaceConfig, loadKernelAppConfig } from "../discovery.ts";
import {
  createDefaultIO,
  createRecordingIO,
  createReadOnlyIO,
  type WriteIntent,
} from "../workspace-io.ts";
import type {
  CheckResult,
  ExecuteKernelCommandOptions,
  KernelCommandDefinition,
  KernelCommandInput,
  KernelExecutionReport,
  KernelRuntimeContext,
} from "../types.ts";
import { parse as yamlParse } from "yaml";
import { parseKernelArgv, resolveCommandFlags } from "./argv.ts";
import { formatFailureDiagnostics } from "./diagnostics.ts";
import { assertKnownOptionKeys, summarizeLogs } from "./shared.ts";
import { buildRegistryForModule, ensureTargetSites, loadAppRuntime } from "./registry.ts";
import { getOrBuildWorkspaceRegistry } from "./registry-cache.ts";
import { getFactoryTelemetryPusher, recordCommandTelemetry } from "./telemetry.ts";
import { manifestFilePath, type CommandManifest } from "../command-manifest.ts";

class KernelCommandTimeoutError extends Error {
  constructor(
    readonly commandName: string,
    readonly timeoutMs: number,
  ) {
    super(`Kernel command timed out after ${timeoutMs}ms: ${commandName}`);
    this.name = "KernelCommandTimeoutError";
  }
}

/**
 * RFC-0326: convert WriteIntent[] (absolute paths) to a deduplicated
 * string[] of workspace-root-relative POSIX paths for the filesModified
 * field on KernelExecutionReport.
 */
function intentsToFilesModified(intents: WriteIntent[], workspaceRoot: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const intent of intents) {
    const rel = relative(workspaceRoot, intent.path).replace(/\\/g, "/");
    if (!seen.has(rel)) {
      seen.add(rel);
      result.push(rel);
    }
  }
  return result;
}

export async function executeRegisteredCommand(
  command: KernelCommandDefinition,
  context: KernelRuntimeContext,
  argv: string[],
  timingMetadata?: { timeoutMs?: number; expectedDurationMs?: number },
): Promise<KernelExecutionReport> {
  const logger = context.logger;
  const timeoutMs = timingMetadata?.timeoutMs ?? command.timeoutMs;
  const expectedDurationMs = timingMetadata?.expectedDurationMs ?? command.expectedDurationMs;
  const startedAt = performance.now();

  function timing(exceededTimeout = false) {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    return {
      durationMs,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(expectedDurationMs !== undefined ? { expectedDurationMs } : {}),
      exceededTimeout,
    };
  }

  // RFC-0260: schema-carrying commands resolve flags strictly and abort before
  // execute() runs when resolution reports an error diagnostic. Schema-less
  // commands keep the legacy heuristic parse path, but RFC-0609 adds KERNEL-ARG-01
  // diagnostics for positional tokens on both paths.
  let input: KernelCommandInput;
  if (command.flags) {
    const resolved = resolveCommandFlags(argv, command);
    const errorDiagnostics = resolved.diagnostics.filter((d) => d.severity === "error");
    if (errorDiagnostics.length > 0) {
      const data: CheckResult = {
        command: command.name,
        status: "fail",
        diagnostics: resolved.diagnostics,
        summary: {
          error: errorDiagnostics.length,
          warning: resolved.diagnostics.length - errorDiagnostics.length,
          info: 0,
        },
      };
      const summary = `[${command.name}] ${errorDiagnostics.length} flag error${errorDiagnostics.length === 1 ? "" : "s"}`;
      logger.error(summary);
      for (const line of formatFailureDiagnostics(data)) {
        logger.error(line);
      }
      const logs = logger.getEvents();
      return {
        siteName: context.site?.name,
        commandName: command.name,
        data,
        exitCode: 1,
        ok: false,
        summary,
        nextSteps: [
          { action: `Fix the flag errors for ${command.name} and re-run`, kind: "required" },
        ],
        metadata: command,
        logs,
        logSummary: summarizeLogs(logs),
        timing: timing(false),
        filesModified: [],
      };
    }
    input = { argv: [...argv], flags: resolved.flags };
  } else {
    const parsed = parseKernelArgv(argv);
    const errorDiagnostics = parsed.diagnostics.filter((d) => d.severity === "error");
    if (errorDiagnostics.length > 0) {
      const data: CheckResult = {
        command: command.name,
        status: "fail",
        diagnostics: parsed.diagnostics,
        summary: {
          error: errorDiagnostics.length,
          warning: parsed.diagnostics.length - errorDiagnostics.length,
          info: 0,
        },
      };
      const summary = `[${command.name}] ${errorDiagnostics.length} argument error${errorDiagnostics.length === 1 ? "" : "s"}`;
      logger.error(summary);
      for (const line of formatFailureDiagnostics(data)) {
        logger.error(line);
      }
      const logs = logger.getEvents();
      return {
        siteName: context.site?.name,
        commandName: command.name,
        data,
        exitCode: 1,
        ok: false,
        summary,
        nextSteps: [
          { action: `Fix the argument errors for ${command.name} and re-run`, kind: "required" },
        ],
        metadata: command,
        logs,
        logSummary: summarizeLogs(logs),
        timing: timing(false),
        filesModified: [],
      };
    }
    input = { argv: parsed.argv, flags: parsed.flags };
  }

  // RFC-0635: inject force from context into input.flags so command handlers
  // can read input.flags.force without declaring it in their flag schema.
  if (context.force) {
    input.flags.force = true;
  }

  // RFC-0267: select the WorkspaceIO adapter for this invocation. A command
  // declaring mutatesState: false always gets a throwing read-only adapter,
  // regardless of --dry-run, so the metadata is provably trustworthy. A
  // mutating command under --dry-run gets a recording adapter instead — its
  // intents are surfaced on the report without touching disk. Ambient
  // node:fs imports inside an unmigrated command module bypass this port
  // entirely (adoption is ratcheted); ratchet completion is tracked by
  // kernel.io.lint (IO-01).
  //
  // RFC-0326: for real (non-dry-run) mutating commands, the context's
  // fileIntents (captured by createDefaultIO's tracing wrapper) are surfaced
  // as filesModified on the report. For dry-run commands, the recording
  // adapter's intents are used instead.
  let capturedIntents: WriteIntent[] | undefined;
  let effectiveIo = context.io;
  if (command.mutatesState === false) {
    effectiveIo = createReadOnlyIO(context.io, command.name);
  } else if (context.dryRun) {
    const recording = createRecordingIO(context.io);
    effectiveIo = recording.io;
    capturedIntents = recording.intents;
  } else {
    // Real run — use context.fileIntents (from createDefaultIO's tracing).
    capturedIntents = context.fileIntents;
  }
  const executionContext: KernelRuntimeContext =
    effectiveIo === context.io ? context : { ...context, io: effectiveIo };

  async function runWithOptionalTimeout() {
    const execution = Promise.resolve(command.execute(input, executionContext));
    if (timeoutMs === undefined || timeoutMs <= 0) return execution;

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new KernelCommandTimeoutError(command.name, timeoutMs)),
        timeoutMs,
      );
      timer.unref?.();
    });

    try {
      return await Promise.race([execution, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  if (command.mutatesState && context.dryRun) {
    logger.warn(
      `Dry-run: \`${command.name}\` writes routed through context.io are recorded, not persisted. Caveat: ambient node:fs in unmigrated command modules is NOT intercepted (RFC-0267 ratchet).`,
    );
  }

  try {
    const result = await runWithOptionalTimeout();
    const exitCode = result?.exitCode ?? 0;
    const logs = logger.getEvents();
    // RFC-0326: surface filesModified from captured intents (both real and
    // dry runs). The legacy writeIntents-in-data field is replaced by the
    // top-level filesModified field on the report.
    const filesModified = capturedIntents
      ? intentsToFilesModified(capturedIntents, context.workspaceRoot)
      : [];
    const report: KernelExecutionReport = {
      siteName: context.site?.name,
      commandName: command.name,
      data: result?.data,
      exitCode,
      ok: exitCode === 0,
      summary: result?.summary,
      metadata: command,
      logs,
      logSummary: summarizeLogs(logs),
      timing: result?.timing ?? timing(false),
      nextSteps: result?.nextSteps,
      filesModified,
    };

    if (report.ok && report.summary) {
      const errorCount = report.logSummary?.error ?? 0;
      const warnCount = report.logSummary?.warning ?? 0;
      if (errorCount > 0) {
        logger.error(report.summary);
      } else if (warnCount > 0) {
        logger.warn(report.summary);
      } else {
        logger.success(report.summary);
      }
    } else if (!report.ok) {
      if (report.summary) logger.error(report.summary);
      const formatted = formatFailureDiagnostics(report.data);
      for (const line of formatted) {
        logger.error(line);
      }
    }

    // RFC-0579: render nextSteps as a "Next steps:" block in pretty mode.
    if (context.outputFormat !== "json" && report.nextSteps && report.nextSteps.length > 0) {
      console.log("\nNext steps:");
      for (const step of report.nextSteps) {
        const prefix = step.kind === "required" ? "*" : " ";
        console.log(`  ${prefix} ${step.action}`);
      }
    }

    // RFC-0340: record factory telemetry (no-op when pusher is null)
    const pusher = getFactoryTelemetryPusher();
    if (pusher) recordCommandTelemetry(pusher, report);

    return report;
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    const exceededTimeout = error instanceof KernelCommandTimeoutError;
    logger.error(
      exceededTimeout
        ? `Kernel command timed out: ${command.name}`
        : `Kernel command failed: ${command.name}`,
      message,
    );

    const logs = logger.getEvents();
    const errorReport: KernelExecutionReport = {
      siteName: context.site?.name,
      commandName: command.name,
      exitCode: 1,
      ok: false,
      metadata: command,
      logs,
      logSummary: summarizeLogs(logs),
      summary: message,
      timing: timing(exceededTimeout),
      filesModified: [],
    };

    // RFC-0340: record factory telemetry for failed/timed-out commands
    const pusher = getFactoryTelemetryPusher();
    if (pusher) recordCommandTelemetry(pusher, errorReport);

    return errorReport;
  }
}

/**
 * RFC-0842: Guard that rejects --all for commands where supportsAllSites is not true.
 * Covers both `false` (explicit opt-out) and `undefined` (safer default — reject).
 * Exported for unit testing.
 */
export function assertAllSitesAllowed(command: KernelCommandDefinition, allSites: boolean): void {
  if (allSites && command.supportsAllSites !== true) {
    throw new Error(
      `Command '${command.name}' does not support --all (supportsAllSites is not true). ` +
        `Use --site <siteId> to target a specific site.`,
    );
  }
}

const EXECUTE_KERNEL_COMMAND_OPTION_KEYS = [
  "workspaceRoot",
  "commandName",
  "siteName",
  "allSites",
  "argv",
  "dryRun",
  "force",
  "outputFormat",
  "siteExplicit",
];

export async function executeKernelCommand(
  options: ExecuteKernelCommandOptions,
): Promise<KernelExecutionReport | KernelExecutionReport[]> {
  assertKnownOptionKeys(
    options,
    EXECUTE_KERNEL_COMMAND_OPTION_KEYS,
    "executeKernelCommand options",
  );
  const outputFormat = options.outputFormat ?? "pretty";
  const argv = options.argv ?? [];

  // Always check the workspace-level config first. Workspace-scoped commands
  // (scope: "workspace") must be resolved from the root tools/kernel.config.ts,
  // not from an app-scoped config. This must happen even when --site is given,
  // because workspace commands like lagebild.tenant.add use --site as a
  // command-level parameter, not as a site selector.
  //
  // App-scoped commands (scope: "app") that are ALSO registered in the workspace
  // registry (e.g. via createStandardCheckModule) are executed directly with the
  // resolved site context, avoiding a full site registry build that would eagerly
  // load all site modules via tsImport.
  let wsCommand: KernelCommandDefinition | undefined;
  {
    const workspaceConfig = await loadWorkspaceConfig(options.workspaceRoot);
    if (workspaceConfig) {
      let wsRegistry;

      if (workspaceConfig.moduleLoaders) {
        let moduleName: string | undefined;
        try {
          const manifestRaw = await readFile(manifestFilePath(options.workspaceRoot), "utf-8");
          const manifest = yamlParse(manifestRaw) as CommandManifest;
          const entry = manifest.commands.find(
            (c) => c.name === options.commandName && c.provider === "workspace",
          );
          moduleName = entry?.module ?? undefined;
        } catch {
          // Manifest missing or unreadable — fall back to full registry build
        }

        if (moduleName) {
          wsRegistry = await buildRegistryForModule(workspaceConfig, moduleName);
          wsCommand = wsRegistry.getCommand(options.commandName);
        }
      }

      if (!wsCommand) {
        wsRegistry = await getOrBuildWorkspaceRegistry(options.workspaceRoot);
        wsCommand = wsRegistry?.getCommand(options.commandName);
      }

      if (wsCommand && wsCommand.scope === "workspace") {
        assertAllSitesAllowed(wsCommand, options.allSites ?? false);
        const logger = createKernelLogger(outputFormat);
        const { io, intents } = createDefaultIO();
        const context: KernelRuntimeContext = {
          workspaceRoot: options.workspaceRoot,
          site: undefined,
          siteExplicit: false,
          logger,
          dryRun: options.dryRun ?? false,
          force: options.force ?? false,
          outputFormat,
          io,
          fileIntents: intents,
        };
        if (outputFormat === "pretty") {
          logger.section(`workspace: ${wsCommand.name}`);
        }
        // Re-inject --site into argv for workspace commands that declare it
        // as a command-level flag (e.g. lagebild.tenant.add). The CLI layer
        // consumes --site as a common flag for site selection, but workspace
        // commands need it in their argv for flag resolution.
        const wsArgv = [...argv];
        if (options.siteName && !wsArgv.some((a) => a === "--site" || a.startsWith("--site="))) {
          wsArgv.push("--site", options.siteName);
        }
        // RFC-0814: Auto-inject --system for workspace-scoped commands that accept it.
        // The system ID is the same as the site name (RFC-0790 1:1 convention).
        // RFC-0817: Use pattern matching to detect both --system and --system=value formats.
        if (
          options.siteName &&
          !wsArgv.some((a) => a === "--system" || a.startsWith("--system="))
        ) {
          const acceptsSystem =
            !wsCommand.flags ||
            ("system" in wsCommand.flags && wsCommand.flags.system.kind === "string");
          if (acceptsSystem) {
            wsArgv.push("--system", options.siteName);
          }
        }
        return executeRegisteredCommand(wsCommand, context, wsArgv);
      }
    }
  }

  const targetSites = await ensureTargetSites(
    options.workspaceRoot,
    options.allSites ?? false,
    options.siteName,
  );

  if (targetSites.length === 0) {
    throw new Error(
      `No target site with a kernel config could be resolved.${pipelineHint(options.commandName)}`,
    );
  }

  const reports: KernelExecutionReport[] = [];

  // Fast path: wsCommand was found in the workspace registry and is app-scoped.
  // Execute it directly with the resolved site context, skipping the full site
  // registry build. This avoids eagerly loading all site modules via tsImport
  // for commands that are already available from the workspace registry (the
  // vast majority of app-scoped commands from createStandardCheckModule).
  if (wsCommand) {
    assertAllSitesAllowed(wsCommand, options.allSites ?? false);
    for (const site of targetSites) {
      const logger = createKernelLogger(outputFormat);
      const { io, intents } = createDefaultIO();
      const context: KernelRuntimeContext = {
        workspaceRoot: options.workspaceRoot,
        site,
        siteExplicit: options.siteExplicit ?? false,
        logger,
        dryRun: options.dryRun ?? false,
        force: options.force ?? false,
        outputFormat,
        io,
        fileIntents: intents,
      };

      if (outputFormat === "pretty") {
        logger.section(`${site.name}: ${wsCommand.name}`);
      }

      reports.push(await executeRegisteredCommand(wsCommand, context, argv));
    }

    return options.allSites ? reports : reports[0]!;
  }

  // Fallback: command was not found in the workspace registry. Load the site
  // registry (which may register site-specific commands like extraCommands).
  // Try manifest-driven single-module loading first to avoid loading all site
  // modules; fall back to full registry build if the manifest is missing/stale.
  let siteManifestModule: string | undefined;
  try {
    const manifestRaw = await readFile(manifestFilePath(options.workspaceRoot), "utf-8");
    const manifest = yamlParse(manifestRaw) as CommandManifest;
    const entry = manifest.commands.find((c) => c.name === options.commandName);
    siteManifestModule = entry?.module ?? undefined;
  } catch {
    // Manifest missing or unreadable — fall back to full registry build
  }

  for (const site of targetSites) {
    let command: KernelCommandDefinition | undefined;
    const siteConfig = await loadKernelAppConfig(site);

    if (siteConfig.moduleLoaders && siteManifestModule) {
      const registry = await buildRegistryForModule(siteConfig, siteManifestModule);
      command = registry.getCommand(options.commandName);
    }

    if (!command) {
      const { registry } = await loadAppRuntime(options.workspaceRoot, site);
      command = registry.getCommand(options.commandName);
    }

    if (!command) {
      throw new Error(
        `Kernel command \`${options.commandName}\` is not registered for site \`${site.name}\`.${pipelineHint(options.commandName)}`,
      );
    }

    assertAllSitesAllowed(command, options.allSites ?? false);

    const logger = createKernelLogger(outputFormat);
    const { io, intents } = createDefaultIO();
    const context: KernelRuntimeContext = {
      workspaceRoot: options.workspaceRoot,
      site,
      siteExplicit: options.siteExplicit ?? false,
      logger,
      dryRun: options.dryRun ?? false,
      force: options.force ?? false,
      outputFormat,
      io,
      fileIntents: intents,
    };

    if (outputFormat === "pretty") {
      logger.section(`${site.name}: ${command.name}`);
    }

    reports.push(await executeRegisteredCommand(command, context, argv));
  }

  return options.allSites ? reports : reports[0]!;
}
