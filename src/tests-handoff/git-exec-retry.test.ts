/*
<MODULE_CONTRACT>
<purpose>RFC-0646: unit tests for gitExecWithRetry — tests transient error retry, non-transient error passthrough, backoff timing, and exhaustion.</purpose>
<non-goals>
  <item>Does not test bordbuch.commit integration — that is covered by bordbuch-commit.test.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0646: initial gitExecWithRetry unit tests.</item>
  <item>RFC-1149: migrate ambient filesystem and process IO to the WorkspaceIO port across engine and shared</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceIO } from "@warpgogol/werkstatt-shared/kernel/workspace-io";

import { gitExecWithRetry } from "../werkstatt/git-exec.ts";

const mockExec = vi.fn();
const mockIo = { exec: mockExec } as unknown as WorkspaceIO;

function mockExecOk(stdout: string): void {
  mockExec.mockResolvedValue({ exitCode: 0, stdout, stderr: "" });
}

function makeTransientError(message: string): Error {
  const err = new Error(message);
  (err as unknown as Record<string, unknown>).code = "ETIMEDOUT";
  return err;
}

function makeNonTransientError(message: string): Error {
  const err = new Error(message);
  (err as unknown as Record<string, unknown>).code = "ENOENT";
  return err;
}

describe("gitExecWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockExec.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on first success without retry", async () => {
    mockExecOk("success output");
    const result = await gitExecWithRetry(
      "/tmp",
      "status",
      { backoffMs: [100] },
      undefined,
      mockIo,
    );
    expect(result).toBe("success output");
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error and succeeds on second attempt", async () => {
    mockExec
      .mockRejectedValueOnce(makeTransientError("index.lock: Another git process is running"))
      .mockResolvedValue({ exitCode: 0, stdout: "recovered", stderr: "" });

    const promise = gitExecWithRetry("/tmp", "add", { backoffMs: [100] }, undefined, mockIo);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("recovered");
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-transient error", async () => {
    mockExec.mockRejectedValue(makeNonTransientError("fatal: not a git repository"));

    await expect(
      gitExecWithRetry("/tmp", "status", { backoffMs: [100, 200] }, undefined, mockIo),
    ).rejects.toThrow("not a git repository");

    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("respects backoff timing between retries", async () => {
    mockExec
      .mockRejectedValueOnce(makeTransientError("timeout"))
      .mockRejectedValueOnce(makeTransientError("timeout"))
      .mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" });

    const promise = gitExecWithRetry(
      "/tmp",
      "commit",
      { backoffMs: [500, 1000] },
      undefined,
      mockIo,
    );

    await vi.advanceTimersByTimeAsync(500);
    expect(mockExec).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBe("ok");
    expect(mockExec).toHaveBeenCalledTimes(3);
  });

  it("throws last error when all retries are exhausted", async () => {
    mockExec.mockRejectedValue(makeTransientError("index.lock: lock contention"));

    const promise = gitExecWithRetry("/tmp", "add", { backoffMs: [100, 200] }, undefined, mockIo);
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(300);
    await expect(promise).rejects.toThrow("index.lock");

    expect(mockExec).toHaveBeenCalledTimes(3);
  });

  it("forwards allowNonZero option to gitExec", async () => {
    mockExec.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "dirty" });

    await gitExecWithRetry("/tmp", "status", { backoffMs: [] }, { allowNonZero: true }, mockIo);

    expect(mockExec).toHaveBeenCalledTimes(1);
    const callArgs = mockExec.mock.calls[0];
    expect(callArgs?.[0]).toBe("sh");
    expect(callArgs?.[1]).toEqual(["-c", "git status"]);
  });

  it("retry count is derived from backoffMs.length", async () => {
    mockExec.mockRejectedValue(makeTransientError("timed out"));

    const promise = gitExecWithRetry("/tmp", "status", { backoffMs: [100] }, undefined, mockIo);
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).rejects.toThrow("timed out");

    expect(mockExec).toHaveBeenCalledTimes(2);
  });
});
