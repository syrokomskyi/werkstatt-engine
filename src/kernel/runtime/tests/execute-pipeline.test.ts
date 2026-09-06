import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateCollectErrors,
  shouldTransitiveSkip,
  loadImportedCacheHits,
  persistCacheHits,
  clearPipelineCacheHits,
  type PipelineRunState,
} from "../execute-pipeline.ts";
import type { StepExecutionResult } from "../pipeline-scheduler.ts";
import type { KernelExecutionReport, KernelCommandDefinition } from "../../types.ts";

function okReport(command: string): KernelExecutionReport {
  return {
    commandName: command,
    exitCode: 0,
    ok: true,
    summary: "ok",
    metadata: {} as never,
    logs: [],
    timing: { durationMs: 10, exceededTimeout: false },
    filesModified: [],
  };
}

function failReport(command: string): KernelExecutionReport {
  return {
    commandName: command,
    exitCode: 1,
    ok: false,
    summary: "fail",
    metadata: {} as never,
    logs: [],
    timing: { durationMs: 10, exceededTimeout: false },
    filesModified: [],
  };
}

function makeResult(
  stepIndex: number,
  report: KernelExecutionReport,
  dependencySkipped = false,
): StepExecutionResult {
  return { stepIndex, report, dependencySkipped };
}

const mockCommand: KernelCommandDefinition = {
  name: "test.cmd",
  description: "test",
  scope: "workspace",
  execute: async () => ({ exitCode: 0, ok: true, summary: "ok" }),
};

describe("aggregateCollectErrors", () => {
  test("returns undefined when collectErrors is false", () => {
    const results = [makeResult(0, failReport("a"))];
    expect(aggregateCollectErrors(results, false)).toBeUndefined();
  });

  test("returns undefined when no failures", () => {
    const results = [makeResult(0, okReport("a"))];
    expect(aggregateCollectErrors(results, true)).toBeUndefined();
  });

  test("returns failed steps when collectErrors is true", () => {
    const results = [
      makeResult(0, okReport("a")),
      makeResult(1, failReport("b")),
      makeResult(2, failReport("c")),
    ];
    const result = aggregateCollectErrors(results, true);
    expect(result).toBeDefined();
    expect(result!.failedSteps).toEqual(["b", "c"]);
    expect(result!.ok).toBe(false);
  });

  test("excludes dependency-skipped steps from failures", () => {
    const results = [
      makeResult(0, failReport("a")),
      makeResult(1, failReport("b"), true),
    ];
    const result = aggregateCollectErrors(results, true);
    expect(result!.failedSteps).toEqual(["a"]);
  });

  test("uses exitCode from first failure", () => {
    const results = [
      makeResult(0, { ...failReport("a"), exitCode: 42 }),
      makeResult(1, failReport("b")),
    ];
    const result = aggregateCollectErrors(results, true);
    expect(result!.exitCode).toBe(42);
  });
});

describe("shouldTransitiveSkip", () => {
  const runState: PipelineRunState = {
    cacheHitCommands: new Set(["gen.a", "gen.b"]),
    pipelineName: "test",
  };

  test("returns false when cacheable is false", () => {
    const cmd = { ...mockCommand, cacheable: false, validatesOutputs: ["gen.a"] };
    expect(shouldTransitiveSkip(cmd, runState)).toBe(false);
  });

  test("returns false when validatesOutputs is absent", () => {
    expect(shouldTransitiveSkip(mockCommand, runState)).toBe(false);
  });

  test("returns false when validatesOutputs is empty", () => {
    const cmd = { ...mockCommand, validatesOutputs: [] };
    expect(shouldTransitiveSkip(cmd, runState)).toBe(false);
  });

  test("returns true when all validatesOutputs are cache hits", () => {
    const cmd = { ...mockCommand, validatesOutputs: ["gen.a", "gen.b"] };
    expect(shouldTransitiveSkip(cmd, runState)).toBe(true);
  });

  test("returns false when not all validatesOutputs are cache hits", () => {
    const cmd = { ...mockCommand, validatesOutputs: ["gen.a", "gen.c"] };
    expect(shouldTransitiveSkip(cmd, runState)).toBe(false);
  });
});

describe("pipeline cache-hits persistence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(process.cwd(), "tmp-cache-hits-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("loadImportedCacheHits returns empty set when file does not exist", async () => {
    const hits = await loadImportedCacheHits(tmpDir, "pipeline-a");
    expect(hits.size).toBe(0);
  });

  test("persistCacheHits writes and loadImportedCacheHits reads back", async () => {
    await persistCacheHits(tmpDir, "pipeline-a", new Set(["cmd.1", "cmd.2"]));
    const hits = await loadImportedCacheHits(tmpDir, "pipeline-b");
    expect(hits.has("cmd.1")).toBe(true);
    expect(hits.has("cmd.2")).toBe(true);
  });

  test("loadImportedCacheHits excludes current pipeline", async () => {
    await persistCacheHits(tmpDir, "pipeline-a", new Set(["cmd.1"]));
    const hits = await loadImportedCacheHits(tmpDir, "pipeline-a");
    expect(hits.size).toBe(0);
  });

  test("loadImportedCacheHits handles corrupt JSON gracefully", async () => {
    const dir = join(tmpDir, ".cache");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pipeline-cache-hits.json"), "not json{");
    const hits = await loadImportedCacheHits(tmpDir, "pipeline-a");
    expect(hits.size).toBe(0);
  });

  test("persistCacheHits preserves entries for other pipelines", async () => {
    await persistCacheHits(tmpDir, "pipeline-a", new Set(["cmd.a"]));
    await persistCacheHits(tmpDir, "pipeline-b", new Set(["cmd.b"]));
    const hits = await loadImportedCacheHits(tmpDir, "pipeline-c");
    expect(hits.has("cmd.a")).toBe(true);
    expect(hits.has("cmd.b")).toBe(true);
  });

  test("clearPipelineCacheHits empties the file", async () => {
    await persistCacheHits(tmpDir, "pipeline-a", new Set(["cmd.1"]));
    await clearPipelineCacheHits(tmpDir);
    const hits = await loadImportedCacheHits(tmpDir, "pipeline-b");
    expect(hits.size).toBe(0);
  });

  test("loadImportedCacheHits skips stale entries", async () => {
    const dir = join(tmpDir, ".cache");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    const staleData = {
      pipelines: {
        "pipeline-a": {
          commands: ["cmd.1"],
          writtenAt: Date.now() - 31 * 60 * 1000,
        },
      },
    };
    writeFileSync(join(dir, "pipeline-cache-hits.json"), JSON.stringify(staleData));
    const hits = await loadImportedCacheHits(tmpDir, "pipeline-b");
    expect(hits.size).toBe(0);
  });
});
