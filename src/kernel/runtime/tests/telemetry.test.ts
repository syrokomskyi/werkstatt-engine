/*
<MODULE_CONTRACT>
<purpose>
Unit tests for telemetry covering recordCommandTelemetry; getFactoryTelemetryPusher; flushFactoryTelemetry. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Fixtures stay inline and minimal so each case states its own setup.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the telemetry suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/
// @ai-invariant fixtures must not couple to kernel internals beyond the public surface under test

import { test, expect, describe } from "vitest";
import {
  recordCommandTelemetry,
  getFactoryTelemetryPusher,
  flushFactoryTelemetry,
} from "../telemetry.ts";
import type { KernelExecutionReport } from "@warpgogol/werkstatt-shared/kernel";
import type { MetricsPusher } from "@warpgogol/werkstatt-shared/observability";

function makeReport(overrides: Partial<KernelExecutionReport> = {}): KernelExecutionReport {
  return {
    commandName: "test.cmd",
    exitCode: 0,
    ok: true,
    summary: "ok",
    metadata: {} as never,
    logs: [],
    timing: { durationMs: 100, exceededTimeout: false },
    filesModified: [],
    ...overrides,
  };
}

function mockPusher(): MetricsPusher {
  return {
    flush: async () => {},
  } as unknown as MetricsPusher;
}

describe("recordCommandTelemetry", () => {
  test("does not throw on valid report", () => {
    expect(() => recordCommandTelemetry(mockPusher(), makeReport())).not.toThrow();
  });

  test("does not throw on null pusher", () => {
    expect(() =>
      recordCommandTelemetry(null as unknown as MetricsPusher, makeReport()),
    ).not.toThrow();
  });

  test("does not throw on report with missing fields", () => {
    expect(() =>
      recordCommandTelemetry(mockPusher(), makeReport({ timing: undefined })),
    ).not.toThrow();
  });

  test("handles report with diagnostics data", () => {
    const report = makeReport({
      data: {
        diagnostics: [{ severity: "error" }, { severity: "error" }, { severity: "warning" }],
      } as never,
    });
    expect(() => recordCommandTelemetry(mockPusher(), report)).not.toThrow();
  });

  test("handles report with timeout", () => {
    const report = makeReport({
      timing: { durationMs: 5000, exceededTimeout: true },
      exitCode: 124,
      ok: false,
    });
    expect(() => recordCommandTelemetry(mockPusher(), report)).not.toThrow();
  });

  test("handles report with siteName", () => {
    const report = makeReport({ siteName: "my-site" });
    expect(() => recordCommandTelemetry(mockPusher(), report)).not.toThrow();
  });
});

describe("getFactoryTelemetryPusher", () => {
  test("returns a pusher or null without throwing", () => {
    const p = getFactoryTelemetryPusher();
    expect(p === null || p !== undefined).toBe(true);
  });
});

describe("flushFactoryTelemetry", () => {
  test("resolves without throwing", async () => {
    await expect(flushFactoryTelemetry()).resolves.toBeUndefined();
  });
});
