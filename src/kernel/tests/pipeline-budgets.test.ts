import { test, expect } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import {
  aggregateBudgets,
  parseTelemetryHistory,
  appendStepTelemetry,
  loadPipelineBudgets,
  lookupExpectedDurationMs,
  runPipelineBudgetGenerate,
  budgetsFilePath,
  type StepTelemetryRecord,
  type PipelineBudgetsFile,
} from "../pipeline-budgets.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "../types.ts";

/*
<MODULE_CONTRACT>
<purpose>
  RFC-0270: unit tests for pipeline timing budget derivation, written before
  wiring the runner. Fixture-driven aggregation over a synthetic ndjson
  history (golden p50/p95/expectedDurationMs values), unparseable-line skip,
  empty-history no-op, and determinism for identical input.
</purpose>
</MODULE_CONTRACT>
*/

function record(overrides: Partial<StepTelemetryRecord>): StepTelemetryRecord {
  return {
    pipeline: "packages.check",
    command: "manifest.contract.validate",
    app: null,
    durationMs: 100,
    timedOut: false,
    recordedAt: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

test("aggregateBudgets: golden p50/p95/expectedDurationMs for a fixture sample", () => {
  // 10 samples: 100..1000ms in steps of 100.
  const records = Array.from({ length: 10 }, (_, i) => record({ durationMs: (i + 1) * 100 }));
  const budgets = aggregateBudgets(records);
  expect(budgets.length).toBe(1);
  const b = budgets[0]!;
  expect(b.sampleCount).toBe(10);
  expect(b.p50Ms).toBe(500);
  expect(b.p95Ms).toBe(1000);
  // expectedDurationMs = ceil(p95 * 1.5) rounded up to the nearest second = ceil(1500/1000)*1000
  expect(b.expectedDurationMs).toBe(2000);
});

test("aggregateBudgets: groups separately by (pipeline, command, app)", () => {
  const records = [
    record({ app: "warpgogol-com", durationMs: 1000 }),
    record({ app: "nicaragua-projekt", durationMs: 2000 }),
    record({ pipeline: "build.check", durationMs: 3000 }),
  ];
  const budgets = aggregateBudgets(records);
  expect(budgets.length).toBe(3);
});

test("aggregateBudgets: deterministic output for identical input (sorted, repeatable)", () => {
  const records = [
    record({ command: "b-command", durationMs: 500 }),
    record({ command: "a-command", durationMs: 200 }),
  ];
  const first = aggregateBudgets(records);
  const second = aggregateBudgets([...records]);
  expect(first).toEqual(second);
  expect(first[0]?.command).toBe("a-command");
  expect(first[1]?.command).toBe("b-command");
});

test("parseTelemetryHistory: skips unparseable lines and reports the count", () => {
  const raw = [
    JSON.stringify(record({})),
    "not json at all",
    JSON.stringify({ pipeline: "x" }), // missing required fields
    JSON.stringify(record({ durationMs: 42 })),
  ].join("\n");
  const { records, skipped } = parseTelemetryHistory(raw);
  expect(records.length).toBe(2);
  expect(skipped).toBe(2);
});

test("parseTelemetryHistory: empty input yields no records and no skips", () => {
  const { records, skipped } = parseTelemetryHistory("");
  expect(records).toEqual([]);
  expect(skipped).toBe(0);
});

test("lookupExpectedDurationMs: exact app match wins over the app-agnostic budget", () => {
  const budgets: PipelineBudgetsFile = {
    meta: { schemaVersion: 1, deterministic: true, generatedAt: null, historyHash: "x" },
    budgets: [
      {
        pipeline: "p",
        command: "c",
        app: null,
        sampleCount: 1,
        p50Ms: 1,
        p95Ms: 1,
        expectedDurationMs: 1000,
      },
      {
        pipeline: "p",
        command: "c",
        app: "warpgogol-com",
        sampleCount: 1,
        p50Ms: 1,
        p95Ms: 1,
        expectedDurationMs: 2000,
      },
    ],
  };
  expect(lookupExpectedDurationMs(budgets, "p", "c", "warpgogol-com")).toBe(2000);
  expect(lookupExpectedDurationMs(budgets, "p", "c", "nicaragua-projekt")).toBe(1000);
  expect(lookupExpectedDurationMs(null, "p", "c", "warpgogol-com")).toBe(undefined);
});

// ---------------------------------------------------------------------------
// Filesystem-backed integration
// ---------------------------------------------------------------------------

const logger = {
  section() {},
  info() {},
  warn() {},
  error() {},
  success() {},
  getEvents() {
    return [];
  },
};

function ctx(root: string): KernelRuntimeContext {
  return {
    workspaceRoot: root,
    siteExplicit: false,
    logger,
    dryRun: false,
    outputFormat: "json",
  } as unknown as KernelRuntimeContext;
}

test("runPipelineBudgetGenerate: empty history is a no-op (exit 0, writes nothing)", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-budgets-"));
  try {
    const input = { argv: [], flags: {} } as unknown as KernelCommandInput;
    const result = await runPipelineBudgetGenerate(input, ctx(root));
    expect(result.exitCode ?? 0).toBe(0);
    expect((result.data as { written: boolean }).written).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runPipelineBudgetGenerate: aggregates a real history file into the committed budgets file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-budgets-"));
  try {
    const historyDir = join(root, "node_modules", ".cache", "werkstatt", "telemetry");
    await mkdir(historyDir, { recursive: true });
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify(record({ durationMs: (i + 1) * 1000 })),
    );
    await writeFile(join(historyDir, "steps.ndjson"), lines.join("\n") + "\n", "utf8");

    const input = { argv: [], flags: {} } as unknown as KernelCommandInput;
    const result = await runPipelineBudgetGenerate(input, ctx(root));
    expect(result.exitCode ?? 0).toBe(0);
    expect((result.data as { written: boolean }).written).toBe(true);

    const written = await readFile(budgetsFilePath(root), "utf8");
    expect(written).toMatch(/GENERATED/);
    const parsed = yamlParse(written) as PipelineBudgetsFile;
    expect(parsed.budgets.length).toBe(1);
    expect(parsed.budgets[0]?.sampleCount).toBe(5);

    const loaded = await loadPipelineBudgets(root);
    expect(loaded).toBeTruthy();
    expect(loaded?.budgets.length).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("appendStepTelemetry: writes a record retrievable via parseTelemetryHistory", async () => {
  const root = await mkdtemp(join(tmpdir(), "pipeline-budgets-"));
  try {
    await appendStepTelemetry(root, record({ command: "x" }));
    await appendStepTelemetry(root, record({ command: "y" }));
    const raw = await readFile(
      join(root, "node_modules", ".cache", "werkstatt", "telemetry", "steps.ndjson"),
      "utf8",
    );
    const { records, skipped } = parseTelemetryHistory(raw);
    expect(records.length).toBe(2);
    expect(skipped).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
