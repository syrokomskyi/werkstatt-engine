// @vitest-environment node
/*
<MODULE_CONTRACT>
<purpose>RFC-0972: unit tests for CLI-level --json exit code policy. Verifies that process.exitCode is 0 when --json is passed, regardless of command/pipeline success or failure.</purpose>
<keywords>RFC-0972, CLI, exit code, --json, outputFormat</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0972: initial tests — command/pipeline paths, json/pretty modes, success/failure.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import process from "node:process";

const mockState = vi.hoisted(() => ({
  commandOk: true,
  commandExitCode: 0,
  pipelineOk: true,
  pipelineExitCode: 0,
}));

vi.mock("../kernel/index.ts", () => ({
  buildCommandManifest: vi.fn(),
  executeKernelCommand: vi.fn(() =>
    Promise.resolve({
      ok: mockState.commandOk,
      exitCode: mockState.commandExitCode,
      data: {},
      summary: mockState.commandOk ? "ok" : "fail",
    }),
  ),
  executeKernelPipeline: vi.fn(() =>
    Promise.resolve({
      ok: mockState.pipelineOk,
      exitCode: mockState.pipelineExitCode,
      data: {},
      summary: mockState.pipelineOk ? "ok" : "fail",
    }),
  ),
  findWorkspaceRoot: vi.fn(() => Promise.resolve("/tmp/test-workspace")),
  listSiteWorkspaces: vi.fn(() => Promise.resolve({ workspaceRoot: "/tmp", sites: [] })),
}));

vi.mock("../kernel/runtime/registry-cache.ts", () => ({
  setRegistryCacheEnabled: vi.fn(),
}));

vi.mock("../kernel/runtime/telemetry.ts", () => ({
  flushFactoryTelemetry: vi.fn(),
}));

vi.mock("../kernel/pipeline-hint.ts", () => ({
  pipelineHint: vi.fn(() => ""),
}));

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

beforeEach(() => {
  process.argv = ["node", "werkstatt"];
  process.exitCode = undefined;
  mockState.commandOk = true;
  mockState.commandExitCode = 0;
  mockState.pipelineOk = true;
  mockState.pipelineExitCode = 0;
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
});

async function runMain() {
  const { main } = await import("../kernel/cli/index.ts");
  await main();
}

test("--json command failure → process.exitCode 0", async () => {
  mockState.commandOk = false;
  mockState.commandExitCode = 1;
  process.argv = ["node", "werkstatt", "run", "some.command", "--json"];
  await runMain();
  expect(process.exitCode).toBe(0);
});

test("--json pipeline failure → process.exitCode 0", async () => {
  mockState.pipelineOk = false;
  mockState.pipelineExitCode = 1;
  process.argv = ["node", "werkstatt", "pipeline", "some.pipeline", "--json"];
  await runMain();
  expect(process.exitCode).toBe(0);
});

test("pretty mode command failure → process.exitCode 1", async () => {
  mockState.commandOk = false;
  mockState.commandExitCode = 1;
  process.argv = ["node", "werkstatt", "run", "some.command"];
  await runMain();
  expect(process.exitCode).toBe(1);
});

test("pretty mode pipeline failure → process.exitCode 1", async () => {
  mockState.pipelineOk = false;
  mockState.pipelineExitCode = 1;
  process.argv = ["node", "werkstatt", "pipeline", "some.pipeline"];
  await runMain();
  expect(process.exitCode).toBe(1);
});

test("--json command success → process.exitCode 0", async () => {
  mockState.commandOk = true;
  mockState.commandExitCode = 0;
  process.argv = ["node", "werkstatt", "run", "some.command", "--json"];
  await runMain();
  expect(process.exitCode).toBe(0);
});

test("--json pipeline success → process.exitCode 0", async () => {
  mockState.pipelineOk = true;
  mockState.pipelineExitCode = 0;
  process.argv = ["node", "werkstatt", "pipeline", "some.pipeline", "--json"];
  await runMain();
  expect(process.exitCode).toBe(0);
});
