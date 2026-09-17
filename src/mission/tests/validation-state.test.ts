import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  resolveValidationStatePath,
  readValidationState,
  writeValidationState,
  buildValidatorStatesFromSteps,
  type ValidationState,
} from "../validation-state.ts";
import type { KernelExecutionReport } from "@warpgogol/werkstatt-shared/kernel";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(process.cwd(), "tmp-validation-state-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveValidationStatePath", () => {
  test("joins workspaceRoot with missions/<id>/.validation-state.json", () => {
    expect(resolveValidationStatePath("/tmp/ws", "m000001")).toBe(
      join("/tmp/ws", "missions", "m000001", ".validation-state.json"),
    );
  });
});

describe("readValidationState", () => {
  test("returns null when file does not exist", async () => {
    expect(await readValidationState(tmpDir, "m000001")).toBeNull();
  });

  test("returns parsed state when file exists", async () => {
    const state: ValidationState = {
      missionId: "m000001",
      lastValidatedAt: "2026-01-01T00:00:00Z",
      lastValidationStatus: "pass",
      validatorStates: [],
    };
    await writeValidationState(tmpDir, state);
    const read = await readValidationState(tmpDir, "m000001");
    expect(read).not.toBeNull();
    expect(read!.missionId).toBe("m000001");
    expect(read!.lastValidationStatus).toBe("pass");
  });
});

describe("writeValidationState", () => {
  test("writes JSON file with state", async () => {
    const state: ValidationState = {
      missionId: "m000001",
      lastValidatedAt: "2026-01-01T00:00:00Z",
      lastValidationStatus: "fail",
      validatorStates: [{ commandName: "test.validate", status: "fail", cached: false }],
    };
    await writeValidationState(tmpDir, state);
    const read = await readValidationState(tmpDir, "m000001");
    expect(read!.validatorStates).toHaveLength(1);
    expect(read!.validatorStates[0]!.commandName).toBe("test.validate");
  });
});

describe("buildValidatorStatesFromSteps", () => {
  test("returns empty array for empty steps", () => {
    expect(buildValidatorStatesFromSteps([])).toEqual([]);
  });

  test("maps ok report to pass status", () => {
    const steps: KernelExecutionReport[] = [
      {
        commandName: "test.validate",
        exitCode: 0,
        ok: true,
        summary: "ok",
        metadata: {} as never,
        logs: [],
        timing: { durationMs: 100, exceededTimeout: false },
        filesModified: [],
      },
    ];
    const states = buildValidatorStatesFromSteps(steps);
    expect(states).toHaveLength(1);
    expect(states[0]!.status).toBe("pass");
    expect(states[0]!.commandName).toBe("test.validate");
    expect(states[0]!.cached).toBe(false);
    expect(states[0]!.durationMs).toBe(100);
  });

  test("maps failed report to fail status", () => {
    const steps: KernelExecutionReport[] = [
      {
        commandName: "test.validate",
        exitCode: 1,
        ok: false,
        summary: "fail",
        metadata: {} as never,
        logs: [],
        timing: { durationMs: 50, exceededTimeout: false },
        filesModified: [],
      },
    ];
    const states = buildValidatorStatesFromSteps(steps);
    expect(states[0]!.status).toBe("fail");
  });

  test("maps logSummary to diagnosticCounts", () => {
    const steps: KernelExecutionReport[] = [
      {
        commandName: "test.validate",
        exitCode: 0,
        ok: true,
        summary: "ok",
        metadata: {} as never,
        logs: [],
        timing: { durationMs: 10, exceededTimeout: false },
        filesModified: [],
        logSummary: { error: 1, warning: 2, notice: 3, expectedFallback: 0, suppressedDebug: 0 },
      },
    ];
    const states = buildValidatorStatesFromSteps(steps);
    expect(states[0]!.diagnosticCounts).toEqual({ error: 1, warning: 2, info: 3 });
  });

  test("detects fromCache flag", () => {
    const steps: KernelExecutionReport[] = [
      {
        commandName: "test.validate",
        exitCode: 0,
        ok: true,
        summary: "ok",
        metadata: {} as never,
        logs: [],
        timing: { durationMs: 10, exceededTimeout: false, fromCache: true } as never,
        filesModified: [],
      },
    ];
    const states = buildValidatorStatesFromSteps(steps);
    expect(states[0]!.cached).toBe(true);
  });
});
