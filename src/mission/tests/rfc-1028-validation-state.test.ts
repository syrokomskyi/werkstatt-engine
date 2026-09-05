import { test, expect } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveValidationStatePath,
  readValidationState,
  writeValidationState,
  buildValidatorStatesFromSteps,
  type ValidationState,
} from "../validation-state.ts";
import type { KernelExecutionReport } from "../../kernel/types.ts";

/*
<MODULE_CONTRACT>
  <purpose>
    RFC-1028: Test validation-state.ts — path resolution, read/write round-trip,
    and buildValidatorStatesFromSteps conversion.
  </purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1028: initial tests for validation-state.ts helpers.</item>
</CHANGE_SUMMARY>
*/

test("resolveValidationStatePath produces correct path", () => {
  const result = resolveValidationStatePath("/workspace", "m000123");
  expect(result).toBe(join("/workspace", "missions", "m000123", ".validation-state.json"));
});

test("writeValidationState creates file and readValidationState reads it back", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "rfc1028-"));
  try {
    const state: ValidationState = {
      missionId: "m-test",
      lastValidatedAt: "2025-01-01T00:00:00Z",
      lastValidationStatus: "pass",
      validatorStates: [
        {
          commandName: "test.check",
          status: "pass",
          cached: false,
          durationMs: 100,
        },
      ],
    };
    await writeValidationState(tmpDir, state);
    const read = await readValidationState(tmpDir, "m-test");
    expect(read).toEqual(state);

    // Verify file content is valid JSON with newline
    const raw = await readFile(
      join(tmpDir, "missions", "m-test", ".validation-state.json"),
      "utf-8",
    );
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual(state);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("readValidationState returns null when file does not exist", async () => {
  const tmpDir = await mkdtemp(join(tmpdir(), "rfc1028-"));
  try {
    const read = await readValidationState(tmpDir, "nonexistent");
    expect(read).toBeNull();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("buildValidatorStatesFromSteps converts KernelExecutionReport[] to ValidatorState[]", () => {
  const steps: KernelExecutionReport[] = [
    {
      commandName: "check.ownership",
      exitCode: 0,
      ok: true,
      metadata: {} as never,
      logs: [],
      timing: { durationMs: 50, exceededTimeout: false, fromCache: true } as never,
      logSummary: { error: 0, warning: 2, notice: 1, expectedFallback: 0, suppressedDebug: 0 },
    },
    {
      commandName: "check.content",
      exitCode: 1,
      ok: false,
      metadata: {} as never,
      logs: [],
      timing: { durationMs: 200, exceededTimeout: false, fromCache: false } as never,
      logSummary: { error: 3, warning: 0, notice: 0, expectedFallback: 0, suppressedDebug: 0 },
    },
  ];
  const result = buildValidatorStatesFromSteps(steps);
  expect(result).toHaveLength(2);
  expect(result[0]).toEqual({
    commandName: "check.ownership",
    status: "pass",
    cached: true,
    durationMs: 50,
    diagnosticCounts: { error: 0, warning: 2, info: 1 },
  });
  expect(result[1]).toEqual({
    commandName: "check.content",
    status: "fail",
    cached: false,
    durationMs: 200,
    diagnosticCounts: { error: 3, warning: 0, info: 0 },
  });
});

test("buildValidatorStatesFromSteps handles empty array", () => {
  const result = buildValidatorStatesFromSteps([]);
  expect(result).toEqual([]);
});

test("buildValidatorStatesFromSteps handles missing logSummary", () => {
  const steps: KernelExecutionReport[] = [
    {
      commandName: "check.basic",
      exitCode: 0,
      ok: true,
      metadata: {} as never,
      logs: [],
      timing: { durationMs: 10, exceededTimeout: false } as never,
    },
  ];
  const result = buildValidatorStatesFromSteps(steps);
  expect(result[0].diagnosticCounts).toBeUndefined();
  expect(result[0].cached).toBe(false);
});
