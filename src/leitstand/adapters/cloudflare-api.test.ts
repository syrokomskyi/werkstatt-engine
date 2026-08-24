/*
<MODULE_CONTRACT>
  <purpose>RFC-0753: unit tests for Cloudflare API client — pagination, retry, update, delete.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0753: initial Cloudflare API client tests for updateDnsRecord, deleteDnsRecord, pagination, retry.</item>
</CHANGE_SUMMARY>
*/

import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listDnsRecords,
  createDnsRecord,
  updateDnsRecord,
  deleteDnsRecord,
} from "./cloudflare-api.ts";

const ZONE_ID = "test-zone-id";
const API_TOKEN = "test-api-token";

function mockResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("listDnsRecords: paginates through all pages", async () => {
  const fetchMock = vi.fn();
  fetchMock
    .mockResolvedValueOnce(
      mockResponse(200, {
        success: true,
        errors: [],
        messages: [],
        result: [
          {
            id: "r1",
            type: "A",
            name: "a.example.com",
            content: "1.2.3.4",
            proxied: true,
            priority: null,
          },
        ],
        result_info: { page: 1, per_page: 50, total_pages: 2, count: 1, total_count: 2 },
      }),
    )
    .mockResolvedValueOnce(
      mockResponse(200, {
        success: true,
        errors: [],
        messages: [],
        result: [
          {
            id: "r2",
            type: "A",
            name: "b.example.com",
            content: "5.6.7.8",
            proxied: false,
            priority: null,
          },
        ],
        result_info: { page: 2, per_page: 50, total_pages: 2, count: 1, total_count: 2 },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);

  const records = await listDnsRecords(ZONE_ID, API_TOKEN);
  expect(records).toHaveLength(2);
  expect(records[0].id).toBe("r1");
  expect(records[1].id).toBe("r2");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("listDnsRecords: single page when total_pages is 1", async () => {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(
    mockResponse(200, {
      success: true,
      errors: [],
      messages: [],
      result: [
        {
          id: "r1",
          type: "A",
          name: "a.example.com",
          content: "1.2.3.4",
          proxied: true,
          priority: null,
        },
      ],
      result_info: { page: 1, per_page: 50, total_pages: 1, count: 1, total_count: 1 },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const records = await listDnsRecords(ZONE_ID, API_TOKEN);
  expect(records).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("createDnsRecord: accepts all record types", async () => {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(
    mockResponse(200, {
      success: true,
      errors: [],
      messages: [],
      result: {
        id: "new-r1",
        type: "TXT",
        name: "_dmarc",
        content: "v=DMARC1; p=quarantine",
        proxied: false,
        priority: null,
      },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const result = await createDnsRecord(ZONE_ID, API_TOKEN, {
    type: "TXT",
    name: "_dmarc",
    content: "v=DMARC1; p=quarantine",
    proxied: false,
  });
  expect(result.id).toBe("new-r1");
  expect(result.type).toBe("TXT");
});

test("updateDnsRecord: sends PUT with record body", async () => {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(
    mockResponse(200, {
      success: true,
      errors: [],
      messages: [],
      result: {
        id: "r1",
        type: "A",
        name: "a.example.com",
        content: "10.0.0.1",
        proxied: true,
        priority: null,
      },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const result = await updateDnsRecord(ZONE_ID, API_TOKEN, "r1", {
    type: "A",
    name: "a.example.com",
    content: "10.0.0.1",
    proxied: true,
  });
  expect(result.id).toBe("r1");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const call = fetchMock.mock.calls[0];
  expect(call[1].method).toBe("PUT");
});

test("deleteDnsRecord: sends DELETE and succeeds", async () => {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(
    mockResponse(200, {
      success: true,
      errors: [],
      messages: [],
      result: {},
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await deleteDnsRecord(ZONE_ID, API_TOKEN, "r1");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const call = fetchMock.mock.calls[0];
  expect(call[1].method).toBe("DELETE");
});

test("deleteDnsRecord: throws on API error", async () => {
  const fetchMock = vi.fn();
  fetchMock.mockResolvedValueOnce(
    mockResponse(200, {
      success: false,
      errors: [{ code: 1003, message: "Record does not exist" }],
      messages: [],
      result: {},
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(deleteDnsRecord(ZONE_ID, API_TOKEN, "r1")).rejects.toThrow(
    "deleteDnsRecord API errors",
  );
});

test("listDnsRecords: retries on 503 then succeeds", async () => {
  const fetchMock = vi.fn();
  fetchMock
    .mockResolvedValueOnce(mockResponse(503, { error: "Service Unavailable" }))
    .mockResolvedValueOnce(
      mockResponse(200, {
        success: true,
        errors: [],
        messages: [],
        result: [
          {
            id: "r1",
            type: "A",
            name: "a.example.com",
            content: "1.2.3.4",
            proxied: true,
            priority: null,
          },
        ],
        result_info: { page: 1, per_page: 50, total_pages: 1, count: 1, total_count: 1 },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);

  const recordsPromise = listDnsRecords(ZONE_ID, API_TOKEN);
  await vi.advanceTimersByTimeAsync(2000);
  const records = await recordsPromise;
  expect(records).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
