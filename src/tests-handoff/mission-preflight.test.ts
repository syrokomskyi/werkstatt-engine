// @vitest-environment node
/*
<MODULE_CONTRACT>
<purpose>RFC-0971: unit tests for mission.preflight command handler.</purpose>
<keywords>RFC-0971, mission.preflight, ownership.sync.validate, generated.stale.validate, cache clone</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0971: initial tests — all-pass, OWN-01 fail, OWN-DUP-01 fail, missing cache clone, empty cache clone, --json exit code.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  KernelCommandInput,
  KernelRuntimeContext,
  KernelCommandDefinition,
  CheckResult,
  Diagnostic,
} from "@warpgogol/werkstatt-engine/kernel";
import { createKernelLogger, createDefaultIO } from "@warpgogol/werkstatt-engine/kernel";
import { buildActualState } from "@warpgogol/werkstatt-engine/kernel";

const mockCheckState = vi.hoisted(() => ({
  ownershipViolations: 0,
  staleViolations: 0,
}));

let tempRoot: string;
let cacheClonePath: string;

vi.mock("../sternsystem/registry-io.ts", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    resolveCacheClonePath: vi.fn(() => cacheClonePath),
  };
});

function makeDiagnostic(ruleId: string, severity: "error" | "warning" | "info"): Diagnostic {
  return {
    ruleId,
    severity,
    message: `Test ${severity} for ${ruleId}`,
  };
}

function makeCheckResult(command: string, errorCount: number, warningCount = 0): CheckResult {
  const diagnostics: Diagnostic[] = [];
  for (let i = 0; i < errorCount; i++) {
    diagnostics.push(makeDiagnostic(`TEST-ERR-${i + 1}`, "error"));
  }
  for (let i = 0; i < warningCount; i++) {
    diagnostics.push(makeDiagnostic(`TEST-WARN-${i + 1}`, "warning"));
  }
  return {
    command,
    status: errorCount > 0 ? "fail" : "pass",
    diagnostics,
    summary: { error: errorCount, warning: warningCount, info: 0 },
  };
}

function makeMockCheckCommand(name: string): KernelCommandDefinition {
  return {
    name,
    description: `Mock ${name} for testing`,
    scope: "workspace",
    mutatesState: false,
    execute: () => {
      const violations =
        name === "ownership.sync.validate"
          ? mockCheckState.ownershipViolations
          : mockCheckState.staleViolations;
      return { data: makeCheckResult(name, violations) };
    },
  };
}

function makeContext(outputFormat: "pretty" | "json" = "pretty"): KernelRuntimeContext {
  const logger = createKernelLogger(outputFormat);
  const { io } = createDefaultIO();
  const actualState = buildActualState([
    {
      name: "test-mocks",
      version: "0.0.0",
      declarations: [],
      pipelines: [],
      commands: [
        makeMockCheckCommand("ownership.sync.validate"),
        makeMockCheckCommand("generated.stale.validate"),
      ],
    },
  ]);
  return {
    workspaceRoot: tempRoot,
    siteExplicit: false,
    logger,
    dryRun: false,
    outputFormat,
    io,
    actualState,
  };
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "preflight-test-"));
  cacheClonePath = join(tempRoot, "systems-cache", "test-system");
  mockCheckState.ownershipViolations = 0;
  mockCheckState.staleViolations = 0;
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

test("all-pass: cache clone with no violations → status pass, exitCode 0", async () => {
  mkdirSync(join(cacheClonePath, "public"), { recursive: true });
  const { runMissionPreflight } = await import("../mission/mission-preflight.ts");
  const input: KernelCommandInput = { argv: [], flags: { system: "test-system" } };
  const result = await runMissionPreflight(input, makeContext());
  expect(result.data?.status).toBe("pass");
  expect(result.data?.totalViolations).toBe(0);
  expect(result.data?.checks).toHaveLength(2);
  expect(result.data?.checks.every((c) => c.status === "pass")).toBe(true);
  expect(result.exitCode).toBe(0);
});

test("OWN-01 fail: ownership violations → status fail, exitCode 1", async () => {
  mkdirSync(join(cacheClonePath, "public"), { recursive: true });
  mockCheckState.ownershipViolations = 3;
  const { runMissionPreflight } = await import("../mission/mission-preflight.ts");
  const input: KernelCommandInput = { argv: [], flags: { system: "test-system" } };
  const result = await runMissionPreflight(input, makeContext());
  expect(result.data?.status).toBe("fail");
  expect(result.data?.totalViolations).toBe(3);
  const ownCheck = result.data?.checks.find((c) => c.command === "ownership.sync.validate");
  expect(ownCheck?.status).toBe("fail");
  expect(ownCheck?.violations).toBe(3);
  expect(result.exitCode).toBe(1);
  expect(result.nextSteps).toBeDefined();
  expect(result.nextSteps!.length).toBeGreaterThan(0);
});

test("OWN-DUP-01 fail: duplicate ownership violations → status fail, exitCode 1", async () => {
  mkdirSync(join(cacheClonePath, "public"), { recursive: true });
  mockCheckState.ownershipViolations = 2;
  const { runMissionPreflight } = await import("../mission/mission-preflight.ts");
  const input: KernelCommandInput = { argv: [], flags: { system: "test-system" } };
  const result = await runMissionPreflight(input, makeContext());
  expect(result.data?.status).toBe("fail");
  expect(result.data?.totalViolations).toBe(2);
  expect(result.exitCode).toBe(1);
});

test("missing cache clone: non-existent system → actionable error, exitCode 1", async () => {
  cacheClonePath = join(tempRoot, "systems-cache", "nonexistent");
  const { runMissionPreflight } = await import("../mission/mission-preflight.ts");
  const input: KernelCommandInput = { argv: [], flags: { system: "nonexistent" } };
  const result = await runMissionPreflight(input, makeContext());
  expect(result.data?.status).toBe("fail");
  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("Cache clone not found");
  expect(result.summary).toContain("sternsystem.register");
  expect(result.nextSteps).toBeDefined();
  expect(result.nextSteps!.length).toBeGreaterThan(0);
});

test("empty cache clone: no public/ directory → pass with 0 violations", async () => {
  mkdirSync(cacheClonePath, { recursive: true });
  const { runMissionPreflight } = await import("../mission/mission-preflight.ts");
  const input: KernelCommandInput = { argv: [], flags: { system: "test-system" } };
  const result = await runMissionPreflight(input, makeContext());
  expect(result.data?.status).toBe("pass");
  expect(result.data?.totalViolations).toBe(0);
  expect(result.exitCode).toBe(0);
});

test("--json handler returns exitCode 1 (CLI layer suppresses to 0 per RFC-0972)", async () => {
  mkdirSync(join(cacheClonePath, "public"), { recursive: true });
  mockCheckState.ownershipViolations = 5;
  const { runMissionPreflight } = await import("../mission/mission-preflight.ts");
  const input: KernelCommandInput = { argv: [], flags: { system: "test-system" } };
  const result = await runMissionPreflight(input, makeContext("json"));
  expect(result.data?.status).toBe("fail");
  expect(result.data?.totalViolations).toBe(5);
  expect(result.exitCode).toBe(1);
});
