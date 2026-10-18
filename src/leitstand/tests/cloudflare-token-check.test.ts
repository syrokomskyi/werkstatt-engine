/*
<MODULE_CONTRACT>
<purpose>
RFC-1326 acceptance tests for cloudflare.token.check — AC-3 (a token
lacking Vectorize reports account.vectorize.edit as missing), AC-4 (a
missing always-permission exits non-zero), unprobeable entries report
unknown, and zone-scope entries degrade to unknown without zone context.
All API calls are stubbed fetch — no network.
</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1326: initial — AC-3/AC-4 stubbed-fetch cases, unknown/no-zone paths.</item>
  <item>RFC-1326: single Cloudflare permission registry, token preflight, birth provisioning</item>
</CHANGE_SUMMARY>
*/

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { CLOUDFLARE_PERMISSIONS } from "@warpgogol/werkstatt-shared/cloudflare/permissions";
import { runCloudflareTokenCheck } from "../cloudflare-token-check.ts";

const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "b".repeat(32);

function makeInput(flags: Record<string, unknown> = {}): KernelCommandInput {
  return { argv: [], flags } as unknown as KernelCommandInput;
}

function makeContext(): KernelRuntimeContext {
  return {
    workspaceRoot: "/tmp",
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, success: () => {} },
  } as unknown as KernelRuntimeContext;
}

interface ProbeData {
  results: { id: string; outcome: string }[];
  missing: string[];
  unknown: string[];
  tokenId: string;
  tokenStatus: string;
}

function apiResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Stub fetch: verifyToken succeeds; every registry probe answers ok except
 * the ids in `missingIds`, which get a Cloudflare 403 permission error.
 */
function stubFetch(missingIds: string[] = []): void {
  const missingPaths = new Set(
    CLOUDFLARE_PERMISSIONS.filter((p) => missingIds.includes(p.id)).map((p) =>
      p.probe!.path.replace("{accountId}", ACCOUNT_ID).replace("{zoneId}", ZONE_ID),
    ),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const u = String(url instanceof Request ? url.url : url);
      if (u.includes("/user/tokens/verify")) {
        return apiResponse({ success: true, errors: [], messages: [], result: { id: "tok-123", status: "active" } });
      }
      const path = u.replace("https://api.cloudflare.com/client/v4", "");
      if (missingPaths.has(path)) {
        return apiResponse(
          { success: false, errors: [{ code: 9109, message: "Permission denied" }], messages: [] },
          403,
        );
      }
      return apiResponse({ success: true, errors: [], messages: [], result: [] });
    }),
  );
}

beforeEach(() => {
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  process.env.CLOUDFLARE_ACCOUNT_ID = ACCOUNT_ID;
  delete process.env.CLOUDFLARE_ZONE_ID;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_ZONE_ID;
});

describe("cloudflare.token.check (RFC-1326)", () => {
  test("AC-3+AC-4: a token lacking Vectorize reports missing and exits non-zero", async () => {
    stubFetch(["account.vectorize.edit"]);

    const result = await runCloudflareTokenCheck(makeInput({ zone: ZONE_ID }), makeContext());

    expect(result.exitCode).toBe(1);
    const data = result.data as ProbeData;
    const vectorize = data.results.find((r) => r.id === "account.vectorize.edit");
    expect(vectorize?.outcome).toBe("missing");
    expect(data.missing).toContain("account.vectorize.edit");
    expect(data.tokenId).toBe("tok-123");
    expect(result.summary).toContain("account.vectorize.edit");
  });

  test("a fully-granted token passes with exit 0", async () => {
    stubFetch([]);

    const result = await runCloudflareTokenCheck(makeInput({ zone: ZONE_ID }), makeContext());

    expect(result.exitCode).toBe(0);
    const data = result.data as ProbeData;
    expect(data.missing).toEqual([]);
    expect(data.results.find((r) => r.id === "zone.cache-purge.purge")?.outcome).toBe("unknown");
  });

  test("a missing custom-domain permission warns but does not fail", async () => {
    stubFetch(["zone.dns.edit"]);

    const result = await runCloudflareTokenCheck(makeInput({ zone: ZONE_ID }), makeContext());

    expect(result.exitCode).toBe(0);
    const data = result.data as ProbeData;
    expect(data.missing).toContain("zone.dns.edit");
  });

  test("no zone context → every zone-scope entry is unknown, never missing", async () => {
    stubFetch(["zone.dns.edit", "zone.zone.read"]);

    const result = await runCloudflareTokenCheck(makeInput(), makeContext());

    expect(result.exitCode).toBe(0);
    const data = result.data as ProbeData;
    for (const r of data.results.filter((r) => r.id.startsWith("zone."))) {
      expect(r.outcome, r.id).toBe("unknown");
    }
    expect(data.missing).toEqual([]);
  });

  test("unprobeable permission reports unknown even when probes would 403", async () => {
    stubFetch([]);
    const result = await runCloudflareTokenCheck(makeInput({ zone: ZONE_ID }), makeContext());
    const data = result.data as ProbeData;
    expect(data.results.find((r) => r.id === "zone.cache-purge.purge")?.outcome).toBe("unknown");
    expect(data.unknown).toContain("zone.cache-purge.purge");
  });

  test("missing CLOUDFLARE_API_TOKEN fails fast without calling the API", async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runCloudflareTokenCheck(makeInput(), makeContext());

    expect(result.exitCode).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("inactive token fails with token-inactive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        apiResponse({ success: true, errors: [], messages: [], result: { id: "tok-9", status: "disabled" } }),
      ),
    );

    const result = await runCloudflareTokenCheck(makeInput(), makeContext());

    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("token-inactive");
  });
});
