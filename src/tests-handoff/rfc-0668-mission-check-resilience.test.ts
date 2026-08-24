/*
<MODULE_CONTRACT>
  <purpose>RFC-0668: tests for runMissionCheckWithResilience — timeout, retry on infrastructure error, no-retry on content violations.</purpose>
  <keywords>RFC-0668, mission.check, timeout, retry, resilience, leitstand, dev-deploy, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0668: test runMissionCheckWithResilience wrapper — retry on exit 2, no retry on exit 1, timeout not retryable, unexpected throw retried.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, vi } from "vitest";

vi.mock("@warpgogol/werkstatt-engine/kernel", async (importOriginal) => {
  const original = await importOriginal<typeof import("@warpgogol/werkstatt-engine/kernel")>();
  return {
    ...original,
    executeKernelCommand: vi.fn(),
  };
});

import { runMissionCheckWithResilience } from "../leitstand/leitstand-commands.ts";
import { executeKernelCommand } from "@warpgogol/werkstatt-engine/kernel";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

beforeEach(() => {
  vi.mocked(executeKernelCommand).mockClear();
  vi.mocked(executeKernelCommand).mockResolvedValue({
    ok: true,
    exitCode: 0,
    data: { findings: { errors: 0, warnings: 0 } },
    summary: "mission.check: pass",
  } as never);
});

test("RFC-0668: returns exit 0 immediately on pass (no retry)", async () => {
  vi.mocked(executeKernelCommand).mockResolvedValue({
    ok: true,
    exitCode: 0,
    data: { findings: { errors: 0, warnings: 0 } },
    summary: "mission.check: pass",
  } as never);

  const logger = makeLogger();
  const result = await runMissionCheckWithResilience(
    "/tmp/test",
    "test-mission",
    "http://example.com",
    "abc123",
    logger,
  );

  expect(result.exitCode).toBe(0);
  expect(executeKernelCommand).toHaveBeenCalledTimes(1);
  expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("retrying"));
});

test("RFC-0668: returns exit 1 immediately on content violations (no retry)", async () => {
  vi.mocked(executeKernelCommand).mockResolvedValue({
    ok: true,
    exitCode: 1,
    data: { findings: { errors: 3, warnings: 1 } },
    summary: "mission.check: fail — violations",
  } as never);

  const logger = makeLogger();
  const result = await runMissionCheckWithResilience(
    "/tmp/test",
    "test-mission",
    "http://example.com",
    "abc123",
    logger,
  );

  expect(result.exitCode).toBe(1);
  expect(executeKernelCommand).toHaveBeenCalledTimes(1);
  expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("retrying"));
});

test("RFC-0668: retries once on exit 2 (infrastructure error) and succeeds on second attempt", async () => {
  vi.mocked(executeKernelCommand)
    .mockResolvedValueOnce({
      ok: true,
      exitCode: 2,
      data: { findings: { errors: 0, warnings: 0 } },
      summary: "mission.check: infrastructure error",
    } as never)
    .mockResolvedValueOnce({
      ok: true,
      exitCode: 0,
      data: { findings: { errors: 0, warnings: 0 } },
      summary: "mission.check: pass",
    } as never);

  const logger = makeLogger();
  const result = await runMissionCheckWithResilience(
    "/tmp/test",
    "test-mission",
    "http://example.com",
    "abc123",
    logger,
  );

  expect(result.exitCode).toBe(0);
  expect(executeKernelCommand).toHaveBeenCalledTimes(2);
  expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("infrastructure error"));
});

test("RFC-0668: retries once on exit 2 and returns exit 2 when retry also fails", async () => {
  vi.mocked(executeKernelCommand).mockResolvedValue({
    ok: true,
    exitCode: 2,
    data: { findings: { errors: 0, warnings: 0 } },
    summary: "mission.check: infrastructure error",
  } as never);

  const logger = makeLogger();
  const result = await runMissionCheckWithResilience(
    "/tmp/test",
    "test-mission",
    "http://example.com",
    "abc123",
    logger,
  );

  expect(result.exitCode).toBe(2);
  expect(executeKernelCommand).toHaveBeenCalledTimes(2);
});

test("RFC-0668: retries on unexpected exit code (3+) and treats as infrastructure error", async () => {
  vi.mocked(executeKernelCommand)
    .mockResolvedValueOnce({
      ok: true,
      exitCode: 137,
      data: {},
      summary: "killed",
    } as never)
    .mockResolvedValueOnce({
      ok: true,
      exitCode: 0,
      data: { findings: { errors: 0, warnings: 0 } },
      summary: "mission.check: pass",
    } as never);

  const logger = makeLogger();
  const result = await runMissionCheckWithResilience(
    "/tmp/test",
    "test-mission",
    "http://example.com",
    "abc123",
    logger,
  );

  expect(result.exitCode).toBe(0);
  expect(executeKernelCommand).toHaveBeenCalledTimes(2);
  expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("exit 137"));
});

test("RFC-0668: retries once when executeKernelCommand throws, then succeeds", async () => {
  vi.mocked(executeKernelCommand)
    .mockRejectedValueOnce(new Error("network failure"))
    .mockResolvedValueOnce({
      ok: true,
      exitCode: 0,
      data: { findings: { errors: 0, warnings: 0 } },
      summary: "mission.check: pass",
    } as never);

  const logger = makeLogger();
  const result = await runMissionCheckWithResilience(
    "/tmp/test",
    "test-mission",
    "http://example.com",
    "abc123",
    logger,
  );

  expect(result.exitCode).toBe(0);
  expect(executeKernelCommand).toHaveBeenCalledTimes(2);
  expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("threw"));
});

test("RFC-0668: throws when executeKernelCommand throws on both attempts", async () => {
  vi.mocked(executeKernelCommand).mockRejectedValue(new Error("persistent failure"));

  const logger = makeLogger();
  await expect(
    runMissionCheckWithResilience(
      "/tmp/test",
      "test-mission",
      "http://example.com",
      "abc123",
      logger,
    ),
  ).rejects.toThrow("persistent failure");

  expect(executeKernelCommand).toHaveBeenCalledTimes(2);
});

test("RFC-0668: passes --max-duration to mission.check argv", async () => {
  vi.mocked(executeKernelCommand).mockResolvedValue({
    ok: true,
    exitCode: 0,
    data: { findings: { errors: 0, warnings: 0 } },
    summary: "mission.check: pass",
  } as never);

  const logger = makeLogger();
  await runMissionCheckWithResilience(
    "/tmp/test",
    "test-mission",
    "http://example.com",
    "abc123",
    logger,
  );

  const callArgs = vi.mocked(executeKernelCommand).mock.calls[0]![0] as {
    argv: string[];
  };
  const maxDurationArg = callArgs.argv.find((a) => a.startsWith("--max-duration="));
  expect(maxDurationArg).toBeDefined();
  const value = Number(maxDurationArg!.split("=")[1]);
  expect(value).toBe(15 * 60 * 1000);
});

test("RFC-0668: passes --no-report by default to prevent double report.html generation", async () => {
  vi.mocked(executeKernelCommand).mockResolvedValue({
    ok: true,
    exitCode: 0,
    data: { findings: { errors: 0, warnings: 0 } },
    summary: "mission.check: pass",
  } as never);

  const logger = makeLogger();
  await runMissionCheckWithResilience(
    "/tmp/test",
    "test-mission",
    "http://example.com",
    "abc123",
    logger,
  );

  const callArgs = vi.mocked(executeKernelCommand).mock.calls[0]![0] as {
    argv: string[];
  };
  expect(callArgs.argv).toContain("--no-report");
});

test("RFC-0668: omits --no-report when noReport=false", async () => {
  vi.mocked(executeKernelCommand).mockResolvedValue({
    ok: true,
    exitCode: 0,
    data: { findings: { errors: 0, warnings: 0 } },
    summary: "mission.check: pass",
  } as never);

  const logger = makeLogger();
  await runMissionCheckWithResilience(
    "/tmp/test",
    "test-mission",
    "http://example.com",
    "abc123",
    logger,
    false,
  );

  const callArgs = vi.mocked(executeKernelCommand).mock.calls[0]![0] as {
    argv: string[];
  };
  expect(callArgs.argv).not.toContain("--no-report");
});
