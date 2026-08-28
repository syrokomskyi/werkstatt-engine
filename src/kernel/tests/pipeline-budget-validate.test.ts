import { test, expect } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipelineBudgetValidate } from "../pipeline-budget-validate.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "../types.ts";

/*
<MODULE_CONTRACT>
<purpose>
RFC-0963: unit tests for pipeline.budget.validate — budget breach detection
(BUDGET-01), missing telemetry warnings (BUDGET-02), empty fleet, site
filtering, and tolerance adjustment.
</purpose>
</MODULE_CONTRACT>
*/

function makeContext(workspaceRoot: string): KernelRuntimeContext {
  return {
    workspaceRoot,
  } as unknown as KernelRuntimeContext;
}

const baseInput: KernelCommandInput = {
  argv: [],
  flags: {},
};

const TELEMETRY_RELATIVE_PATH = join("node_modules", ".cache", "werkstatt", "telemetry", "steps.ndjson");
const BUDGETS_RELATIVE_PATH = join("docs", "pipeline-budgets.generated.yaml");

async function writeBudgetsFile(
  dir: string,
  budgets: Array<{ pipeline: string; command: string; app: string | null; expectedDurationMs: number }>,
): Promise<void> {
  const filePath = join(dir, BUDGETS_RELATIVE_PATH);
  await mkdir(join(dir, "docs"), { recursive: true });
  const content = `meta:\n  schemaVersion: 1\n  deterministic: true\n  generatedAt: null\n  historyHash: test\nbudgets:\n${budgets
    .map(
      (b) =>
        `  - pipeline: ${b.pipeline}\n    command: ${b.command}\n    app: ${b.app === null ? "null" : `"${b.app}"`}\n    sampleCount: 10\n    p50Ms: ${b.expectedDurationMs}\n    p95Ms: ${b.expectedDurationMs}\n    expectedDurationMs: ${b.expectedDurationMs}`,
    )
    .join("\n")}\n`;
  await writeFile(filePath, content);
}

async function writeTelemetryFile(
  dir: string,
  records: Array<{ pipeline: string; command: string; app: string | null; durationMs: number; recordedAt: string }>,
): Promise<void> {
  const filePath = join(dir, TELEMETRY_RELATIVE_PATH);
  await mkdir(join(dir, "node_modules", ".cache", "werkstatt", "telemetry"), { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(filePath, lines);
}

test("BUDGET-01: p95 exceeds budget × tolerance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pbv-test-"));
  try {
    await writeBudgetsFile(dir, [
      { pipeline: "sites-check.author", command: "content.links.validate", app: null, expectedDurationMs: 100 },
    ]);
    await writeTelemetryFile(
      dir,
      Array.from({ length: 10 }, (_, i) => ({
        pipeline: "sites-check.author",
        command: "content.links.validate",
        app: null,
        durationMs: 200 + i * 10,
        recordedAt: "2026-08-28T00:00:00.000Z",
      })),
    );
    const result = await runPipelineBudgetValidate(baseInput, makeContext(dir));
    expect(result.exitCode).toBe(1);
    expect(result.data!.violations.length).toBe(1);
    expect(result.data!.violations[0]!.rule).toBe("BUDGET-01");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("BUDGET-02: no telemetry for a budgeted step", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pbv-test-"));
  try {
    await writeBudgetsFile(dir, [
      { pipeline: "sites-check.author", command: "content.links.validate", app: null, expectedDurationMs: 100 },
    ]);
    // No telemetry file written
    const result = await runPipelineBudgetValidate(baseInput, makeContext(dir));
    expect(result.exitCode).toBe(0);
    expect(result.data!.violations.length).toBe(1);
    expect(result.data!.violations[0]!.rule).toBe("BUDGET-02");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("empty budgets file → 0 checked, exit 0", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pbv-test-"));
  try {
    await writeBudgetsFile(dir, []);
    const result = await runPipelineBudgetValidate(baseInput, makeContext(dir));
    expect(result.exitCode).toBe(0);
    expect(result.data!.checkedCount).toBe(0);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("no budgets file → skip validation, exit 0", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pbv-test-"));
  try {
    const result = await runPipelineBudgetValidate(baseInput, makeContext(dir));
    expect(result.exitCode).toBe(0);
    expect(result.data!.budgetCount).toBe(0);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("--site flag filters by site", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pbv-test-"));
  try {
    await writeBudgetsFile(dir, [
      { pipeline: "sites-check.author", command: "content.links.validate", app: "warpgogol-com", expectedDurationMs: 100 },
      { pipeline: "sites-check.author", command: "content.links.validate", app: "other-site", expectedDurationMs: 100 },
    ]);
    await writeTelemetryFile(
      dir,
      Array.from({ length: 5 }, () => ({
        pipeline: "sites-check.author",
        command: "content.links.validate",
        app: "warpgogol-com",
        durationMs: 50,
        recordedAt: "2026-08-28T00:00:00.000Z",
      })).concat(
        Array.from({ length: 5 }, () => ({
          pipeline: "sites-check.author",
          command: "content.links.validate",
          app: "other-site",
          durationMs: 50,
          recordedAt: "2026-08-28T00:00:00.000Z",
        })),
      ),
    );
    const input: KernelCommandInput = { ...baseInput, flags: { site: "warpgogol-com" } };
    const result = await runPipelineBudgetValidate(input, makeContext(dir));
    expect(result.exitCode).toBe(0);
    expect(result.data!.budgetCount).toBe(1);
    expect(result.data!.checkedCount).toBe(1);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("--tolerance flag adjusts threshold", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pbv-test-"));
  try {
    await writeBudgetsFile(dir, [
      { pipeline: "sites-check.author", command: "content.links.validate", app: null, expectedDurationMs: 100 },
    ]);
    // p95 = 200ms, budget = 100ms, default tolerance 1.5 → threshold 150ms → breach
    await writeTelemetryFile(
      dir,
      Array.from({ length: 10 }, () => ({
        pipeline: "sites-check.author",
        command: "content.links.validate",
        app: null,
        durationMs: 200,
        recordedAt: "2026-08-28T00:00:00.000Z",
      })),
    );
    // With tolerance 3.0 → threshold 300ms → no breach
    const input: KernelCommandInput = { ...baseInput, flags: { tolerance: "3.0" } };
    const result = await runPipelineBudgetValidate(input, makeContext(dir));
    expect(result.exitCode).toBe(0);
    expect(result.data!.violations.length).toBe(0);
  } finally {
    await rm(dir, { recursive: true });
  }
});
