/*
<MODULE_CONTRACT>
<purpose>
RFC-0270: derives pipeline step timing budgets from locally observed telemetry
instead of hand-guessed expectedDurationMs constants. A gitignored, append-only,
size-capped local history (node_modules/.cache/site-kernel/telemetry/steps.ndjson)
records every executed pipeline step's duration; pipeline.budget.generate
aggregates it into the committed docs/pipeline-budgets.generated.yaml
(p50/p95/expectedDurationMs per pipeline+command+app). The pipeline runner
prefers a budget-file entry over the inline expectedDurationMs when both exist.
</purpose>
<non-goals>
  <item>Do not commit raw per-run telemetry — only the aggregated budget file is committed.</item>
  <item>Do not auto-tune timeoutMs (the hard kill limit) — only expected-duration budgets.</item>
  <item>Do not gate builds on budgets — they are advisory telemetry, never a failure.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0270: initial implementation.</item>
  <item>ADR-0023: add batchAppendStepTelemetry for batched telemetry writes at pipeline completion.</item>
</CHANGE_SUMMARY>
*/

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile as writeFileRaw, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { buildGeneratedHeader } from "./generated-marker.ts";
import { writeFileAtomic } from "./fs-atomic.ts";
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "./types.ts";

export interface StepTelemetryRecord {
  pipeline: string;
  command: string;
  app: string | null;
  durationMs: number;
  timedOut: boolean;
  /** ISO timestamp — retained only in the local ndjson history, never in the committed budgets file. */
  recordedAt: string;
}

export interface StepBudget {
  pipeline: string;
  command: string;
  app: string | null;
  sampleCount: number;
  p50Ms: number;
  p95Ms: number;
  expectedDurationMs: number;
}

export interface PipelineBudgetsFile {
  meta: {
    schemaVersion: 1;
    deterministic: true;
    generatedAt: null;
    historyHash: string;
  };
  budgets: StepBudget[];
}

const TELEMETRY_RELATIVE_PATH = join(
  "node_modules",
  ".cache",
  "werkstatt",
  "telemetry",
  "steps.ndjson",
);
const BUDGETS_RELATIVE_PATH = join("docs", "pipeline-budgets.generated.yaml");
const MAX_HISTORY_BYTES = 5 * 1024 * 1024;

function telemetryPath(workspaceRoot: string): string {
  return join(workspaceRoot, TELEMETRY_RELATIVE_PATH);
}

export function budgetsFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, BUDGETS_RELATIVE_PATH);
}

/**
 * Best-effort append of one telemetry record to the local ndjson history.
 * Never throws — a telemetry write failure must never break a real pipeline
 * run. FIFO-caps the file at MAX_HISTORY_BYTES by dropping the oldest whole
 * lines once the cap would be exceeded.
 */
export async function appendStepTelemetry(
  workspaceRoot: string,
  record: StepTelemetryRecord,
): Promise<void> {
  try {
    const filePath = telemetryPath(workspaceRoot);
    await mkdir(dirname(filePath), { recursive: true });
    const line = `${JSON.stringify(record)}\n`;

    let existing = "";
    try {
      existing = await readFile(filePath, "utf8");
    } catch {
      existing = "";
    }

    let next = existing + line;
    if (Buffer.byteLength(next, "utf8") > MAX_HISTORY_BYTES) {
      const lines = next.split("\n").filter((l) => l.length > 0);
      while (
        lines.length > 1 &&
        Buffer.byteLength(lines.join("\n") + "\n", "utf8") > MAX_HISTORY_BYTES
      ) {
        lines.shift();
      }
      next = lines.join("\n") + "\n";
    }

    await writeFileRaw(filePath, next, "utf8");
  } catch {
    // Telemetry is best-effort; never let a persistence failure surface to the caller.
  }
}

/**
 * ADR-0023: Batch-append multiple telemetry records in a single read-modify-write
 * cycle. Replaces N per-step appendStepTelemetry calls (each doing its own
 * read+write) with a single read+write at pipeline completion.
 *
 * Never throws — a telemetry write failure must never break a real pipeline run.
 * FIFO-caps the file at MAX_HISTORY_BYTES by dropping the oldest whole lines
 * once the cap would be exceeded.
 */
export async function batchAppendStepTelemetry(
  workspaceRoot: string,
  records: StepTelemetryRecord[],
): Promise<void> {
  if (records.length === 0) return;
  try {
    const filePath = telemetryPath(workspaceRoot);
    await mkdir(dirname(filePath), { recursive: true });
    const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";

    let existing = "";
    try {
      existing = await readFile(filePath, "utf8");
    } catch {
      existing = "";
    }

    let next = existing + lines;
    if (Buffer.byteLength(next, "utf8") > MAX_HISTORY_BYTES) {
      const allLines = next.split("\n").filter((l) => l.length > 0);
      while (
        allLines.length > 1 &&
        Buffer.byteLength(allLines.join("\n") + "\n", "utf8") > MAX_HISTORY_BYTES
      ) {
        allLines.shift();
      }
      next = allLines.join("\n") + "\n";
    }

    await writeFileRaw(filePath, next, "utf8");
  } catch {
    // Telemetry is best-effort; never let a persistence failure surface to the caller.
  }
}

/** Pure parser: skips unparseable lines and reports the skip count. */
export function parseTelemetryHistory(raw: string): {
  records: StepTelemetryRecord[];
  skipped: number;
} {
  const records: StepTelemetryRecord[] = [];
  let skipped = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<StepTelemetryRecord>;
      if (
        typeof parsed.pipeline === "string" &&
        typeof parsed.command === "string" &&
        (typeof parsed.app === "string" || parsed.app === null) &&
        typeof parsed.durationMs === "number" &&
        Number.isFinite(parsed.durationMs)
      ) {
        records.push({
          pipeline: parsed.pipeline,
          command: parsed.command,
          app: parsed.app ?? null,
          durationMs: parsed.durationMs,
          timedOut: parsed.timedOut === true,
          recordedAt: typeof parsed.recordedAt === "string" ? parsed.recordedAt : "",
        });
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }
  return { records, skipped };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const index = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, index)]!;
}

