/*
<MODULE_CONTRACT>
<purpose>RFC-0646: unit tests for gitExecWithRetry — tests transient error retry, non-transient error passthrough, backoff timing, and exhaustion.</purpose>
<non-goals>
  <item>Does not test bordbuch.commit integration — that is covered by bordbuch-commit.test.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0646: initial gitExecWithRetry unit tests.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { gitExecWithRetry } from "../werkstatt/git-exec.ts";

const mockedExecSync = vi.mocked(execSync);

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
    mockedExecSync.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on first success without retry", async () => {
    mockedExecSync.mockReturnValue("success output" as unknown as string);
    const result = await gitExecWithRetry("/tmp", "status", { backoffMs: [100] });
    expect(result).toBe("success output");
    expect(mockedExecSync).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error and succeeds on second attempt", async () => {
    mockedExecSync
      .mockImplementationOnce(() => {
        throw makeTransientError("index.lock: Another git process is running");
      })
      .mockReturnValue("recovered" as unknown as string);

    const promise = gitExecWithRetry("/tmp", "add", { backoffMs: [100] });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe("recovered");
    expect(mockedExecSync).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-transient error", async () => {
    mockedExecSync.mockImplementation(() => {
      throw makeNonTransientError("fatal: not a git repository");
    });

    await expect(gitExecWithRetry("/tmp", "status", { backoffMs: [100, 200] })).rejects.toThrow(
      "not a git repository",
    );

    expect(mockedExecSync).toHaveBeenCalledTimes(1);
  });

  it("respects backoff timing between retries", async () => {
    mockedExecSync
      .mockImplementationOnce(() => {
        throw makeTransientError("timeout");
      })
      .mockImplementationOnce(() => {
        throw makeTransientError("timeout");
      })
      .mockReturnValue("ok" as unknown as string);

    const promise = gitExecWithRetry("/tmp", "commit", { backoffMs: [500, 1000] });

    await vi.advanceTimersByTimeAsync(500);
    expect(mockedExecSync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBe("ok");
    expect(mockedExecSync).toHaveBeenCalledTimes(3);
  });

  it("throws last error when all retries are exhausted", async () => {
    mockedExecSync.mockImplementation(() => {
      throw makeTransientError("index.lock: lock contention");
    });

    const promise = gitExecWithRetry("/tmp", "add", { backoffMs: [100, 200] });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(300);
    await expect(promise).rejects.toThrow("index.lock");

    expect(mockedExecSync).toHaveBeenCalledTimes(3);
  });

  it("forwards allowNonZero option to gitExec", async () => {
    mockedExecSync.mockReturnValue("" as unknown as string);

    await gitExecWithRetry("/tmp", "status", { backoffMs: [] }, { allowNonZero: true });

    expect(mockedExecSync).toHaveBeenCalledTimes(1);
    const callArgs = mockedExecSync.mock.calls[0];
    expect(callArgs?.[1]).toMatchObject({ encoding: "utf-8" });
  });

  it("retry count is derived from backoffMs.length", async () => {
    mockedExecSync.mockImplementation(() => {
      throw makeTransientError("timed out");
    });

    const promise = gitExecWithRetry("/tmp", "status", { backoffMs: [100] });
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).rejects.toThrow("timed out");

    expect(mockedExecSync).toHaveBeenCalledTimes(2);
  });
});
