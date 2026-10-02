import { test, expect, describe } from "vitest";
import { buildSchedule, executeScheduledSteps, ScheduleError } from "../pipeline-scheduler.ts";
import { applyWarnOnly } from "../execute-pipeline.ts";
import type { KernelExecutionReport, KernelPipelineStep } from "@warpgogol/werkstatt-shared/kernel";

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
    const schedule = buildSchedule([{ command: "a" }, { command: "b", dependsOn: [] }]);
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
    expect(() => buildSchedule([{ command: "a", dependsOn: ["nonexistent"] }])).toThrow(
      /not in the pipeline/,
    );
  });

  test("throws on forward reference", () => {
    expect(() => buildSchedule([{ command: "a", dependsOn: ["b"] }, { command: "b" }])).toThrow(
      /forward reference/,
    );
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
    const schedule = buildSchedule([{ command: "a" }, { command: "b" }, { command: "c" }]);
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
    const schedule = buildSchedule([{ command: "a" }, { command: "b", dependsOn: [] }]);
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

describe("executeScheduledSteps — RFC-1144 collect-errors", () => {
  test("AC-1: read-only steps run to completion after a failed dependency", async () => {
    const schedule = buildSchedule(steps("a", "b", "c"));
    schedule[1]!.readOnly = true;
    schedule[2]!.readOnly = true;
    const executed: string[] = [];
    const results = await executeScheduledSteps(
      schedule,
      1,
      async (s) => {
        executed.push(s.step.command);
        if (s.step.command === "a") return failReport(s.step.command);
        return okReport(s.step.command);
      },
      { collectErrors: true },
    );
    expect(executed).toEqual(["a", "b", "c"]);
    expect(results).toHaveLength(3);
    expect(results[1]!.dependencySkipped).toBe(false);
    expect(results[1]!.report.ok).toBe(true);
    expect(results[2]!.dependencySkipped).toBe(false);
  });

  test("AC-2: read-only step that ran after a failed dependency is annotated", async () => {
    const schedule = buildSchedule(steps("a", "b"));
    schedule[1]!.readOnly = true;
    const seen = new Map<string, boolean | undefined>();
    await executeScheduledSteps(
      schedule,
      1,
      async (s) => {
        seen.set(s.step.command, s.ranAfterFailedDependency);
        if (s.step.command === "a") return failReport(s.step.command);
        return okReport(s.step.command);
      },
      { collectErrors: true },
    );
    expect(seen.get("a")).toBeUndefined();
    expect(seen.get("b")).toBe(true);
  });

  test("AC-3: mutating step still skips after a failed dependency under collect-errors", async () => {
    const schedule = buildSchedule(steps("a", "b", "c"));
    schedule[1]!.readOnly = true; // b read-only — runs tainted
    // c has no readOnly — treated as mutating (conservative default)
    const executed: string[] = [];
    const results = await executeScheduledSteps(
      schedule,
      1,
      async (s) => {
        executed.push(s.step.command);
        if (s.step.command === "a") return failReport(s.step.command);
        return okReport(s.step.command);
      },
      { collectErrors: true },
    );
    expect(executed).toEqual(["a", "b"]);
    expect(results[2]!.dependencySkipped).toBe(true);
  });

  test("AC-4: without collectErrors, read-only steps skip like everything else", async () => {
    const schedule = buildSchedule(steps("a", "b"));
    schedule[1]!.readOnly = true;
    const executed: string[] = [];
    const results = await executeScheduledSteps(schedule, 1, async (s) => {
      executed.push(s.step.command);
      if (s.step.command === "a") return failReport(s.step.command);
      return okReport(s.step.command);
    });
    expect(executed).toEqual(["a"]);
    expect(results[1]!.dependencySkipped).toBe(true);
  });

  test("transitive taint: read-only step that ran-tainted still skips mutating dependents", async () => {
    const schedule = buildSchedule([
      { command: "a" },
      { command: "b", dependsOn: ["a"] },
      { command: "c", dependsOn: ["b"] },
      { command: "d", dependsOn: ["b"] },
    ]);
    schedule[1]!.readOnly = true; // b read-only — runs tainted, passes
    schedule[3]!.readOnly = true; // d read-only — runs annotated
    // c is mutating — must skip even though b passed
    const executed: string[] = [];
    const seen = new Map<string, boolean | undefined>();
    const results = await executeScheduledSteps(
      schedule,
      2,
      async (s) => {
        executed.push(s.step.command);
        seen.set(s.step.command, s.ranAfterFailedDependency);
        if (s.step.command === "a") return failReport(s.step.command);
        return okReport(s.step.command);
      },
      { collectErrors: true },
    );
    expect(executed.sort()).toEqual(["a", "b", "d"]);
    expect(seen.get("b")).toBe(true);
    expect(seen.get("d")).toBe(true);
    expect(results[2]!.dependencySkipped).toBe(true); // c skipped — mutating on tainted dep
    expect(results[3]!.dependencySkipped).toBe(false); // d ran — read-only
  });

  test("read-only step that ran-tainted and failed still taints dependents", async () => {
    const schedule = buildSchedule(steps("a", "b", "c"));
    schedule[1]!.readOnly = true;
    schedule[2]!.readOnly = true;
    const results = await executeScheduledSteps(
      schedule,
      1,
      async (s) => {
        if (s.step.command === "a" || s.step.command === "b") return failReport(s.step.command);
        return okReport(s.step.command);
      },
      { collectErrors: true },
    );
    // b ran-tainted and failed — c (read-only) still runs, annotated.
    expect(results[1]!.report.ok).toBe(false);
    expect(results[2]!.dependencySkipped).toBe(false);
    expect(results[2]!.report.ok).toBe(true);
  });
});

describe("executeScheduledSteps — RFC-1184 warnOnly", () => {
  test("AC-2: failing warnOnly step completes, dependents run, report carries warned", async () => {
    const schedule = buildSchedule([
      { command: "gate.new", warnOnly: true },
      { command: "dependent.step" },
    ]);
    const ran: string[] = [];
    const results = await executeScheduledSteps(schedule, 1, async (s) => {
      ran.push(s.step.command);
      const report =
        s.step.command === "gate.new" ? failReport("gate.new") : okReport(s.step.command);
      // Production wiring: applyWarnOnly runs inside the executor callback
      // before the report returns — the scheduler only ever reads ok.
      applyWarnOnly(report, s.step);
      return report;
    });
    expect(ran).toEqual(["gate.new", "dependent.step"]);
    expect(results.every((r) => !r.dependencySkipped)).toBe(true);
    const warnResult = results.find((r) => r.stepIndex === 0)!;
    expect(warnResult.report.ok).toBe(true);
    expect(warnResult.report.warned).toBe(true);
    // Failure evidence preserved for diagnostics even though ok flipped.
    expect(warnResult.report.exitCode).toBe(1);
  });

  test("AC-4: non-warnOnly failure still skips dependents and stays failed", async () => {
    const schedule = buildSchedule([{ command: "gate.old" }, { command: "dependent.step" }]);
    const results = await executeScheduledSteps(schedule, 1, async (s) => {
      const report =
        s.step.command === "gate.old" ? failReport("gate.old") : okReport(s.step.command);
      applyWarnOnly(report, s.step);
      return report;
    });
    expect(results[0]!.report.ok).toBe(false);
    expect(results[0]!.report.warned).toBeUndefined();
    expect(results[1]!.dependencySkipped).toBe(true);
  });
});
