/*
<MODULE_CONTRACT>
<purpose>
RFC-0963: compares fresh telemetry p95 against committed budgets in
docs/pipeline-budgets.generated.yaml. Returns BudgetViolation[] for breaches
and warnings for steps with no telemetry. Runs in platform CI after flagship
site build to catch regressions in validation pipeline timing.
</purpose>
<non-goals>
  <item>Do not auto-update budgets — use pipeline.budget.generate for that.</item>
  <item>Do not gate builds on budgets — exit code 1 signals violations but does not block.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0963: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import {
  parseTelemetryHistory,
  budgetsFilePath,
  telemetryFileSizeBytes,
  type StepTelemetryRecord,
  type StepBudget,
  type PipelineBudgetsFile,
} from "./pipeline-budgets.ts";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelNextStep,
  KernelRuntimeContext,
} from "./types.ts";

const TELEMETRY_RELATIVE_PATH = join(
  "node_modules",
  ".cache",
  "werkstatt",
  "telemetry",
  "steps.ndjson",
);

export interface BudgetViolation {
  rule: "BUDGET-01" | "BUDGET-02";
  pipeline: string;
  command: string;
  app: string | null;
  p95Ms: number;
  expectedDurationMs: number;
  thresholdMs: number;
  message: string;
}

export interface PipelineBudgetValidateResult {
  command: "pipeline.budget.validate";
  violations: BudgetViolation[];
  budgetCount: number;
  telemetrySamples: number;
  checkedCount: number;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const index = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, index)]!;
}

function computeP95PerStep(records: StepTelemetryRecord[]): Map<string, number> {
  const groups = new Map<string, number[]>();
  for (const record of records) {
    const key = `${record.pipeline}\u0000${record.command}\u0000${record.app ?? ""}`;
    const arr = groups.get(key) ?? [];
    arr.push(record.durationMs);
    groups.set(key, arr);
  }
  const p95Map = new Map<string, number>();
  for (const [key, durations] of groups) {
    const sorted = durations.sort((a, b) => a - b);
    p95Map.set(key, percentile(sorted, 95));
  }
  return p95Map;
}

export async function runPipelineBudgetValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<PipelineBudgetValidateResult>> {
  const siteFilter = typeof input.flags["site"] === "string" ? input.flags["site"] : null;
  const tolerance =
    typeof input.flags["tolerance"] === "string" ? parseFloat(input.flags["tolerance"]) : 1.5;

  // Load committed budgets
  let budgets: StepBudget[] = [];
  try {
    const raw = await readFile(budgetsFilePath(context.workspaceRoot), "utf8");
    const parsed = yamlParse(raw) as PipelineBudgetsFile;
    if (Array.isArray(parsed.budgets)) {
      budgets = parsed.budgets;
    }
  } catch {
    return {
      data: {
        command: "pipeline.budget.validate",
        violations: [],
        budgetCount: 0,
        telemetrySamples: 0,
        checkedCount: 0,
      },
      exitCode: 0,
      summary: "[pipeline.budget.validate] no committed budgets file found — skipping validation",
    };
  }

  if (budgets.length === 0) {
    return {
      data: {
        command: "pipeline.budget.validate",
        violations: [],
        budgetCount: 0,
        telemetrySamples: 0,
        checkedCount: 0,
      },
      exitCode: 0,
      summary: "[pipeline.budget.validate] budgets file is empty — nothing to validate",
    };
  }

  // Load fresh telemetry
  let telemetryRecords: StepTelemetryRecord[] = [];
  try {
    const raw = await readFile(join(context.workspaceRoot, TELEMETRY_RELATIVE_PATH), "utf8");
    telemetryRecords = parseTelemetryHistory(raw).records;
  } catch {
    // No telemetry — all budgets get BUDGET-02 warnings
  }

  // Filter by site if requested
  if (siteFilter) {
    telemetryRecords = telemetryRecords.filter((r) => r.app === siteFilter);
    budgets = budgets.filter((b) => b.app === siteFilter || b.app === null);
  }

  const p95Map = computeP95PerStep(telemetryRecords);
  const violations: BudgetViolation[] = [];
  let checkedCount = 0;

  for (const budget of budgets) {
    const key = `${budget.pipeline}\u0000${budget.command}\u0000${budget.app ?? ""}`;
    const p95 = p95Map.get(key);
    const thresholdMs = Math.round(budget.expectedDurationMs * tolerance);
    checkedCount++;

    if (p95 === undefined) {
      violations.push({
        rule: "BUDGET-02",
        pipeline: budget.pipeline,
        command: budget.command,
        app: budget.app,
        p95Ms: 0,
        expectedDurationMs: budget.expectedDurationMs,
        thresholdMs,
        message: `No telemetry for ${budget.pipeline}/${budget.command}${budget.app ? `/${budget.app}` : ""} — cannot verify budget`,
      });
    } else if (p95 > thresholdMs) {
      violations.push({
        rule: "BUDGET-01",
        pipeline: budget.pipeline,
        command: budget.command,
        app: budget.app,
        p95Ms: p95,
        expectedDurationMs: budget.expectedDurationMs,
        thresholdMs,
        message: `p95 ${p95}ms exceeds budget ${budget.expectedDurationMs}ms × ${tolerance} = ${thresholdMs}ms for ${budget.pipeline}/${budget.command}${budget.app ? `/${budget.app}` : ""}`,
      });
    }
  }

  const breachCount = violations.filter((v) => v.rule === "BUDGET-01").length;
  const warningCount = violations.filter((v) => v.rule === "BUDGET-02").length;
  const exitCode = breachCount > 0 ? 1 : 0;
  const summaryParts = [
    `[pipeline.budget.validate] checked ${checkedCount} budget(s) against ${telemetryRecords.length} telemetry sample(s)`,
  ];
  if (breachCount > 0) {
    summaryParts.push(`${breachCount} BUDGET-01 breach(s)`);
  }
  if (warningCount > 0) {
    summaryParts.push(`${warningCount} BUDGET-02 warning(s) (no telemetry)`);
  }
  if (violations.length === 0) {
    summaryParts.push("all budgets within tolerance");
  }

  const nextSteps: KernelNextStep[] = [];
  if (breachCount > 0) {
    nextSteps.push({
      action:
        "Review BUDGET-01 breaches — consider optimizing slow validators or updating budgets with pipeline.budget.generate",
      kind: "optional",
    });
  }
  if (warningCount > 0) {
    nextSteps.push({
      action: "Run the pipeline at least once to generate telemetry for BUDGET-02 warnings",
      kind: "optional",
    });
  }

  return {
    data: {
      command: "pipeline.budget.validate",
      violations,
      budgetCount: budgets.length,
      telemetrySamples: telemetryRecords.length,
      checkedCount,
    },
    exitCode,
    summary: summaryParts.join(" — "),
    nextSteps: nextSteps.length > 0 ? nextSteps : undefined,
  };
}

// Re-export for tests
export { telemetryFileSizeBytes };
