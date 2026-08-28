import { test, expect } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import {
  runPipelineBudgetGenerate,
  budgetsFilePath,
  type StepTelemetryRecord,
} from "../pipeline-budgets.ts";
import type { KernelCommandInput, KernelRuntimeContext } from "../types.ts";

/*
<MODULE_CONTRACT>
<purpose>
RFC-0963: unit tests for pipeline.budget.generate fleet filtering — retired
apps are filtered out when not in fleet/fleet.sites.yaml, and empty fleet
produces an empty budgets file.
</purpose>
</MODULE_CONTRACT>
*/

const TELEMETRY_RELATIVE_PATH = join("node_modules", ".cache", "werkstatt", "telemetry", "steps.ndjson");
const FLEET_SITES_RELATIVE_PATH = join("fleet", "fleet.sites.yaml");

function makeContext(workspaceRoot: string): KernelRuntimeContext {
  return {
    workspaceRoot,
  } as unknown as KernelRuntimeContext;
}

const baseInput: KernelCommandInput = {
  argv: [],
  flags: {},
};

function record(overrides: Partial<StepTelemetryRecord>): StepTelemetryRecord {
  return {
    pipeline: "sites-check.author",
    command: "content.links.validate",
    app: null,
    durationMs: 100,
    timedOut: false,
    recordedAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

async function writeTelemetry(dir: string, records: StepTelemetryRecord[]): Promise<void> {
  const filePath = join(dir, TELEMETRY_RELATIVE_PATH);
  await mkdir(join(dir, "node_modules", ".cache", "werkstatt", "telemetry"), { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(filePath, lines);
}

async function writeFleetSites(dir: string, siteIds: string[]): Promise<void> {
  const filePath = join(dir, FLEET_SITES_RELATIVE_PATH);
  await mkdir(join(dir, "fleet"), { recursive: true });
  const content = `sites:\n${siteIds.map((id) => `  - id: ${id}`).join("\n")}\n`;
  await writeFile(filePath, content);
}

test("retired apps are filtered out when not in fleet.sites.yaml", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pbg-filter-"));
  try {
    await writeTelemetry(dir, [
      record({ app: "warpgogol-com", durationMs: 100 }),
      record({ app: "retired-app", durationMs: 200 }),
    ]);
    await writeFleetSites(dir, ["warpgogol-com"]);
    const result = await runPipelineBudgetGenerate(baseInput, makeContext(dir));
    expect(result.exitCode).toBe(0);
    const budgetsRaw = await readFile(budgetsFilePath(dir), "utf8");
    const parsed = yamlParse(budgetsRaw) as { budgets: Array<{ app: string | null }> };
    const apps = parsed.budgets.map((b) => b.app);
    expect(apps).toContain("warpgogol-com");
    expect(apps).not.toContain("retired-app");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("workspace-scoped records (app=null) are always kept", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pbg-filter-"));
  try {
    await writeTelemetry(dir, [record({ app: null, durationMs: 100 })]);
    await writeFleetSites(dir, ["warpgogol-com"]);
    const result = await runPipelineBudgetGenerate(baseInput, makeContext(dir));
    expect(result.exitCode).toBe(0);
    const budgetsRaw = await readFile(budgetsFilePath(dir), "utf8");
    const parsed = yamlParse(budgetsRaw) as { budgets: Array<{ app: string | null }> };
    expect(parsed.budgets.length).toBe(1);
    expect(parsed.budgets[0]!.app).toBeNull();
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("all records filtered out → empty budgets file written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pbg-filter-"));
  try {
    await writeTelemetry(dir, [
      record({ app: "retired-app-1", durationMs: 100 }),
      record({ app: "retired-app-2", durationMs: 200 }),
    ]);
    await writeFleetSites(dir, ["warpgogol-com"]);
    const result = await runPipelineBudgetGenerate(baseInput, makeContext(dir));
    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("filtered out");
    const budgetsRaw = await readFile(budgetsFilePath(dir), "utf8");
    const parsed = yamlParse(budgetsRaw) as { budgets: unknown[] };
    expect(parsed.budgets.length).toBe(0);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("no fleet.sites.yaml → no filtering (backward compatible)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pbg-filter-"));
  try {
    await writeTelemetry(dir, [
      record({ app: "any-app", durationMs: 100 }),
    ]);
    // No fleet.sites.yaml written
    const result = await runPipelineBudgetGenerate(baseInput, makeContext(dir));
    expect(result.exitCode).toBe(0);
    const budgetsRaw = await readFile(budgetsFilePath(dir), "utf8");
    const parsed = yamlParse(budgetsRaw) as { budgets: Array<{ app: string | null }> };
    expect(parsed.budgets.length).toBe(1);
    expect(parsed.budgets[0]!.app).toBe("any-app");
  } finally {
    await rm(dir, { recursive: true });
  }
});
