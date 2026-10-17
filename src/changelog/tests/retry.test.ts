/*
<MODULE_CONTRACT>
<purpose>
Unit tests for retry covering retryWithBackoff. It also guards the documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1311: Compass header sweep — declares the retry suite's contract for test-file scaffold coverage.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { retryWithBackoff } from "../changelog/utils/retry.ts";

// Helper: run retryWithBackoff and fake timers concurrently.
// The promise and its rejection handler must both be set up in the same
// synchronous tick to avoid PromiseRejectionHandledWarning.
async function runWithTimers<T>(
  promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const settled = promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  await vi.runAllTimersAsync();
  return settled;
}

describe("retryWithBackoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the result immediately on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, { retries: 2, baseDelay: 1000, jitter: false });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries after failure and returns on second success", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("ok");

    const promise = retryWithBackoff(fn, { retries: 2, baseDelay: 1000, factor: 2, jitter: false });
    const settled = await runWithTimers(promise);

    expect(settled.ok).toBe(true);
    if (settled.ok) expect(settled.value).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws the last error after all retries are exhausted", async () => {
    const boom = new Error("always fails");
    const fn = vi.fn().mockRejectedValue(boom);

    const promise = retryWithBackoff(fn, { retries: 2, baseDelay: 100, jitter: false });
    const settled = await runWithTimers(promise);

    expect(settled.ok).toBe(false);
    if (!settled.ok) expect(settled.error).toBe(boom);
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("calls fn exactly retries+1 times on total failure", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));

    const promise = retryWithBackoff(fn, { retries: 4, baseDelay: 10, jitter: false });
    await runWithTimers(promise);

    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("waits exponentially between attempts (no jitter)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const promise = retryWithBackoff(fn, { retries: 2, baseDelay: 1000, factor: 2, jitter: false });
    await runWithTimers(promise);

    // delays: 1000ms (attempt 0→1), 2000ms (attempt 1→2)
    const delays = setTimeoutSpy.mock.calls.map(([, delay]) => delay);
    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);

    setTimeoutSpy.mockRestore();
  });

  it("does not wait after the final failed attempt", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const promise = retryWithBackoff(fn, { retries: 2, baseDelay: 1000, jitter: false });
    await runWithTimers(promise);

    // 2 retries → 2 waits, not 3
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);

    setTimeoutSpy.mockRestore();
  });

  it("retries=0 means single attempt, no retry on failure", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("x"));

    const promise = retryWithBackoff(fn, { retries: 0, baseDelay: 1000, jitter: false });
    await runWithTimers(promise);

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
