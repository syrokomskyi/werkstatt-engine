/*
<MODULE_CONTRACT>
<purpose>ADR-0035: tests for the shared cloudflare-api-mock helper — URL+method routing, default responses, handler dispatch.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0035: initial tests for cloudflare-api-mock helper.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi } from "vitest";
import {
  setupCloudflareApiMock,
  cfSuccessResponse,
  cfErrorResponse,
  dnsListResponse,
  routeListResponse,
} from "./helpers/cloudflare-api-mock.ts";

test("routes DNS list by URL + GET method", async () => {
  const mockFetch = vi.fn();
  const handler = vi.fn(() => dnsListResponse([{ id: "rec1" }]));
  setupCloudflareApiMock(mockFetch, { dnsList: handler });

  const response = await mockFetch(
    "https://api.cloudflare.com/client/v4/zones/zone123/dns_records?name=test.example.com",
    { method: "GET" },
  );

  expect(handler).toHaveBeenCalledOnce();
  const body = await response.json();
  expect(body.result).toEqual([{ id: "rec1" }]);
});

test("routes DNS create by URL + POST method", async () => {
  const mockFetch = vi.fn();
  const handler = vi.fn(() => cfSuccessResponse({ id: "new-rec" }));
  setupCloudflareApiMock(mockFetch, { createDns: handler });

  await mockFetch("https://api.cloudflare.com/client/v4/zones/zone123/dns_records", {
    method: "POST",
    body: JSON.stringify({ type: "CNAME" }),
  });

  expect(handler).toHaveBeenCalledOnce();
});

test("routes Workers routes list by URL + GET method", async () => {
  const mockFetch = vi.fn();
  const handler = vi.fn(() => routeListResponse([{ id: "route1" }]));
  setupCloudflareApiMock(mockFetch, { routeList: handler });

  const response = await mockFetch(
    "https://api.cloudflare.com/client/v4/zones/zone123/workers/routes",
    { method: "GET" },
  );

  expect(handler).toHaveBeenCalledOnce();
  const body = await response.json();
  expect(body.result).toEqual([{ id: "route1" }]);
});

test("routes Workers routes create by URL + POST method", async () => {
  const mockFetch = vi.fn();
  const handler = vi.fn(() => cfSuccessResponse({ id: "new-route" }));
  setupCloudflareApiMock(mockFetch, { createRoute: handler });

  await mockFetch("https://api.cloudflare.com/client/v4/zones/zone123/workers/routes", {
    method: "POST",
  });

  expect(handler).toHaveBeenCalledOnce();
});

test("returns default empty list for unhandled DNS list call", async () => {
  const mockFetch = vi.fn();
  setupCloudflareApiMock(mockFetch, {});

  const response = await mockFetch(
    "https://api.cloudflare.com/client/v4/zones/zone123/dns_records",
    { method: "GET" },
  );

  const body = await response.json();
  expect(body.result).toEqual([]);
});

test("returns default empty object for unhandled DNS create call", async () => {
  const mockFetch = vi.fn();
  setupCloudflareApiMock(mockFetch, {});

  const response = await mockFetch(
    "https://api.cloudflare.com/client/v4/zones/zone123/dns_records",
    { method: "POST" },
  );

  const body = await response.json();
  expect(body.result).toEqual({});
});

test("routes purge_cache by URL + POST method", async () => {
  const mockFetch = vi.fn();
  const handler = vi.fn(() => cfSuccessResponse({ id: "purge-ok" }));
  setupCloudflareApiMock(mockFetch, { purgeCache: handler });

  await mockFetch("https://api.cloudflare.com/client/v4/zones/zone123/purge_cache", {
    method: "POST",
  });

  expect(handler).toHaveBeenCalledOnce();
});

test("cfSuccessResponse wraps result in Cloudflare envelope", async () => {
  const response = cfSuccessResponse({ id: "test" });
  expect(response.ok).toBe(true);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(true);
  expect(body.errors).toEqual([]);
  expect(body.result).toEqual({ id: "test" });
});

test("cfErrorResponse sets ok=false for 4xx status", async () => {
  const response = cfErrorResponse(401, [{ code: 1003, message: "Unauthorized" }]);
  expect(response.ok).toBe(false);
  expect(response.status).toBe(401);
  const body = await response.json();
  expect(body.success).toBe(false);
  expect(body.errors).toHaveLength(1);
});

test("cfErrorResponse sets ok=true for 2xx status with API errors", async () => {
  const response = cfErrorResponse(200, [{ code: 1003, message: "Invalid zone" }]);
  expect(response.ok).toBe(true);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.success).toBe(false);
});

test("mock is order-independent — any call order returns correct response", async () => {
  const mockFetch = vi.fn();
  setupCloudflareApiMock(mockFetch, {
    dnsList: () => dnsListResponse([{ id: "dns-1" }]),
    routeList: () => routeListResponse([{ id: "route-1" }]),
  });

  const routeResponse = await mockFetch(
    "https://api.cloudflare.com/client/v4/zones/zone123/workers/routes",
    { method: "GET" },
  );
  const dnsResponse = await mockFetch(
    "https://api.cloudflare.com/client/v4/zones/zone123/dns_records",
    { method: "GET" },
  );

  const routeBody = await routeResponse.json();
  const dnsBody = await dnsResponse.json();
  expect(routeBody.result).toEqual([{ id: "route-1" }]);
  expect(dnsBody.result).toEqual([{ id: "dns-1" }]);
});
