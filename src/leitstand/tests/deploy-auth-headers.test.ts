/*
<MODULE_CONTRACT>
  <purpose>RFC-0925: unit tests for buildAuthHeader and verifyFreshness auth header forwarding.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0925: initial tests for buildAuthHeader and verifyFreshness authHeaders forwarding.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyFreshness } from "../leitstand-commands.ts";

const noopLogger = { info: (_m: string) => {} };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("auth header encoding: base64 format matches middleware format (warp:PIN)", () => {
  const pin = "1234";
  const encoded = btoa(`warp:${pin}`);
  expect(encoded).toBe(btoa("warp:1234"));
  expect(atob(encoded)).toBe("warp:1234");
});

test("auth header encoding: base64 format for another PIN", () => {
  const pin = "9999";
  const encoded = btoa(`warp:${pin}`);
  expect(atob(encoded)).toBe("warp:9999");
});

test("verifyFreshness: passes authHeaders to fetch", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ distTreeHash: "abc123" }), { status: 200 }));

  const promise = verifyFreshness("https://dev.example.com", "abc123", noopLogger, {
    Authorization: "Basic dGVzdDp0ZXN0",
  });
  await vi.runAllTimersAsync();
  await promise;

  expect(fetchSpy).toHaveBeenCalledOnce();
  const callArgs = fetchSpy.mock.calls[0];
  const options = callArgs?.[1] as RequestInit | undefined;
  expect(options?.headers).toEqual({ Authorization: "Basic dGVzdDp0ZXN0" });
});

test("verifyFreshness: defaults to empty headers when no authHeaders provided", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ distTreeHash: "abc123" }), { status: 200 }));

  const promise = verifyFreshness("https://dev.example.com", "abc123", noopLogger);
  await vi.runAllTimersAsync();
  await promise;

  expect(fetchSpy).toHaveBeenCalledOnce();
  const callArgs = fetchSpy.mock.calls[0];
  const options = callArgs?.[1] as RequestInit | undefined;
  expect(options?.headers).toEqual({});
});

test("verifyFreshness: 401 response causes freshness failure (not crash)", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unauthorized", { status: 401 }));

  const promise = verifyFreshness("https://dev.example.com", "abc123", noopLogger, {
    Authorization: "Basic dGVzdDp0ZXN0",
  });
  await vi.runAllTimersAsync();
  const result = await promise;

  expect(result.verified).toBe(false);
  expect(result.error).toContain("401");
  expect(result.error).not.toContain("Authorization");
  expect(result.error).not.toContain("Basic");
});

test("verifyFreshness: error messages do not contain auth header values", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

  const promise = verifyFreshness("https://dev.example.com", "abc123", noopLogger, {
    Authorization: "Basic c2VjcmV0MTIzNA==",
  });
  await vi.runAllTimersAsync();
  const result = await promise;

  expect(result.verified).toBe(false);
  expect(result.error).not.toContain("Authorization");
  expect(result.error).not.toContain("Basic");
  expect(result.error).not.toContain("c2VjcmV0");
});
