/*
<MODULE_CONTRACT>
<purpose>RFC-0752: tests for the Cloudflare REST API client (cloudflare-api.ts).</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0752: initial API client tests — listDnsRecords, createDnsRecord, listWorkersRoutes, createWorkersRoute, auth header.</item>
  <item>ADR-0035: refactored to use shared cloudflare-api-mock helper (setupCloudflareApiMock, cfSuccessResponse, cfErrorResponse).</item>
</CHANGE_SUMMARY>
*/

import { test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  listDnsRecords,
  createDnsRecord,
  listWorkersRoutes,
  createWorkersRoute,
} from "../leitstand/adapters/cloudflare-api.ts";
import {
  setupCloudflareApiMock,
  cfSuccessResponse,
  cfErrorResponse,
} from "./helpers/cloudflare-api-mock.ts";

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("listDnsRecords sends GET with auth header and optional name filter", async () => {
  setupCloudflareApiMock(mockFetch, {
    dnsList: () =>
      cfSuccessResponse([
        {
          id: "rec1",
          type: "CNAME",
          name: "test.example.com",
          content: "target.workers.dev",
          proxied: true,
        },
      ]),
  });

  const result = await listDnsRecords("zone123", "token456", "test.example.com");

  expect(mockFetch).toHaveBeenCalledOnce();
  const [url, opts] = mockFetch.mock.calls[0];
  expect(url).toContain("/zones/zone123/dns_records");
  expect(url).toContain("name=test.example.com");
  expect(opts.method).toBeUndefined();
  expect(opts.headers.Authorization).toBe("Bearer token456");
  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("test.example.com");
});

test("listDnsRecords without name filter omits query param", async () => {
  setupCloudflareApiMock(mockFetch, {
    dnsList: () => cfSuccessResponse([]),
  });

  await listDnsRecords("zone123", "token456");

  const [url] = mockFetch.mock.calls[0];
  expect(url).not.toContain("name=");
});

test("createDnsRecord sends POST with correct payload", async () => {
  setupCloudflareApiMock(mockFetch, {
    createDns: () =>
      cfSuccessResponse({
        id: "new-rec",
        type: "CNAME",
        name: "test.example.com",
        content: "target.workers.dev",
        proxied: true,
      }),
  });

  const result = await createDnsRecord("zone123", "token456", {
    type: "CNAME",
    name: "test.example.com",
    content: "target.workers.dev",
    proxied: true,
  });

  const [url, opts] = mockFetch.mock.calls[0];
  expect(url).toContain("/zones/zone123/dns_records");
  expect(opts.method).toBe("POST");
  expect(opts.headers.Authorization).toBe("Bearer token456");
  const body = JSON.parse(opts.body);
  expect(body.type).toBe("CNAME");
  expect(body.name).toBe("test.example.com");
  expect(result.id).toBe("new-rec");
});

test("listWorkersRoutes sends GET with auth header", async () => {
  setupCloudflareApiMock(mockFetch, {
    routeList: () =>
      cfSuccessResponse([{ id: "route1", pattern: "test.example.com/*", script: "test-worker" }]),
  });

  const result = await listWorkersRoutes("zone123", "token456");

  const [url, opts] = mockFetch.mock.calls[0];
  expect(url).toContain("/zones/zone123/workers/routes");
  expect(opts.headers.Authorization).toBe("Bearer token456");
  expect(result).toHaveLength(1);
  expect(result[0].pattern).toBe("test.example.com/*");
});

test("createWorkersRoute sends POST with correct payload", async () => {
  setupCloudflareApiMock(mockFetch, {
    createRoute: () =>
      cfSuccessResponse({ id: "new-route", pattern: "test.example.com/*", script: "test-worker" }),
  });

  const result = await createWorkersRoute("zone123", "token456", {
    pattern: "test.example.com/*",
    script: "test-worker",
  });

  const [url, opts] = mockFetch.mock.calls[0];
  expect(url).toContain("/zones/zone123/workers/routes");
  expect(opts.method).toBe("POST");
  const body = JSON.parse(opts.body);
  expect(body.pattern).toBe("test.example.com/*");
  expect(body.script).toBe("test-worker");
  expect(result.id).toBe("new-route");
});

test("API errors throw with descriptive message", async () => {
  setupCloudflareApiMock(mockFetch, {
    dnsList: () => cfErrorResponse(200, [{ code: 1003, message: "Invalid or missing zone id" }]),
  });

  await expect(listDnsRecords("bad-zone", "token456")).rejects.toThrow(
    "listDnsRecords API errors: 1003: Invalid or missing zone id",
  );
});

test("HTTP error throws with status and body", async () => {
  mockFetch.mockResolvedValue(cfErrorResponse(401, [{ code: 1003, message: "Unauthorized" }]));

  await expect(listDnsRecords("zone123", "bad-token")).rejects.toThrow(
    "listDnsRecords failed: HTTP 401",
  );
});
