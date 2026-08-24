/*
<MODULE_CONTRACT>
  <purpose>RFC-0624: tests for cache-purge helpers — collectPurgeUrls, purgeCacheByUrls batching, non-blocking failure, missing zone ID.</purpose>
  <keywords>RFC-0624, cache-purge, batching, cloudflare, test</keywords>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0624: add tests for collectPurgeUrls, purgeCacheByUrls batching, non-blocking failure, missing zone ID skip.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi } from "vitest";
import {
  collectPurgeUrls,
  purgeCacheByUrls,
  skippedPurgeResult,
} from "../leitstand/cache-purge.ts";
import type { RouteFact } from "@warpgogol/werkstatt-engine/schemas";

test("collectPurgeUrls maps routes to full URLs and appends build-identity", () => {
  const routes: RouteFact[] = [
    { path: "/", contentHash: "abc" },
    { path: "/de", contentHash: "def" },
    { path: "/de/kontakt", contentHash: null, redirectTarget: "/de/kontakt/" },
  ];
  const urls = collectPurgeUrls("https://example.com", routes);
  expect(urls).toEqual([
    "https://example.com/",
    "https://example.com/de",
    "https://example.com/de/kontakt",
    "https://example.com/.well-known/build-identity.json",
  ]);
});

test("collectPurgeUrls handles trailing slash in deployment URL", () => {
  const urls = collectPurgeUrls("https://example.com/", []);
  expect(urls).toEqual(["https://example.com/.well-known/build-identity.json"]);
});

test("collectPurgeUrls with empty routes still includes build-identity", () => {
  const urls = collectPurgeUrls("https://example.com", []);
  expect(urls).toHaveLength(1);
  expect(urls[0]).toBe("https://example.com/.well-known/build-identity.json");
});

test("purgeCacheByUrls batches URLs in chunks of 30", async () => {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
  vi.stubGlobal("fetch", fetchMock);

  const urls: string[] = [];
  for (let i = 0; i < 35; i++) {
    urls.push(`https://example.com/page-${i}`);
  }

  const result = await purgeCacheByUrls("zone123", "token456", urls);

  expect(result.success).toBe(true);
  expect(result.purgedUrls).toBe(35);
  expect(fetchMock).toHaveBeenCalledTimes(2);

  const firstCallBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(firstCallBody.files).toHaveLength(30);

  const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
  expect(secondCallBody.files).toHaveLength(5);

  vi.unstubAllGlobals();
});

test("purgeCacheByUrls returns success for empty URL list", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const result = await purgeCacheByUrls("zone123", "token456", []);

  expect(result.success).toBe(true);
  expect(result.purgedUrls).toBe(0);
  expect(fetchMock).not.toHaveBeenCalled();

  vi.unstubAllGlobals();
});

test("purgeCacheByUrls returns failure on 500 response (non-blocking)", async () => {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValue({
    ok: false,
    status: 500,
    text: () => Promise.resolve("Internal Server Error"),
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await purgeCacheByUrls("zone123", "token456", ["https://example.com/"]);

  expect(result.success).toBe(false);
  expect(result.purgedUrls).toBe(0);
  expect(result.error).toContain("500");

  vi.unstubAllGlobals();
});

test("purgeCacheByUrls returns failure on 4xx auth error (non-blocking)", async () => {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValue({
    ok: false,
    status: 401,
    text: () => Promise.resolve("Unauthorized"),
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await purgeCacheByUrls("zone123", "bad-token", ["https://example.com/"]);

  expect(result.success).toBe(false);
  expect(result.error).toContain("401");

  vi.unstubAllGlobals();
});

test("purgeCacheByUrls returns failure on network error (non-blocking)", async () => {
  const fetchMock = vi.fn();
  fetchMock.mockRejectedValue(new Error("Network timeout"));
  vi.stubGlobal("fetch", fetchMock);

  const result = await purgeCacheByUrls("zone123", "token456", ["https://example.com/"]);

  expect(result.success).toBe(false);
  expect(result.purgedUrls).toBe(0);
  expect(result.error).toContain("Network timeout");

  vi.unstubAllGlobals();
});

test("skippedPurgeResult creates a skip result with reason", () => {
  const result = skippedPurgeResult("CLOUDFLARE_ZONE_ID not set");
  expect(result.success).toBe(false);
  expect(result.purgedUrls).toBe(0);
  expect(result.error).toBe("CLOUDFLARE_ZONE_ID not set");
});

test("purgeCacheByUrls sends correct authorization header", async () => {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
  vi.stubGlobal("fetch", fetchMock);

  await purgeCacheByUrls("zone123", "token456", ["https://example.com/"]);

  const callArgs = fetchMock.mock.calls[0];
  const url = callArgs[0] as string;
  const options = callArgs[1] as RequestInit;

  expect(url).toBe("https://api.cloudflare.com/client/v4/zones/zone123/purge_cache");
  expect(options.method).toBe("POST");
  expect((options.headers as Record<string, string>)["Authorization"]).toBe("Bearer token456");
  expect((options.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

  vi.unstubAllGlobals();
});
