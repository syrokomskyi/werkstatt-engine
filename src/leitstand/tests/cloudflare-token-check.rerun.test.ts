/*
<MODULE_CONTRACT>
<purpose>
RFC-1327 IDEMP-02 backing test for cloudflare.token.check's `idempotency:
"rerun-safe"` declaration (RFC-1326) — the command is read-only: a second
run against the same stubbed API returns byte-identical outcomes.
</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1326: initial — two-run determinism over stubbed fetch.</item>
  <item>RFC-1326: single Cloudflare permission registry, token preflight, birth provisioning</item>
</CHANGE_SUMMARY>
*/

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { KernelCommandInput, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
import { CLOUDFLARE_PERMISSIONS } from "@warpgogol/werkstatt-shared/cloudflare/permissions";
import { runCloudflareTokenCheck } from "../cloudflare-token-check.ts";

const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "b".repeat(32);

function makeContext(): KernelRuntimeContext {
  return {
    workspaceRoot: "/tmp",
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, success: () => {} },
  } as unknown as KernelRuntimeContext;
}

function apiResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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
        return apiResponse({
          success: true,
          errors: [],
          messages: [],
          result: { id: "tok-123", status: "active" },
        });
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

describe("cloudflare.token.check rerun safety (RFC-1327)", () => {
  test("a second run returns identical outcomes — read-only, no state", async () => {
    stubFetch(["account.vectorize.edit"]);
    const input = { argv: [], flags: { zone: ZONE_ID } } as unknown as KernelCommandInput;

    const first = await runCloudflareTokenCheck(input, makeContext());
    const second = await runCloudflareTokenCheck(input, makeContext());

    expect(second.exitCode).toBe(first.exitCode);
    expect(second.summary).toBe(first.summary);
    expect(JSON.stringify(second.data)).toBe(JSON.stringify(first.data));
  });
});