/**
 * Pure aggregation over a set of telemetry records — deterministic for
 * identical input, sorted by (pipeline, command, app) for stable output.
 * expectedDurationMs = ceil(p95 * 1.5), rounded up to the nearest second.
 */
export function aggregateBudgets(records: StepTelemetryRecord[]): StepBudget[] {
  const groups = new Map<
    string,
    { pipeline: string; command: string; app: string | null; durations: number[] }
  >();
  for (const record of records) {
    const key = `${record.pipeline}${record.command}${record.app ?? ""}`;
    const group = groups.get(key) ?? {
      pipeline: record.pipeline,
      command: record.command,
      app: record.app,
      durations: [],
    };
    group.durations.push(record.durationMs);
    groups.set(key, group);
  }

  const budgets: StepBudget[] = [];
  for (const group of groups.values()) {
    const sorted = [...group.durations].sort((a, b) => a - b);
    const p50Ms = percentile(sorted, 50);
    const p95Ms = percentile(sorted, 95);
    const expectedDurationMs = Math.ceil((p95Ms * 1.5) / 1000) * 1000;
    budgets.push({
      pipeline: group.pipeline,
      command: group.command,
      app: group.app,
      sampleCount: sorted.length,
      p50Ms,
      p95Ms,
      expectedDurationMs,
    });
  }

  budgets.sort(
    (a, b) =>
      a.pipeline.localeCompare(b.pipeline) ||
      a.command.localeCompare(b.command) ||
      (a.app ?? "").localeCompare(b.app ?? ""),
  );
  return budgets;
}

function historyHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Reads the committed budgets file. Returns null when absent or unparseable. */
export async function loadPipelineBudgets(
  workspaceRoot: string,
): Promise<PipelineBudgetsFile | null> {
  try {
    const raw = await readFile(budgetsFilePath(workspaceRoot), "utf8");
    const parsed = yamlParse(raw) as PipelineBudgetsFile;
    if (!Array.isArray(parsed.budgets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Runner lookup: an exact (pipeline, command, app) budget wins; falls back to
 * the app-agnostic (app: null) budget for the same pipeline+command; else
 * undefined (caller falls back to the inline expectedDurationMs).
 */
export function lookupExpectedDurationMs(
  budgets: PipelineBudgetsFile | null,
  pipeline: string,
  command: string,
  app: string | null,
): number | undefined {
  if (!budgets) return undefined;
  const exact = budgets.budgets.find(
    (b) => b.pipeline === pipeline && b.command === command && b.app === app,
  );
  if (exact) return exact.expectedDurationMs;
  const generic = budgets.budgets.find(
    (b) => b.pipeline === pipeline && b.command === command && b.app === null,
  );
  return generic?.expectedDurationMs;
}

export interface PipelineBudgetGenerateResult {
  command: "pipeline.budget.generate";
  written: boolean;
  budgetCount: number;
  sampleCount: number;
  skippedLines: number;
}

export async function runPipelineBudgetGenerate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<PipelineBudgetGenerateResult>> {
  const dryRun = context.dryRun || input.flags["dry-run"] === true;

  let raw = "";
  try {
    raw = await readFile(telemetryPath(context.workspaceRoot), "utf8");
  } catch {
    return {
      data: {
        command: "pipeline.budget.generate",
        written: false,
        budgetCount: 0,
        sampleCount: 0,
        skippedLines: 0,
      },
      exitCode: 0,
      summary: "[pipeline.budget.generate] no local telemetry history found — nothing to aggregate",
    };
  }

  const { records, skipped } = parseTelemetryHistory(raw);
  if (records.length === 0) {
    return {
      data: {
        command: "pipeline.budget.generate",
        written: false,
        budgetCount: 0,
        sampleCount: 0,
        skippedLines: skipped,
      },
      exitCode: 0,
      summary: "[pipeline.budget.generate] telemetry history is empty — nothing to aggregate",
    };
  }

  const budgets = aggregateBudgets(records);
  const file: PipelineBudgetsFile = {
    meta: {
      schemaVersion: 1,
      deterministic: true,
      generatedAt: null,
      historyHash: historyHash(raw),
    },
    budgets,
  };

  const content = `${buildGeneratedHeader({ filePath: BUDGETS_RELATIVE_PATH, ownerCommand: "pipeline.budget.generate" })}${yamlStringify(file)}\n`;
  if (!dryRun) {
    const outputPath = budgetsFilePath(context.workspaceRoot);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFileAtomic(outputPath, content);
  }

  const summaryText = dryRun
    ? `[pipeline.budget.generate] dry-run — ${budgets.length} budget(s) from ${records.length} sample(s)`
    : `[pipeline.budget.generate] wrote ${budgets.length} budget(s) from ${records.length} sample(s)${skipped > 0 ? ` (${skipped} unparseable line(s) skipped)` : ""}`;

  return {
    data: {
      command: "pipeline.budget.generate",
      written: !dryRun,
      budgetCount: budgets.length,
      sampleCount: records.length,
      skippedLines: skipped,
    },
    exitCode: 0,
    summary: summaryText,
  };
}

// Re-exported for tests that want to assert against the real fs stat of the history file.
export async function telemetryFileSizeBytes(workspaceRoot: string): Promise<number> {
  try {
    const s = await stat(telemetryPath(workspaceRoot));
    return s.size;
  } catch {
    return 0;
  }
}
