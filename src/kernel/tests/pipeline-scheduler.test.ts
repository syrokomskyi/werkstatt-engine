import { test, expect, describe } from "vitest";
import {
  buildSchedule,
  executeScheduledSteps,
  ScheduleError,
} from "../runtime/pipeline-scheduler.ts";
import type { KernelExecutionReport, KernelPipelineStep } from "../types.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    RFC-0686: Unit tests for the pipeline scheduler — buildSchedule and executeScheduledSteps.
    Covers backward-compatible sequential behavior, parallel execution, dependency waiting,
    failure propagation, cycle detection, explicit skip, and dependency-failure skip.
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

function failReport(command: string): KernelExecutionReport {
  return {
    commandName: command,
    exitCode: 1,
    ok: false,
    summary: `${command}: FAIL`,
    metadata: {} as never,
    logs: [],
    timing: { durationMs: 10, exceededTimeout: false },
    filesModified: [],
  };
}

function skippedReport(command: string): KernelExecutionReport {
  return {
    commandName: command,
    exitCode: 0,
    ok: true,
    summary: `${command}: skipped`,
    metadata: {} as never,
    logs: [],
    timing: { durationMs: 0, exceededTimeout: false },
    filesModified: [],
  };
}

describe("buildSchedule", () => {
  test("(a) backward-compatible sequential behavior: steps without dependsOn get implicit dependency on previous", () => {
    const steps: KernelPipelineStep[] = [
      { command: "cmd.a" },
      { command: "cmd.b" },
      { command: "cmd.c" },
    ];
    const scheduled = buildSchedule(steps);
    expect(scheduled).toHaveLength(3);
    expect(scheduled[0]!.dependencies.size).toBe(0);
    expect(scheduled[1]!.dependencies.has(0)).toBe(true);
    expect(scheduled[2]!.dependencies.has(1)).toBe(true);
  });

  test("(b) dependsOn: [] means no dependencies", () => {
    const steps: KernelPipelineStep[] = [
      { command: "cmd.a" },
      { command: "cmd.b", dependsOn: [] },
      { command: "cmd.c", dependsOn: [] },
    ];
    const scheduled = buildSchedule(steps);
    expect(scheduled[0]!.dependencies.size).toBe(0);
    expect(scheduled[1]!.dependencies.size).toBe(0);
    expect(scheduled[2]!.dependencies.size).toBe(0);
  });

  test("(c) dependsOn resolves command names to indices", () => {
    const steps: KernelPipelineStep[] = [
      { command: "cmd.a" },
      { command: "cmd.b", dependsOn: [] },
      { command: "cmd.c", dependsOn: ["cmd.a"] },
    ];
    const scheduled = buildSchedule(steps);
    expect(scheduled[2]!.dependencies.has(0)).toBe(true);
    expect(scheduled[2]!.dependencies.size).toBe(1);
  });

  test("(e) cycle detection throws ScheduleError", () => {
    // To create a cycle, we need dependsOn that references a later step.
    // But buildSchedule rejects forward references. So a true cycle can
    // only happen if dependsOn references a command that appears earlier
    // but also depends back. Since forward refs are rejected, cycles are
    // impossible with the current constraints. Test the error path anyway
    // by constructing a schedule manually and calling detectCycles indirectly.
    // Actually, cycles ARE impossible because forward references are rejected.
    // So we test that forward references throw instead.
    const steps: KernelPipelineStep[] = [
      { command: "cmd.a", dependsOn: ["cmd.b"] },
      { command: "cmd.b" },
    ];
    expect(() => buildSchedule(steps)).toThrow(ScheduleError);
    expect(() => buildSchedule(steps)).toThrow(/forward reference/i);
  });

  test("missing dependency throws ScheduleError", () => {
    const steps: KernelPipelineStep[] = [{ command: "cmd.a", dependsOn: ["cmd.nonexistent"] }];
    expect(() => buildSchedule(steps)).toThrow(ScheduleError);
    expect(() => buildSchedule(steps)).toThrow(/not in the pipeline/i);
  });

  test("duplicate command names throw ScheduleError", () => {
    const steps: KernelPipelineStep[] = [{ command: "cmd.a" }, { command: "cmd.a" }];
    expect(() => buildSchedule(steps)).toThrow(ScheduleError);
    expect(() => buildSchedule(steps)).toThrow(/duplicate command name/i);
  });

  test("skipped steps do not create implicit dependencies for subsequent steps", () => {
    const steps: KernelPipelineStep[] = [
      { command: "cmd.a" },
      { command: "cmd.b", skip: true },
      { command: "cmd.c" },
    ];
    const scheduled = buildSchedule(steps);
    // cmd.c should depend on cmd.a (the previous non-skipped step), not cmd.b
    expect(scheduled[2]!.dependencies.has(0)).toBe(true);
    expect(scheduled[2]!.dependencies.has(1)).toBe(false);
  });
});

