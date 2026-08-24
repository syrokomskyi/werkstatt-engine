import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createR2StorageAdapter } from "../r2-adapter.ts";
import type { Sha256Digest } from "../../../fingerprint/primitives.ts";

const mockConfig = {
  accountId: "test-account-id",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
  bucketName: "test-bucket",
  apiToken: "test-api-token",
};

const testDigest = ("sha256:" + "a".repeat(64)) as Sha256Digest;
const testBytes = new Uint8Array([1, 2, 3, 4, 5]);

function createMockResponse(
  status: number,
  headers: Record<string, string> = {},
  body: ArrayBuffer | string = new ArrayBuffer(0),
): Response {
  return new Response(body, {
    status,
    headers,
  });
}

describe("createR2StorageAdapter", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns adapter with correct id", () => {
    const adapter = createR2StorageAdapter(mockConfig);
    expect(adapter.id).toBe("r2:test-bucket");
  });

  it("putObject sends PUT request and returns locator + size", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse(200, { etag: '"abc123"' }));

    const adapter = createR2StorageAdapter(mockConfig);
    const result = await adapter.putObject({
      digest: testDigest,
      bytes: testBytes,
      mediaType: "application/json",
    });

    expect(result.sizeBytes).toBe(5);
    expect(result.locator).toContain("r2://test-bucket/");
    expect(result.locator).toContain("abc123");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0];
    const url = call[0] as string;
    expect(url).toContain("api.cloudflare.com/client/v4/accounts/test-account-id/r2");
    expect(url).toContain("buckets/test-bucket/objects/");
    expect(url).toContain(encodeURIComponent("sha256:" + "a".repeat(64)));

    const init = call[1] as RequestInit;
    expect(init.method).toBe("PUT");
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-api-token");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("putObject throws on non-ok response", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse(403, {}, "Forbidden"));

    const adapter = createR2StorageAdapter(mockConfig);
    await expect(
      adapter.putObject({
        digest: testDigest,
        bytes: testBytes,
        mediaType: "application/json",
      }),
    ).rejects.toThrow("CERT-R2-01");
  });

  it("headObject returns exists:false on 404", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse(404));

    const adapter = createR2StorageAdapter(mockConfig);
    const result = await adapter.headObject(testDigest);

    expect(result.exists).toBe(false);
  });

  it("headObject returns exists:true with size from content-range on 206", async () => {
    fetchSpy.mockResolvedValueOnce(
      createMockResponse(206, {
        "content-range": "bytes 0-0/42",
        etag: '"def456"',
      }),
    );

    const adapter = createR2StorageAdapter(mockConfig);
    const result = await adapter.headObject(testDigest);

    expect(result.exists).toBe(true);
    expect(result.sizeBytes).toBe(42);
    expect(result.digest).toBe(testDigest);
    expect(result.locator).toContain("def456");
  });

  it("headObject throws on non-404 error", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse(405, {}, "Method Not Allowed"));

    const adapter = createR2StorageAdapter(mockConfig);
    await expect(adapter.headObject(testDigest)).rejects.toThrow("CERT-R2-02");
  });

  it("getObject returns bytes on 200", async () => {
    const data = new Uint8Array([10, 20, 30]);
    fetchSpy.mockResolvedValueOnce(createMockResponse(200, {}, data.buffer.slice(0)));

    const adapter = createR2StorageAdapter(mockConfig);
    const result = await adapter.getObject(testDigest);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([10, 20, 30]);
  });

  it("getObject throws CERT-STORAGE-01 on 404", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse(404));

    const adapter = createR2StorageAdapter(mockConfig);
    await expect(adapter.getObject(testDigest)).rejects.toThrow("CERT-STORAGE-01");
  });

  it("getObject throws CERT-R2-03 on non-404 error", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse(500, {}, "Internal Server Error"));

    const adapter = createR2StorageAdapter(mockConfig);
    await expect(adapter.getObject(testDigest)).rejects.toThrow("CERT-R2-03");
  });

  it("appendAuditRecord sends PUT and returns locator", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse(200, { etag: '"audit-etag"' }));

    const adapter = createR2StorageAdapter(mockConfig);
    const result = await adapter.appendAuditRecord(new Uint8Array([99, 98]));

    expect(result.locator).toContain("r2://test-bucket/audit/");
    expect(result.locator).toContain("audit-etag");

    const call = fetchSpy.mock.calls[0];
    const url = call[0] as string;
    expect(url).toContain("buckets/test-bucket/objects/");
    expect(url).toContain("audit%2F");
  });

  it("appendAuditRecord throws on non-ok response", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse(500, {}, "Internal Server Error"));

    const adapter = createR2StorageAdapter(mockConfig);
    await expect(adapter.appendAuditRecord(new Uint8Array([1]))).rejects.toThrow("CERT-R2-04");
  });

  it("Authorization header uses Bearer token", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse(200, { etag: '"abc"' }));

    const adapter = createR2StorageAdapter(mockConfig);
    await adapter.putObject({
      digest: testDigest,
      bytes: testBytes,
      mediaType: "application/json",
    });

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-api-token");
  });
});
