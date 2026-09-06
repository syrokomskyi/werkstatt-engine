import { test, expect, describe } from "vitest";
import {
  buildSchedule,
  executeScheduledSteps,
  ScheduleError,
  type ScheduledStep,
} from "../pipeline-scheduler.ts";
import type { KernelExecutionReport, KernelPipelineStep } from "../../types.ts";

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

function steps(...cmds: string[]): KernelPipelineStep[] {
  return cmds.map((cmd) => ({ command: cmd }));
}

describe("buildSchedule", () => {
  test("empty steps returns empty schedule", () => {
    expect(buildSchedule([])).toEqual([]);
  });

  test("single step has no dependencies", () => {
    const schedule = buildSchedule(steps("a"));
    expect(schedule).toHaveLength(1);
    expect(schedule[0]!.dependencies.size).toBe(0);
  });

  test("two sequential steps: second depends on first", () => {
    const schedule = buildSchedule(steps("a", "b"));
    expect(schedule[1]!.dependencies).toEqual(new Set([0]));
  });

  test("explicit dependsOn: [] removes implicit dependency", () => {
    const schedule = buildSchedule([
      { command: "a" },
      { command: "b", dependsOn: [] },
    ]);
    expect(schedule[1]!.dependencies.size).toBe(0);
  });

  test("explicit dependsOn resolves command names to indices", () => {
    const schedule = buildSchedule([
      { command: "a" },
      { command: "b" },
      { command: "c", dependsOn: ["a"] },
    ]);
    expect(schedule[2]!.dependencies).toEqual(new Set([0]));
  });

  test("throws on duplicate command names", () => {
    expect(() => buildSchedule(steps("a", "a"))).toThrow(ScheduleError);
    expect(() => buildSchedule(steps("a", "a"))).toThrow(/Duplicate command name/);
  });

  test("throws on missing dependency reference", () => {
    expect(() =>
      buildSchedule([{ command: "a", dependsOn: ["nonexistent"] }]),
    ).toThrow(/not in the pipeline/);
  });

  test("throws on forward reference", () => {
    expect(() =>
      buildSchedule([
        { command: "a", dependsOn: ["b"] },
        { command: "b" },
      ]),
    ).toThrow(/forward reference/);
  });

  test("skipped steps do not create implicit dependencies", () => {
    const schedule = buildSchedule([
      { command: "a" },
      { command: "b", skip: true },
      { command: "c" },
    ]);
    expect(schedule[2]!.dependencies).toEqual(new Set([0]));
  });
});

describe("executeScheduledSteps", () => {
  test("executes all steps sequentially with concurrency=1", async () => {
    const schedule = buildSchedule(steps("a", "b", "c"));
    const executed: string[] = [];
    const results = await executeScheduledSteps(schedule, 1, async (s) => {
      executed.push(s.step.command);
      return okReport(s.step.command);
    });
    expect(results).toHaveLength(3);
    expect(executed).toEqual(["a", "b", "c"]);
    expect(results.every((r) => !r.dependencySkipped)).toBe(true);
  });

  test("aborts on failure with concurrency=1", async () => {
    const schedule = buildSchedule(steps("a", "b", "c"));
    const results = await executeScheduledSteps(schedule, 1, async (s) => {
      if (s.step.command === "b") return failReport(s.step.command);
      return okReport(s.step.command);
    });
    expect(results).toHaveLength(3);
    expect(results[1]!.report.ok).toBe(false);
    expect(results[2]!.dependencySkipped).toBe(true);
  });

  test("parallel execution with concurrency > 1", async () => {
    const schedule = buildSchedule([
      { command: "a" },
      { command: "b" },
      { command: "c" },
    ]);
    const results = await executeScheduledSteps(schedule, 3, async (s) => {
      return okReport(s.step.command);
    });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.report.ok)).toBe(true);
  });

  test("skips dependents of failed step with concurrency > 1", async () => {
    const schedule = buildSchedule([
      { command: "a" },
      { command: "b", dependsOn: ["a"] },
      { command: "c", dependsOn: ["b"] },
    ]);
    const results = await executeScheduledSteps(schedule, 2, async (s) => {
      if (s.step.command === "a") return failReport(s.step.command);
      return okReport(s.step.command);
    });
    expect(results).toHaveLength(3);
    expect(results[0]!.report.ok).toBe(false);
    expect(results[1]!.dependencySkipped).toBe(true);
    expect(results[2]!.dependencySkipped).toBe(true);
  });

  test("independent steps continue when a step fails", async () => {
    const schedule = buildSchedule([
      { command: "a" },
      { command: "b", dependsOn: [] },
    ]);
    const results = await executeScheduledSteps(schedule, 2, async (s) => {
      if (s.step.command === "a") return failReport(s.step.command);
      return okReport(s.step.command);
    });
    expect(results).toHaveLength(2);
    expect(results[1]!.report.ok).toBe(true);
    expect(results[1]!.dependencySkipped).toBe(false);
  });

  test("results are sorted by stepIndex", async () => {
    const schedule = buildSchedule(steps("a", "b", "c"));
    const results = await executeScheduledSteps(schedule, 3, async (s) => {
      return okReport(s.step.command);
    });
    expect(results.map((r) => r.stepIndex)).toEqual([0, 1, 2]);
  });
});