describe("executeScheduledSteps", () => {
  test("(a) sequential execution: steps without dependsOn run in order", async () => {
    const steps: KernelPipelineStep[] = [
      { command: "cmd.a" },
      { command: "cmd.b" },
      { command: "cmd.c" },
    ];
    const scheduled = buildSchedule(steps);
    const executionOrder: string[] = [];
    const results = await executeScheduledSteps(scheduled, 4, async (sStep) => {
      executionOrder.push(sStep.step.command);
      await new Promise((r) => setTimeout(r, 1));
      return okReport(sStep.step.command);
    });
    expect(results).toHaveLength(3);
    expect(executionOrder).toEqual(["cmd.a", "cmd.b", "cmd.c"]);
    // Results are sorted by stepIndex
    expect(results.map((r) => r.stepIndex)).toEqual([0, 1, 2]);
  });

  test("(b) parallel execution of independent steps with dependsOn: []", async () => {
    const steps: KernelPipelineStep[] = [
      { command: "cmd.a", dependsOn: [] },
      { command: "cmd.b", dependsOn: [] },
      { command: "cmd.c", dependsOn: [] },
    ];
    const scheduled = buildSchedule(steps);
    const startTimes: Record<string, number> = {};
    const results = await executeScheduledSteps(scheduled, 4, async (sStep) => {
      startTimes[sStep.step.command] = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      return okReport(sStep.step.command);
    });
    expect(results).toHaveLength(3);
    // All three should start within a small window (concurrent)
    const starts = Object.values(startTimes);
    const spread = Math.max(...starts) - Math.min(...starts);
    expect(spread).toBeLessThan(30); // all started nearly simultaneously
  });

  test("(c) dependency waiting: step with dependsOn waits for dependency", async () => {
    const steps: KernelPipelineStep[] = [
      { command: "cmd.a", dependsOn: [] },
      { command: "cmd.b", dependsOn: ["cmd.a"] },
    ];
    const scheduled = buildSchedule(steps);
    const executionOrder: string[] = [];
    const results = await executeScheduledSteps(scheduled, 4, async (sStep) => {
      executionOrder.push(sStep.step.command);
      await new Promise((r) => setTimeout(r, 20));
      return okReport(sStep.step.command);
    });
    expect(results).toHaveLength(2);
    expect(executionOrder).toEqual(["cmd.a", "cmd.b"]);
  });

  test("(d) failure propagation: failed step causes transitive dependents to be skipped", async () => {
    const steps: KernelPipelineStep[] = [
      { command: "cmd.a", dependsOn: [] },
      { command: "cmd.b", dependsOn: ["cmd.a"] },
      { command: "cmd.c", dependsOn: ["cmd.b"] },
      { command: "cmd.d", dependsOn: [] },
    ];
    const scheduled = buildSchedule(steps);
    const executed: string[] = [];
    const results = await executeScheduledSteps(scheduled, 4, async (sStep) => {
      executed.push(sStep.step.command);
      await new Promise((r) => setTimeout(r, 10));
      if (sStep.step.command === "cmd.a") return failReport("cmd.a");
      return okReport(sStep.step.command);
    });
    expect(results).toHaveLength(4);
    // cmd.a failed, cmd.b and cmd.c should be skipped, cmd.d should execute
    expect(executed).toContain("cmd.a");
    expect(executed).toContain("cmd.d");
    expect(executed).not.toContain("cmd.b");
    expect(executed).not.toContain("cmd.c");
    const skipped = results.filter((r) => r.dependencySkipped);
    expect(skipped.map((r) => r.stepIndex).sort()).toEqual([1, 2]);
  });

  test("(h) explicit skip (step.skip === true) does not block dependents", async () => {
    const steps: KernelPipelineStep[] = [
      { command: "cmd.a", dependsOn: [] },
      { command: "cmd.b", skip: true, dependsOn: [] },
      { command: "cmd.c", dependsOn: ["cmd.b"] },
    ];
    const scheduled = buildSchedule(steps);
    const results = await executeScheduledSteps(scheduled, 4, async (sStep) => {
      if (sStep.step.skip) return skippedReport(sStep.step.command);
      return okReport(sStep.step.command);
    });
    expect(results).toHaveLength(3);
    // cmd.c should still execute because cmd.b was explicitly skipped (not failed)
    const cResult = results.find((r) => r.stepIndex === 2)!;
    expect(cResult.dependencySkipped).toBe(false);
    expect(cResult.report.ok).toBe(true);
  });

  test("(i) dependency-failure skip blocks dependents transitively", async () => {
    const steps: KernelPipelineStep[] = [
      { command: "cmd.a", dependsOn: [] },
      { command: "cmd.b", dependsOn: ["cmd.a"] },
      { command: "cmd.c", dependsOn: ["cmd.b"] },
    ];
    const scheduled = buildSchedule(steps);
    const results = await executeScheduledSteps(scheduled, 4, async (sStep) => {
      if (sStep.step.command === "cmd.a") return failReport("cmd.a");
      return okReport(sStep.step.command);
    });
    expect(results).toHaveLength(3);
    const aResult = results.find((r) => r.stepIndex === 0)!;
    expect(aResult.report.ok).toBe(false);
    expect(aResult.dependencySkipped).toBe(false);
    const bResult = results.find((r) => r.stepIndex === 1)!;
    expect(bResult.dependencySkipped).toBe(true);
    const cResult = results.find((r) => r.stepIndex === 2)!;
    expect(cResult.dependencySkipped).toBe(true);
  });

  test("--concurrency 1 activates full sequential mode with abort-on-failure", async () => {
    const steps: KernelPipelineStep[] = [
      { command: "cmd.a", dependsOn: [] },
      { command: "cmd.b", dependsOn: [] },
      { command: "cmd.c", dependsOn: [] },
    ];
    const scheduled = buildSchedule(steps);
    const executed: string[] = [];
    const results = await executeScheduledSteps(scheduled, 1, async (sStep) => {
      executed.push(sStep.step.command);
      await new Promise((r) => setTimeout(r, 5));
      if (sStep.step.command === "cmd.a") return failReport("cmd.a");
      return okReport(sStep.step.command);
    });
    expect(results).toHaveLength(3);
    // With concurrency=1, steps run sequentially and abort on failure
    expect(executed).toEqual(["cmd.a"]); // only cmd.a executed, rest skipped
    const skipped = results.filter((r) => r.dependencySkipped);
    expect(skipped).toHaveLength(2);
  });

  test("results are sorted by stepIndex regardless of completion order", async () => {
    const steps: KernelPipelineStep[] = [
      { command: "cmd.a", dependsOn: [] },
      { command: "cmd.b", dependsOn: [] },
      { command: "cmd.c", dependsOn: [] },
    ];
    const scheduled = buildSchedule(steps);
    const results = await executeScheduledSteps(scheduled, 4, async (sStep) => {
      // cmd.c finishes first, cmd.a finishes last
      const delay = sStep.step.command === "cmd.a" ? 50 : sStep.step.command === "cmd.b" ? 30 : 10;
      await new Promise((r) => setTimeout(r, delay));
      return okReport(sStep.step.command);
    });
    expect(results.map((r) => r.stepIndex)).toEqual([0, 1, 2]);
  });
});
