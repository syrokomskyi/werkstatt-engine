/*
<MODULE_CONTRACT>
  <purpose>RFC-0883: Post-build-only validation command for fast iterative debugging. Runs SITES_CHECK_POSTBUILD_PIPELINE on an existing dist/ without a full rebuild.</purpose>
  <non-goals>
    <item>Do not run build.prepare, build.check, or Astro build — use mission.validate for the full pipeline.</item>
    <item>Do not replace mission.validate as the authoritative validation command.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0883: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import { access } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import type {
  DiscoveredSiteWorkspace,
  KernelCommandInput,
  KernelCommandResult,
  KernelExecutionReport,
  KernelPipelineReport,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  executeKernelCommand,
  executeKernelPipeline,
  loadAppRuntime,
  resolveSiteWorkspace,
} from "@warpgogol/werkstatt-engine/kernel";
import { readMissionManifest, resolveMissionDir } from "./mission-io.ts";

export interface ValidatePostbuildStepResult {
  name: string;
  status: "ok" | "fail" | "skip" | "warn";
  durationMs: number;
}

export interface ValidatePostbuildData {
  command: "validate.postbuild";
  status: "pass" | "fail";
  steps: ValidatePostbuildStepResult[];
  totalDurationMs: number;
  distPath: string;
}

const SLOW_STEPS = new Set([
  "mobile.layout.check",
  "lighthouse.budget.check",
  "qa.independent.run",
]);

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function stepStatusFromReport(report: KernelExecutionReport): "ok" | "fail" | "warn" {
  if (!report.ok) return "fail";
  const logSummary = report.logSummary;
  if (logSummary && logSummary.warning > 0) return "warn";
  return "ok";
}

export async function runValidatePostbuild(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ValidatePostbuildData>> {
  const { workspaceRoot, logger } = context;
  const missionId = flagString(input, "mission");
  const siteId = flagString(input, "site");
  const skipSlow = input.flags["skip-slow"] === true;

  if (!missionId && !siteId) {
    throw new Error("[validate.postbuild] --mission or --site is required");
  }

  let siteWorkspace: DiscoveredSiteWorkspace;
  let siteName: string;

  if (missionId) {
    const manifest = await readMissionManifest(workspaceRoot, missionId);
    const missionDir = resolveMissionDir(workspaceRoot, missionId);
    const workpieceDir = path.join(missionDir, "workpiece");
    siteName = manifest.systemId;
    siteWorkspace = {
      name: manifest.systemId,
      directory: workpieceDir,
      toolsDirectory: path.join(workpieceDir, "tools"),
      configPath: path.join(workpieceDir, "tools", "kernel.config.ts"),
    };
  } else {
    const sw = await resolveSiteWorkspace(workspaceRoot, siteId!);
    siteName = sw.name;
    siteWorkspace = sw;
  }

  const distPath = path.join(siteWorkspace.directory, "dist");
  try {
    await access(distPath);
  } catch {
    return {
      data: {
        command: "validate.postbuild",
        status: "fail",
        steps: [],
        totalDurationMs: 0,
        distPath,
      },
      exitCode: 1,
      summary: "No dist/ found — run mission.validate first to build the site.",
      nextSteps: [
        {
          action: "Run: pnpm exec werkstatt run mission.validate --mission <mission-id>",
          kind: "required",
        },
      ],
    };
  }

  logger.warn("dist/ may be stale — run mission.validate for a full check.");

  const startTime = performance.now();

  if (!skipSlow) {
    const result = await executeKernelPipeline({
      workspaceRoot,
      pipelineName: "sites-check.postbuild",
      siteName,
      outputFormat: "pretty",
      siteWorkspace,
    });
    const report: KernelPipelineReport = Array.isArray(result) ? result[0]! : result;
    const steps: ValidatePostbuildStepResult[] = report.steps.map((step) => ({
      name: step.commandName,
      status: stepStatusFromReport(step),
      durationMs: step.timing.durationMs,
    }));
    const totalDurationMs = Math.round(performance.now() - startTime);
    return {
      data: {
        command: "validate.postbuild",
        status: report.ok ? "pass" : "fail",
        steps,
        totalDurationMs,
        distPath,
      },
      exitCode: report.ok ? 0 : 1,
      summary: report.ok
        ? "All post-build validators passed."
        : `Post-build validation failed: ${report.timing.failedStep ?? "unknown step"}`,
      nextSteps: report.ok
        ? undefined
        : [
            {
              action: `Fix the failing post-build validator (${report.timing.failedStep ?? "unknown"}), then re-run: pnpm exec werkstatt run validate.postbuild --site ${siteName}`,
              kind: "required",
            },
          ],
    };
  }

  // Skip-slow mode: resolve steps from the registry and run individually.
  const { registry } = await loadAppRuntime(workspaceRoot, siteWorkspace);
  const pipelineSteps = registry.getPipeline("sites-check.postbuild");
  if (!pipelineSteps) {
    throw new Error(`Pipeline "sites-check.postbuild" is not registered for site "${siteName}".`);
  }

  const filteredSteps = pipelineSteps.filter((step) => !SLOW_STEPS.has(step.command));
  const stepResults: ValidatePostbuildStepResult[] = [];
  let allOk = true;

  for (const step of filteredSteps) {
    const stepStart = performance.now();
    try {
      const result = await executeKernelCommand({
        workspaceRoot,
        commandName: step.command,
        siteName,
        outputFormat: "pretty",
        argv: step.args ?? [],
      });
      const report: KernelExecutionReport = Array.isArray(result) ? result[0]! : result;
      const durationMs = Math.round(performance.now() - stepStart);
      stepResults.push({
        name: step.command,
        status: stepStatusFromReport(report),
        durationMs,
      });
      if (!report.ok) {
        allOk = false;
        logger.info(`  ${step.command} failed (exit ${report.exitCode})`);
      }
    } catch (err) {
      const durationMs = Math.round(performance.now() - stepStart);
      stepResults.push({
        name: step.command,
        status: "fail",
        durationMs,
      });
      allOk = false;
      logger.info(`  ${step.command} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const step of pipelineSteps) {
    if (SLOW_STEPS.has(step.command)) {
      stepResults.push({
        name: step.command,
        status: "skip",
        durationMs: 0,
      });
    }
  }

  const totalDurationMs = Math.round(performance.now() - startTime);
  return {
    data: {
      command: "validate.postbuild",
      status: allOk ? "pass" : "fail",
      steps: stepResults,
      totalDurationMs,
      distPath,
    },
    exitCode: allOk ? 0 : 1,
    summary: allOk
      ? "All post-build validators passed (slow steps skipped)."
      : "Post-build validation failed.",
    nextSteps: allOk
      ? undefined
      : [
          {
            action: `Fix the failing post-build validators above, then re-run: pnpm exec werkstatt run validate.postbuild --site ${siteName}`,
            kind: "required",
          },
        ],
  };
}
