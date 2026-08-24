/*
<MODULE_CONTRACT>
<purpose>
ADR-0035: Shared fetch mock helper for Cloudflare API tests. Routes by URL
pattern + HTTP method instead of fragile mockResolvedValueOnce sequences.
Reusable across subdomain-register, subdomain-validate, subdomain-list, and
cloudflare-api test files.
</purpose>
<non-goals>
  <item>Does not mock non-Cloudflare APIs — use a dedicated helper for other REST clients.</item>
  <item>Does not validate request payloads — tests inspect mockFetch.mock.calls for assertions.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0035: initial shared Cloudflare API mock helper with URL+method routing.</item>
</CHANGE_SUMMARY>
*/

import { vi } from "vitest";

export interface CloudflareMockHandlers {
  dnsList?: () => Response;
  routeList?: () => Response;
  createDns?: () => Response;
  createRoute?: () => Response;
  updateDns?: () => Response;
  deleteDns?: () => Response;
  purgeCache?: () => Response;
  redirectRuleset?: () => Response;
  createRedirectRule?: () => Response;
}

export function mockCloudflareResponse(ok: boolean, status: number, body: unknown): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

export function cfSuccessResponse(result: unknown): Response {
  return mockCloudflareResponse(true, 200, {
    success: true,
    errors: [],
    messages: [],
    result,
  });
}

export function cfErrorResponse(
  status: number,
  errors: { code: number; message: string }[],
): Response {
  return mockCloudflareResponse(status < 400, status, {
    success: false,
    errors,
    messages: [],
    result: null,
  });
}

export function dnsListResponse(records: unknown[]): Response {
  return cfSuccessResponse(records);
}

export function routeListResponse(routes: unknown[]): Response {
  return cfSuccessResponse(routes);
}

const defaultEmptyResponse = cfSuccessResponse([]);

export function setupCloudflareApiMock(
  mockFetch: ReturnType<typeof vi.fn>,
  handlers: CloudflareMockHandlers = {},
): void {
  mockFetch.mockImplementation(async (url: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";

    if (url.includes("/dns_records") && method === "GET") {
      return handlers.dnsList?.() ?? defaultEmptyResponse;
    }
    if (url.includes("/dns_records") && method === "POST") {
      return handlers.createDns?.() ?? cfSuccessResponse({});
    }
    if (url.includes("/dns_records") && method === "PUT") {
      return handlers.updateDns?.() ?? cfSuccessResponse({});
    }
    if (url.includes("/dns_records") && method === "DELETE") {
      return handlers.deleteDns?.() ?? cfSuccessResponse({});
    }
    if (url.includes("/workers/routes") && method === "GET") {
      return handlers.routeList?.() ?? defaultEmptyResponse;
    }
    if (url.includes("/workers/routes") && method === "POST") {
      return handlers.createRoute?.() ?? cfSuccessResponse({});
    }
    if (url.includes("/purge_cache") && method === "POST") {
      return handlers.purgeCache?.() ?? cfSuccessResponse({ id: "purge-ok" });
    }
    if (
      url.includes("/rulesets/phases/http_request_dynamic_redirect/entrypoint") &&
      method === "GET"
    ) {
      return (
        handlers.redirectRuleset?.() ??
        cfSuccessResponse({
          id: "ruleset-1",
          name: "redirect",
          phase: "http_request_dynamic_redirect",
          rules: [],
        })
      );
    }
    if (url.includes("/rulesets/") && url.includes("/rules") && method === "POST") {
      return handlers.createRedirectRule?.() ?? cfSuccessResponse({});
    }
    return defaultEmptyResponse;
  });
}
