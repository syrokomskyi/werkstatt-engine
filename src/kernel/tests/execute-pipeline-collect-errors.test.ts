import { test, expect, describe } from "vitest";
import { aggregateCollectErrors } from "../runtime/execute-pipeline.ts";
import type { KernelExecutionReport } from "@warpgogol/werkstatt-shared/kernel";
import type { StepExecutionResult } from "../runtime/pipeline-scheduler.ts";

/*
<MODULE_CONTRACT>
  <purpose>
Unit tests for execute pipeline collect errors covering aggregateCollectErrors (RFC-0809).
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>

<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the execute suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to internals beyond the public surface under test

function okReport(command: string): KernelExecutionReport {
  return {
    commandName: command,
    exitCode: 0,
    ok: true,
    summary: `${command}: OK`,
    metadata: {} as never,
    logs: [],
    timing: { durationMs: 10, exceededTimeout: false },
    filesModified: [],
  };
}

function failReport(command: string, exitCode = 1): KernelExecutionReport {
  return {
    commandName: command,
    exitCode,
    ok: false,
    summary: `${command}: FAIL`,
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

describe("aggregateCollectErrors (RFC-0809)", () => {
  test("(a) multiple independent failures reported in one run", () => {
    const results: StepExecutionResult[] = [
      makeResult(0, failReport("cmd.a")),
      makeResult(1, failReport("cmd.b"), true),
      makeResult(2, failReport("cmd.c", 2)),
      makeResult(3, okReport("cmd.d")),
    ];

    const collected = aggregateCollectErrors(results, true);

    expect(collected).toBeDefined();
    expect(collected!.ok).toBe(false);
    expect(collected!.failedSteps).toEqual(["cmd.a", "cmd.c"]);
    expect(collected!.exitCode).toBe(1);
  });

  test("(b) dependency-skipped steps excluded from failedSteps", () => {
    const results: StepExecutionResult[] = [
      makeResult(0, failReport("cmd.a")),
      makeResult(1, failReport("cmd.b"), true),
    ];

    const collected = aggregateCollectErrors(results, true);

    expect(collected).toBeDefined();
    expect(collected!.failedSteps).toEqual(["cmd.a"]);
    expect(collected!.failedSteps).not.toContain("cmd.b");
  });

  test("(c) collectErrors=false returns undefined (fail-fast fallthrough)", () => {
    const results: StepExecutionResult[] = [
      makeResult(0, failReport("cmd.a")),
      makeResult(1, okReport("cmd.b")),
    ];

    const collected = aggregateCollectErrors(results, false);

    expect(collected).toBeUndefined();
  });

  test("(d) no failures returns undefined even with collectErrors=true", () => {
    const results: StepExecutionResult[] = [
      makeResult(0, okReport("cmd.a")),
      makeResult(1, okReport("cmd.b")),
    ];

    const collected = aggregateCollectErrors(results, true);

    expect(collected).toBeUndefined();
  });
});
