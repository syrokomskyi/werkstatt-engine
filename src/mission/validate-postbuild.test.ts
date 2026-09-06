/*
<MODULE_CONTRACT>
  <purpose>RFC-0883: Unit tests for validate.postbuild command handler.</purpose>
  <keywords>RFC-0883, validate-postbuild, post-build, skip-slow, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0883: initial unit tests for runValidatePostbuild.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const original = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...original,
    executeKernelPipeline: vi.fn(),
    executeKernelCommand: vi.fn(),
    loadAppRuntime: vi.fn(),
    resolveSiteWorkspace: vi.fn(),
  };
});

vi.mock("./mission-io.ts", () => ({
  readMissionManifest: vi.fn(),
  resolveMissionDir: vi.fn(),
}));

import { runValidatePostbuild } from "./validate-postbuild.ts";
import {
  executeKernelPipeline,
  executeKernelCommand,
  loadAppRuntime,
  resolveSiteWorkspace,
} from "@warpgogol/werkstatt-engine/kernel";
import { readMissionManifest, resolveMissionDir } from "./mission-io.ts";

const mockExecuteKernelPipeline = vi.mocked(executeKernelPipeline);
const mockExecuteKernelCommand = vi.mocked(executeKernelCommand);
const mockLoadAppRuntime = vi.mocked(loadAppRuntime);
const mockResolveSiteWorkspace = vi.mocked(resolveSiteWorkspace);
const mockReadMissionManifest = vi.mocked(readMissionManifest);
const mockResolveMissionDir = vi.mocked(resolveMissionDir);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-validate-postbuild-"));
  mockExecuteKernelPipeline.mockReset();
  mockExecuteKernelCommand.mockReset();
  mockLoadAppRuntime.mockReset();
  mockResolveSiteWorkspace.mockReset();
  mockReadMissionManifest.mockReset();
  mockResolveMissionDir.mockReset();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeContext(workspaceRoot: string) {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    section: vi.fn(),
    getEvents: vi.fn(() => []),
  };
  return { workspaceRoot, logger } as never;
}

function makePipelineReport(
  ok: boolean,
  steps: Array<{ commandName: string; ok: boolean; exitCode: number; durationMs: number }>,
) {
  return {
    pipelineName: "sites-check.postbuild",
    exitCode: ok ? 0 : 1,
    ok,
    steps: steps.map((s) => ({
      commandName: s.commandName,
      ok: s.ok,
      exitCode: s.exitCode,
      timing: { durationMs: s.durationMs, exceededTimeout: false },
    })),
    timing: {
      pipeline: "sites-check.postbuild",
      totalDurationMs: steps.reduce((sum, s) => sum + s.durationMs, 0),
      stepCount: steps.length,
      slowestSteps: [],
      timeoutCount: 0,
      warningCount: 0,
    },
  } as never;
}

test("dist/ missing → exit code 1 with error message", async () => {
  mockResolveSiteWorkspace.mockResolvedValue({
    name: "test-bundle",
    directory: tmpDir,
    toolsDirectory: path.join(tmpDir, "tools"),
    configPath: path.join(tmpDir, "tools", "kernel.config.ts"),
  } as never);

  const result = await runValidatePostbuild(
    { flags: { site: "test-bundle" } } as never,
    makeContext(tmpDir),
  );

  expect(result.exitCode).toBe(1);
  expect(result.summary).toContain("No dist/ found");
  expect(result.data?.status).toBe("fail");
  expect(result.data?.steps).toEqual([]);
});

test("dist/ exists → runs all validators via executeKernelPipeline", async () => {
  await fs.mkdir(path.join(tmpDir, "dist"), { recursive: true });

  mockResolveSiteWorkspace.mockResolvedValue({
    name: "test-bundle",
    directory: tmpDir,
    toolsDirectory: path.join(tmpDir, "tools"),
    configPath: path.join(tmpDir, "tools", "kernel.config.ts"),
  } as never);

  mockExecuteKernelPipeline.mockResolvedValue(
    makePipelineReport(true, [
      { commandName: "seo.technical.validate", ok: true, exitCode: 0, durationMs: 100 },
      { commandName: "image.delivery.validate", ok: true, exitCode: 0, durationMs: 200 },
    ]),
  );

  const result = await runValidatePostbuild(
    { flags: { site: "test-bundle" } } as never,
    makeContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data?.status).toBe("pass");
  expect(result.data?.steps).toHaveLength(2);
  expect(result.data?.steps[0]!.name).toBe("seo.technical.validate");
  expect(result.data?.steps[0]!.status).toBe("ok");
  expect(mockExecuteKernelPipeline).toHaveBeenCalledOnce();
});

test("dist/ exists with --skip-slow → slow steps skipped, fast steps run individually", async () => {
  await fs.mkdir(path.join(tmpDir, "dist"), { recursive: true });

  mockResolveSiteWorkspace.mockResolvedValue({
    name: "test-bundle",
    directory: tmpDir,
    toolsDirectory: path.join(tmpDir, "tools"),
    configPath: path.join(tmpDir, "tools", "kernel.config.ts"),
  } as never);

  const pipelineSteps = [
    { command: "seo.technical.validate" },
    { command: "image.delivery.validate" },
    { command: "mobile.layout.check" },
    { command: "lighthouse.budget.check" },
    { command: "qa.independent.run" },
  ];

  mockLoadAppRuntime.mockResolvedValue({
    registry: {
      getPipeline: vi.fn(() => pipelineSteps),
    },
  } as never);

  mockExecuteKernelCommand.mockResolvedValue({
    commandName: "seo.technical.validate",
    ok: true,
    exitCode: 0,
    timing: { durationMs: 50, exceededTimeout: false },
  } as never);

  const result = await runValidatePostbuild(
    { flags: { site: "test-bundle", "skip-slow": true } } as never,
    makeContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data?.status).toBe("pass");
  const stepNames = result.data?.steps.map((s) => s.name);
  expect(stepNames).toContain("seo.technical.validate");
  expect(stepNames).toContain("image.delivery.validate");
  expect(stepNames).toContain("mobile.layout.check");
  expect(stepNames).toContain("lighthouse.budget.check");
  expect(stepNames).toContain("qa.independent.run");

  const slowSteps = result.data?.steps.filter((s) => s.status === "skip");
  expect(slowSteps).toHaveLength(3);
  expect(slowSteps?.map((s) => s.name).sort()).toEqual(
    ["lighthouse.budget.check", "mobile.layout.check", "qa.independent.run"].sort(),
  );

  expect(mockExecuteKernelPipeline).not.toHaveBeenCalled();
  expect(mockExecuteKernelCommand).toHaveBeenCalledTimes(2);
});

test("--mission resolves workpiece via readMissionManifest", async () => {
  const missionDir = path.join(tmpDir, "missions", "test-bundle-m000001");
  const workpieceDir = path.join(missionDir, "workpiece");
  await fs.mkdir(path.join(workpieceDir, "dist"), { recursive: true });

  mockReadMissionManifest.mockResolvedValue({
    missionId: "test-bundle-m000001",
    systemId: "test-bundle",
    brief: "test",
    status: "materialized",
  } as never);
  mockResolveMissionDir.mockReturnValue(missionDir);

  mockExecuteKernelPipeline.mockResolvedValue(
    makePipelineReport(true, [
      { commandName: "seo.technical.validate", ok: true, exitCode: 0, durationMs: 100 },
    ]),
  );

  const result = await runValidatePostbuild(
    { flags: { mission: "test-bundle-m000001" } } as never,
    makeContext(tmpDir),
  );

  expect(result.exitCode).toBe(0);
  expect(result.data?.status).toBe("pass");
  expect(mockReadMissionManifest).toHaveBeenCalledWith(tmpDir, "test-bundle-m000001");
  expect(mockResolveMissionDir).toHaveBeenCalledWith(tmpDir, "test-bundle-m000001");
  const pipelineCall = mockExecuteKernelPipeline.mock.calls[0]![0] as {
    siteWorkspace: { directory: string };
    siteName: string;
  };
  expect(pipelineCall.siteWorkspace.directory).toBe(workpieceDir);
  expect(pipelineCall.siteName).toBe("test-bundle");
});

test("stale dist/ warning is always printed", async () => {
  await fs.mkdir(path.join(tmpDir, "dist"), { recursive: true });

  mockResolveSiteWorkspace.mockResolvedValue({
    name: "test-bundle",
    directory: tmpDir,
    toolsDirectory: path.join(tmpDir, "tools"),
    configPath: path.join(tmpDir, "tools", "kernel.config.ts"),
  } as never);

  mockExecuteKernelPipeline.mockResolvedValue(
    makePipelineReport(true, [
      { commandName: "seo.technical.validate", ok: true, exitCode: 0, durationMs: 100 },
    ]),
  );

  const warnSpy = vi.fn();
  const ctx = {
    workspaceRoot: tmpDir,
    logger: {
      info: vi.fn(),
      warn: warnSpy,
      error: vi.fn(),
      section: vi.fn(),
      getEvents: vi.fn(() => []),
    },
  } as never;
  await runValidatePostbuild({ flags: { site: "test-bundle" } } as never, ctx);

  expect(warnSpy).toHaveBeenCalledWith(
    "dist/ may be stale — run mission.validate for a full check.",
  );
});

test("no --mission or --site → throws error", async () => {
  await expect(runValidatePostbuild({ flags: {} } as never, makeContext(tmpDir))).rejects.toThrow(
    "--mission or --site is required",
  );
});

test("step failure → exit code 1 with fail status", async () => {
  await fs.mkdir(path.join(tmpDir, "dist"), { recursive: true });

  mockResolveSiteWorkspace.mockResolvedValue({
    name: "test-bundle",
    directory: tmpDir,
    toolsDirectory: path.join(tmpDir, "tools"),
    configPath: path.join(tmpDir, "tools", "kernel.config.ts"),
  } as never);

  mockExecuteKernelPipeline.mockResolvedValue(
    makePipelineReport(false, [
      { commandName: "seo.technical.validate", ok: true, exitCode: 0, durationMs: 100 },
      { commandName: "image.delivery.validate", ok: false, exitCode: 1, durationMs: 200 },
    ]),
  );

  const result = await runValidatePostbuild(
    { flags: { site: "test-bundle" } } as never,
    makeContext(tmpDir),
  );

  expect(result.exitCode).toBe(1);
  expect(result.data?.status).toBe("fail");
  expect(result.data?.steps[1]!.status).toBe("fail");
});
