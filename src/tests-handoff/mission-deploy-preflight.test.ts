// @vitest-environment node
/*
<MODULE_CONTRACT>
<purpose>RFC-1256: unit tests for mission.deploy-preflight command handler — aggregated step dispatch against a mission workpiece, per-step status aggregation, RFC-1157 site-module fallback, unavailable commands, workpiece context targeting.</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1256: initial tests — all-pass, failing-step aggregation, unavailable commands, site-module fallback, missing --mission, missing workpiece, workpiece context, warning-only pass.</item>
  <item>RFC-1256: a11y.contrast.lint + mission.deploy-preflight — early deploy-blocker detection</item>
  <item>RFC-1256: review fixes — manifest-derived systemId, at-statement boundary, alpha/NaN guards, resolveSiteWorkspace, execOnReadOnly drift</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
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
import { DEPLOY_PREFLIGHT_CHECKS } from "../mission/mission-deploy-preflight.ts";

const mockCheckState = vi.hoisted(() => ({
  // per-command error diagnostic counts; absent name → 0
  violations: {} as Record<string, number>,
  // per-command warning counts
  warnings: {} as Record<string, number>,
  // names of commands that report a self-skip ({skipped:true} payload)
  skipping: new Set<string>(),
  // when true, mocked site-module ActualStates carry the check commands
  // (mirroring the real site-module home of the validators).
  siteModuleChecks: true,
  // last site.directory seen by an executed check — asserts workpiece targeting.
  seenSiteDirs: {} as Record<string, string | undefined>,
  seenSiteNames: {} as Record<string, string | undefined>,
}));

let tempRoot: string;
const MISSION = "test-m000001";
const missionDir = () => join(tempRoot, "missions", MISSION);
const workpieceDir = () => join(missionDir(), "workpiece");

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
              commands: DEPLOY_PREFLIGHT_CHECKS.map((n) => makeMockCheckCommand(n)),
            },
          ]),
        );
      }
      return states;
    }),
  };
});

// Keep executeRegisteredCommand real — only computeOwnershipMap is stubbed so
// site-module generates entries merge without importing the site package.
vi.mock("../kernel/runtime/execute-command.ts", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    computeOwnershipMap: vi.fn(async () => []),
  };
});

function makeDiagnostic(ruleId: string, severity: "error" | "warning" | "info"): Diagnostic {
  return { ruleId, severity, message: `Test ${severity} for ${ruleId}` };
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
    execute: async (_input: KernelCommandInput, context: KernelRuntimeContext) => {
      mockCheckState.seenSiteDirs[name] = context.site?.directory;
      mockCheckState.seenSiteNames[name] = context.site?.name;
      if (mockCheckState.skipping.has(name)) {
        return {
          data: { systemId: context.site?.name, skipped: true, reason: "mock skip" },
          exitCode: 0,
          summary: `[${name}] skipped — mock reason`,
        };
      }
      const errors = mockCheckState.violations[name] ?? 0;
      const warnings = mockCheckState.warnings[name] ?? 0;
      return {
        data: makeCheckResult(name, errors, warnings),
        exitCode: errors > 0 ? 1 : 0,
        summary: `mock ${name}`,
      };
    },
  };
}

function makeContext(commandsInActualState = false): KernelRuntimeContext {
  const logger = createKernelLogger("pretty");
  const { io } = createDefaultIO();
  const actualState = buildActualState([
    {
      name: "test-ws",
      version: "0.0.0",
      declarations: [],
      pipelines: [],
      commands: commandsInActualState
        ? DEPLOY_PREFLIGHT_CHECKS.map((n) => makeMockCheckCommand(n))
        : [],
    },
  ]);
  return {
    workspaceRoot: tempRoot,
    siteExplicit: false,
    logger,
    dryRun: false,
    outputFormat: "pretty",
    io,
    actualState,
  };
}

const input = (flags: Record<string, unknown>): KernelCommandInput => ({
  argv: [],
  flags: flags as KernelCommandInput["flags"],
});

const MISSION_YAML = `schemaVersion: 1.0.0
missionId: test-m000001
systemId: test-system
state: open
brief: Test
openedAt: 2026-10-11T00:00:00.000Z
openedBy: test
closedAt: null
closedBy: null
pinAtOpen: 0.0.0
materializedAt: 2026-10-11T00:00:00.000Z
reconciledAt: null
migratedAt: null
releaseId: null
rfcId: null
operationId: op-test
`;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "deploy-preflight-test-"));
  mkdirSync(workpieceDir(), { recursive: true });
  writeFileSync(join(missionDir(), "mission.yaml"), MISSION_YAML);
  mockCheckState.violations = {};
  mockCheckState.warnings = {};
  mockCheckState.skipping = new Set();
  mockCheckState.siteModuleChecks = true;
  mockCheckState.seenSiteDirs = {};
  mockCheckState.seenSiteNames = {};
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

test("all-pass: every step executes against the workpiece → pass, exitCode 0", async () => {
  const { runMissionDeployPreflight } = await import("../mission/mission-deploy-preflight.ts");
  const result = await runMissionDeployPreflight(input({ mission: MISSION }), makeContext());
  expect(result.data?.status).toBe("pass");
  expect(result.data?.totalViolations).toBe(0);
  expect(result.data?.steps).toHaveLength(DEPLOY_PREFLIGHT_CHECKS.length);
  expect(result.data?.steps.every((s) => s.status === "pass")).toBe(true);
  expect(result.exitCode).toBe(0);
});

test("failing step: aggregation continues past the failure, all steps reported", async () => {
  mockCheckState.violations["semantic.parity"] = 2;
  mockCheckState.violations["nachweis.validate"] = 1;
  const { runMissionDeployPreflight } = await import("../mission/mission-deploy-preflight.ts");
  const result = await runMissionDeployPreflight(input({ mission: MISSION }), makeContext());
  expect(result.data?.status).toBe("fail");
  expect(result.data?.totalViolations).toBe(3);
  expect(result.data?.steps).toHaveLength(DEPLOY_PREFLIGHT_CHECKS.length);
  const failed = result.data!.steps.filter((s) => s.status === "fail");
  expect(failed.map((s) => s.command).sort()).toEqual(
    ["nachweis.validate", "semantic.parity"].sort(),
  );
  expect(failed.find((s) => s.command === "semantic.parity")?.violations).toBe(2);
  expect(result.exitCode).toBe(1);
  expect(result.nextSteps?.[0]?.action).toContain("semantic.parity");
});

test("warning-only step reports pass (advisory diagnostics do not block)", async () => {
  mockCheckState.warnings["a11y.contrast.lint"] = 4;
  const { runMissionDeployPreflight } = await import("../mission/mission-deploy-preflight.ts");
  const result = await runMissionDeployPreflight(input({ mission: MISSION }), makeContext());
  expect(result.data?.status).toBe("pass");
  expect(result.exitCode).toBe(0);
});

test("commands resolve through RFC-1157 site-module states when absent from workspace ActualState", async () => {
  const { runMissionDeployPreflight } = await import("../mission/mission-deploy-preflight.ts");
  const result = await runMissionDeployPreflight(input({ mission: MISSION }), makeContext(false));
  expect(result.data?.status).toBe("pass");
  expect(result.data?.steps.every((s) => s.status === "pass")).toBe(true);
});

test("unregistered commands report unavailable and count as violations", async () => {
  mockCheckState.siteModuleChecks = false;
  const { runMissionDeployPreflight } = await import("../mission/mission-deploy-preflight.ts");
  const result = await runMissionDeployPreflight(input({ mission: MISSION }), makeContext(false));
  expect(result.data?.status).toBe("fail");
  expect(result.data?.steps.every((s) => s.status === "unavailable")).toBe(true);
  expect(result.data?.totalViolations).toBe(DEPLOY_PREFLIGHT_CHECKS.length);
  expect(result.exitCode).toBe(1);
});

test("step context targets the mission workpiece, not the workspace root", async () => {
  const { runMissionDeployPreflight } = await import("../mission/mission-deploy-preflight.ts");
  await runMissionDeployPreflight(input({ mission: MISSION }), makeContext());
  for (const name of DEPLOY_PREFLIGHT_CHECKS) {
    expect(mockCheckState.seenSiteDirs[name]).toBe(workpieceDir());
  }
});

test("site.name carries manifest.systemId — identity-derived steps resolve the Sternsystem id (REV-01)", async () => {
  const { runMissionDeployPreflight } = await import("../mission/mission-deploy-preflight.ts");
  await runMissionDeployPreflight(input({ mission: MISSION }), makeContext());
  for (const name of DEPLOY_PREFLIGHT_CHECKS) {
    expect(mockCheckState.seenSiteNames[name]).toBe("test-system");
  }
});

test("self-skipping step reports status skipped with its reason, not pass (vacuity tripwire)", async () => {
  mockCheckState.skipping = new Set(["nachweis.validate"]);
  const { runMissionDeployPreflight } = await import("../mission/mission-deploy-preflight.ts");
  const result = await runMissionDeployPreflight(input({ mission: MISSION }), makeContext());
  const step = result.data!.steps.find((s) => s.command === "nachweis.validate");
  expect(step?.status).toBe("skipped");
  expect(step?.note).toContain("skipped");
  expect(result.data?.status).toBe("pass");
  expect(result.exitCode).toBe(0);
  expect(result.summary).toContain("1 skipped");
});

test("unavailable step records violations:1 (envelope consistency)", async () => {
  mockCheckState.siteModuleChecks = false;
  const { runMissionDeployPreflight } = await import("../mission/mission-deploy-preflight.ts");
  const result = await runMissionDeployPreflight(input({ mission: MISSION }), makeContext(false));
  expect(result.data!.steps.every((s) => s.violations === 1)).toBe(true);
});

test("missing --mission → exitCode 1, no steps", async () => {
  const { runMissionDeployPreflight } = await import("../mission/mission-deploy-preflight.ts");
  const result = await runMissionDeployPreflight(input({}), makeContext());
  expect(result.exitCode).toBe(1);
  expect(result.data?.steps).toHaveLength(0);
  expect(result.nextSteps?.[0]?.action).toContain("--mission");
});

test("missing workpiece → exitCode 1 with materialize hint", async () => {
  rmSync(workpieceDir(), { recursive: true, force: true });
  const { runMissionDeployPreflight } = await import("../mission/mission-deploy-preflight.ts");
  const result = await runMissionDeployPreflight(input({ mission: MISSION }), makeContext());
  expect(result.exitCode).toBe(1);
  expect(result.data?.steps).toHaveLength(0);
  expect(result.nextSteps?.[0]?.action).toContain("mission.materialize");
});

test("workpieceDirty is informational — no .git → false", async () => {
  const { runMissionDeployPreflight } = await import("../mission/mission-deploy-preflight.ts");
  const result = await runMissionDeployPreflight(input({ mission: MISSION }), makeContext());
  expect(result.data?.workpieceDirty).toBe(false);
});
