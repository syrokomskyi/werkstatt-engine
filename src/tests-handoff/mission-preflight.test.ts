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
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
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
  // RFC-1157: when true, the mocked site-module ActualStates carry the two
  // preflight check commands (mirroring the post-RFC-1147 site-module home).
  siteModuleChecks: false,
  // RFC-1157: last ownershipMap length seen by an executed check command;
  // -1 means no check captured a context yet.
  seenOwnershipLength: -1,
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

// RFC-1157: mock site-module ActualState materialization so tests can place
// the preflight checks outside the workspace ActualState without loading the
// real @warpgogol/werkstatt-site module graph.
vi.mock("../kernel/runtime/registry-cache.ts", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    getOrBuildSiteModuleStates: vi.fn(async () => {
      const states = new Map<string, unknown>();
      if (mockCheckState.siteModuleChecks) {
        states.set(
          "test-site-module",
          buildActualState([
            {
              name: "test-site-module",
              version: "0.0.0",
              declarations: [],
              pipelines: [],
              commands: [
                makeMockCheckCommand("ownership.sync.validate"),
                makeMockCheckCommand("generated.stale.validate"),
              ],
            },
          ]),
        );
      }
      return states;
    }),
  };
});

// RFC-1157: keep executeRegisteredCommand real — only computeOwnershipMap is
// stubbed so site-module generates entries can be injected without importing
// @warpgogol/werkstatt-site/checks.
vi.mock("../kernel/runtime/execute-command.ts", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    computeOwnershipMap: vi.fn(async () =>
      mockCheckState.siteModuleChecks
        ? [
            {
              command: "sentinel.gen",
              artifact: { path: "public/sentinel.png" },
              markerPolicy: "embedded",
            },
          ]
        : [],
    ),
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
    execute: (_input: KernelCommandInput, context: KernelRuntimeContext) => {
      // RFC-1157: capture the ownership map size so tests can assert that
      // site-module generates declarations reached the check context.
      mockCheckState.seenOwnershipLength = context.ownershipMap?.length ?? -1;
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

function makeContextWithoutChecks(
  outputFormat: "pretty" | "json" = "pretty",
): KernelRuntimeContext {
  const logger = createKernelLogger(outputFormat);
  const { io } = createDefaultIO();
  const actualState = buildActualState([
    { name: "test-empty", version: "0.0.0", declarations: [], pipelines: [], commands: [] },
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
  mockCheckState.siteModuleChecks = false;
  mockCheckState.seenOwnershipLength = -1;
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

test("RFC-1157: checks absent from workspace ActualState resolve via site-module states", async () => {
  mkdirSync(join(cacheClonePath, "public"), { recursive: true });
  mockCheckState.siteModuleChecks = true;
  const { runMissionPreflight } = await import("../mission/mission-preflight.ts");
  const input: KernelCommandInput = { argv: [], flags: { system: "test-system" } };
  const result = await runMissionPreflight(input, makeContextWithoutChecks());
  expect(result.data?.status).toBe("pass");
  expect(result.data?.checks).toHaveLength(2);
  expect(result.data?.checks.every((c) => c.status === "pass")).toBe(true);
  expect(result.exitCode).toBe(0);
  // RFC-1157: site-module ownership map reached the check context — the
  // mocked computeOwnershipMap contributes one sentinel entry per state.
  expect(mockCheckState.seenOwnershipLength).toBe(1);
});

test("RFC-1157: checks absent from all ActualStates still fail as unregistered", async () => {
  mkdirSync(join(cacheClonePath, "public"), { recursive: true });
  const { runMissionPreflight } = await import("../mission/mission-preflight.ts");
  const input: KernelCommandInput = { argv: [], flags: { system: "test-system" } };
  const result = await runMissionPreflight(input, makeContextWithoutChecks());
  expect(result.data?.status).toBe("fail");
  expect(result.data?.checks.every((c) => c.status === "fail")).toBe(true);
  expect(result.exitCode).toBe(1);
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
