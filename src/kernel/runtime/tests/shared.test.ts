import { test, expect, describe } from "vitest";
import { summarizeLogs, assertKnownOptionKeys } from "../shared.ts";
import type { KernelExecutionReport } from "../../types.ts";

function makeLog(
  overrides: Partial<KernelExecutionReport["logs"][number]> = {},
): KernelExecutionReport["logs"][number] {
  return {
    level: "info",
    message: "test",
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("summarizeLogs", () => {
  test("returns zero counts for empty logs", () => {
    expect(summarizeLogs([])).toEqual({
      error: 0,
      warning: 0,
      notice: 0,
      expectedFallback: 0,
      suppressedDebug: 0,
    });
  });

  test("counts errors by severity field", () => {
    const logs = [
      makeLog({ severity: "error" }),
      makeLog({ severity: "error" }),
      makeLog({ severity: "warning" }),
    ];
    expect(summarizeLogs(logs)).toMatchObject({ error: 2, warning: 1 });
  });

  test("counts errors by level field", () => {
    const logs = [makeLog({ level: "error" as never, severity: undefined })];
    expect(summarizeLogs(logs)).toMatchObject({ error: 1 });
  });

  test("counts warnings by level=warn", () => {
    const logs = [makeLog({ level: "warn" as never, severity: undefined })];
    expect(summarizeLogs(logs)).toMatchObject({ warning: 1 });
  });

  test("counts notice severity", () => {
    const logs = [makeLog({ severity: "notice" })];
    expect(summarizeLogs(logs)).toMatchObject({ notice: 1 });
  });

  test("counts expected-fallback kind", () => {
    const logs = [makeLog({ kind: "expected-fallback" })];
    expect(summarizeLogs(logs)).toMatchObject({ expectedFallback: 1 });
  });

  test("counts debug severity as suppressedDebug", () => {
    const logs = [makeLog({ severity: "debug" })];
    expect(summarizeLogs(logs)).toMatchObject({ suppressedDebug: 1 });
  });
});

describe("assertKnownOptionKeys", () => {
  test("does not throw when all keys are known", () => {
    expect(() =>
      assertKnownOptionKeys({ a: 1, b: 2 }, ["a", "b", "c"], "test"),
    ).not.toThrow();
  });

  test("throws on unknown key", () => {
    expect(() =>
      assertKnownOptionKeys({ a: 1, z: 2 }, ["a", "b"], "test"),
    ).toThrow(/unknown key.*z/);
  });

  test("includes label in error message", () => {
    expect(() =>
      assertKnownOptionKeys({ z: 1 }, ["a"], "myLabel"),
    ).toThrow(/myLabel/);
  });

  test("provides nearest-key hint for typos", () => {
    expect(() =>
      assertKnownOptionKeys({ argx: 1 }, ["argv"], "test"),
    ).toThrow(/did you mean.*argv/);
  });

  test("does not provide hint when distance > 3", () => {
    expect(() =>
      assertKnownOptionKeys({ completelyDifferent: 1 }, ["argv"], "test"),
    ).toThrow(/"completelyDifferent"/);
  });

  test("handles empty options object", () => {
    expect(() => assertKnownOptionKeys({}, ["a"], "test")).not.toThrow();
  });
});
