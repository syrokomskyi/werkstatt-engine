import { test, expect, describe } from "vitest";
import { aggregateCollectErrors } from "../runtime/execute-pipeline.ts";
import type { KernelExecutionReport } from "../types.ts";
import type { StepExecutionResult } from "../runtime/pipeline-scheduler.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0809: Unit tests for aggregateCollectErrors pure function.
    Covers multiple independent failures, dependency-skipped exclusion,
    fail-fast fallthrough, and no-failures case.
  </purpose>
</MODULE_CONTRACT>
*/

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
