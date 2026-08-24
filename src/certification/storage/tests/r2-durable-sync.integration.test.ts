import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createR2StorageAdapter } from "../r2-adapter.ts";
import { verifyStoredObject } from "../adapter.ts";
import { verifyDurableSync } from "../../../leitstand/deploy-helpers.ts";
import type { Sha256Digest } from "../../../fingerprint/primitives.ts";

const mockConfig = {
  accountId: "test-account-id",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
  bucketName: "warpgogol-certification",
  apiToken: "test-api-token",
};

const artifactDigest = ("sha256:" + "3".repeat(64)) as Sha256Digest;
const gateDecisionBytes = new TextEncoder().encode(
  JSON.stringify({
    schemaVersion: "werkstatt/gate-decision@1",
    decisionId: "dec-2026-08-16t07-48-11-848z-ooaavn",
    gate: "alt",
    outcome: "pass",
    artifactHash: artifactDigest,
  }),
);

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

describe("R2 durable sync integration", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("full cycle: putObject → verifyDurableSync → getObject returns same bytes", async () => {
    const adapter = createR2StorageAdapter(mockConfig);

    // Phase 1: putObject (certify uploads gate decision)
    fetchSpy.mockResolvedValueOnce(
      createMockResponse(200, { etag: '"put-etag-123"' }),
    );
    const putResult = await adapter.putObject({
      digest: artifactDigest,
      bytes: gateDecisionBytes,
      mediaType: "application/json",
    });
    expect(putResult.locator).toContain("r2://warpgogol-certification/");
    expect(putResult.sizeBytes).toBe(gateDecisionBytes.byteLength);

    // Phase 2: verifyDurableSync (propagate checks existence)
    fetchSpy.mockResolvedValueOnce(
      createMockResponse(206, {
        "content-range": `bytes 0-0/${gateDecisionBytes.byteLength}`,
        etag: '"put-etag-123"',
      }),
    );
    const verified = await verifyDurableSync(artifactDigest, mockConfig);
    expect(verified).toBe(true);

    // Phase 3: getObject (retrieve on demand)
    fetchSpy.mockResolvedValueOnce(
      createMockResponse(200, {}, gateDecisionBytes.buffer.slice(0)),
    );
    const retrieved = await adapter.getObject(artifactDigest);
    expect(retrieved).toBeInstanceOf(Uint8Array);
    expect(Buffer.compare(Buffer.from(retrieved), Buffer.from(gateDecisionBytes))).toBe(0);
  });

  it("verifyDurableSync returns false when artifact not in R2 (404)", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse(404));
    const verified = await verifyDurableSync(artifactDigest, mockConfig);
    expect(verified).toBe(false);
  });

  it("verifyDurableSync returns false on headObject error (500)", async () => {
    fetchSpy.mockResolvedValueOnce(createMockResponse(500, {}, "Internal Server Error"));
    await expect(verifyDurableSync(artifactDigest, mockConfig)).rejects.toThrow("CERT-R2-02");
  });

  it("verifyStoredObject reports size mismatch", async () => {
    const adapter = createR2StorageAdapter(mockConfig);

    fetchSpy.mockResolvedValueOnce(
      createMockResponse(206, {
        "content-range": "bytes 0-0/999",
        etag: '"wrong-size"',
      }),
    );

    const result = await verifyStoredObject(adapter, artifactDigest, gateDecisionBytes.byteLength);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ruleId).toBe("CERT-STORAGE-02");
      expect(result.message).toContain("999");
    }
  });

  it("Bearer token is used for all requests in the cycle", async () => {
    const adapter = createR2StorageAdapter(mockConfig);

    // put
    fetchSpy.mockResolvedValueOnce(createMockResponse(200, { etag: '"e1"' }));
    await adapter.putObject({
      digest: artifactDigest,
      bytes: gateDecisionBytes,
      mediaType: "application/json",
    });

    // head (via GET + Range)
    fetchSpy.mockResolvedValueOnce(
      createMockResponse(206, {
        "content-range": `bytes 0-0/${gateDecisionBytes.byteLength}`,
        etag: '"e1"',
      }),
    );
    await adapter.headObject(artifactDigest);

    // get
    fetchSpy.mockResolvedValueOnce(
      createMockResponse(200, {}, gateDecisionBytes.buffer.slice(0)),
    );
    await adapter.getObject(artifactDigest);

    // All 3 calls must use Bearer token
    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer test-api-token");
    }
  });

  it("headObject uses GET with Range header (not HEAD)", async () => {
    const adapter = createR2StorageAdapter(mockConfig);

    fetchSpy.mockResolvedValueOnce(
      createMockResponse(206, {
        "content-range": "bytes 0-0/42",
        etag: '"range-etag"',
      }),
    );

    const result = await adapter.headObject(artifactDigest);

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers["Range"]).toBe("bytes=0-0");

    expect(result.exists).toBe(true);
    expect(result.sizeBytes).toBe(42);
  });
});
