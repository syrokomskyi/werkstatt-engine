/*
<MODULE_CONTRACT>
<purpose>
RFC-0752/RFC-0753: Cloudflare REST API client for DNS records and Workers routes.
Provides typed functions for listing, creating, updating, deleting, and verifying
DNS records and Workers routes via the Cloudflare API. Separate from
cloudflare-workers.ts (which wraps wrangler CLI) — this module uses the REST API directly.
</purpose>
<non-goals>
  <item>Do not log, echo, or serialize secret values or resolved secrets-file contents.</item>
  <item>Do not implement DNS propagation waiting or health checks — those are out of scope for this module.</item>
  <item>Do not implement cache purge — that lives in cache-purge.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0752: initial Cloudflare REST API client — listDnsRecords, createDnsRecord, listWorkersRoutes, createWorkersRoute.</item>
  <item>RFC-0753: add pagination, retry, updateDnsRecord, deleteDnsRecord, generalized createDnsRecord for all record types.</item>
  <item>RFC-0896: add getRedirectRuleset, createRedirectRule for Cloudflare Rulesets API (Redirect Rules).</item>
  <item>RFC-1325: add getWorkersSubdomain, listWorkerNames — account-scoped Workers subdomain + script-name listing for provisional-host birth.</item>
  <item>RFC-1326: single Cloudflare permission registry, token preflight, birth provisioning</item>
</CHANGE_SUMMARY>
*/

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  priority: number | null;
  ttl?: number;
}

interface CloudflareWorkersRoute {
  id: string;
  pattern: string;
  script: string | null;
}

interface CloudflareListResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: { code: number; message: string }[];
  result: T[];
  result_info?: {
    page: number;
    per_page: number;
    total_pages: number;
    count: number;
    total_count: number;
  };
}

interface CloudflareCreateResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: { code: number; message: string }[];
  result: T;
}

function authHeaders(apiToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };
}

const RETRYABLE_STATUSES = new Set([502, 503, 504, 522]);
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 2000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init: RequestInit, label: string): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || !RETRYABLE_STATUSES.has(response.status)) {
        return response;
      }
      lastError = new Error(`[cloudflare-api] ${label} transient failure: HTTP ${response.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError ?? new Error(`[cloudflare-api] ${label} exhausted retries`);
}

export async function listDnsRecords(
  zoneId: string,
  apiToken: string,
  name?: string,
): Promise<CloudflareDnsRecord[]> {
  const allRecords: CloudflareDnsRecord[] = [];
  let page = 1;
  const perPage = 50;

  while (true) {
    const url = new URL(`${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records`);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    if (name) {
      url.searchParams.set("name", name);
    }

    const response = await fetchWithRetry(
      url.toString(),
      { headers: authHeaders(apiToken) },
      "listDnsRecords",
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => `HTTP ${response.status}`);
      throw new Error(
        `[cloudflare-api] listDnsRecords failed: HTTP ${response.status}: ${errorText}`,
      );
    }

    const body = (await response.json()) as CloudflareListResponse<CloudflareDnsRecord>;
    if (!body.success) {
      const errorMessages = body.errors.map((e) => `${e.code}: ${e.message}`).join(", ");
      throw new Error(`[cloudflare-api] listDnsRecords API errors: ${errorMessages}`);
    }

    allRecords.push(...body.result);

    const totalPages = body.result_info?.total_pages ?? 1;
    if (page >= totalPages) break;
    page++;
  }

  return allRecords;
}

export async function createDnsRecord(
  zoneId: string,
  apiToken: string,
  record: {
    type: string;
    name: string;
    content?: string;
    data?: { priority: number; target: string; value: string };
    proxied?: boolean;
    priority?: number;
    ttl?: number;
    comment?: string;
  },
): Promise<CloudflareDnsRecord> {
  const response = await fetchWithRetry(
    `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records`,
    {
      method: "POST",
      headers: authHeaders(apiToken),
      body: JSON.stringify(record),
    },
    "createDnsRecord",
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(
      `[cloudflare-api] createDnsRecord failed: HTTP ${response.status}: ${errorText}`,
    );
  }

  const body = (await response.json()) as CloudflareCreateResponse<CloudflareDnsRecord>;
  if (!body.success) {
    const errorMessages = body.errors.map((e) => `${e.code}: ${e.message}`).join(", ");
    throw new Error(`[cloudflare-api] createDnsRecord API errors: ${errorMessages}`);
  }

  return body.result;
}

export async function updateDnsRecord(
  zoneId: string,
  apiToken: string,
  recordId: string,
  record: {
    type: string;
    name: string;
    content?: string;
    data?: { priority: number; target: string; value: string };
    proxied?: boolean;
    priority?: number;
    ttl?: number;
    comment?: string;
  },
): Promise<CloudflareDnsRecord> {
  const response = await fetchWithRetry(
    `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${recordId}`,
    {
      method: "PUT",
      headers: authHeaders(apiToken),
      body: JSON.stringify(record),
    },
    "updateDnsRecord",
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(
      `[cloudflare-api] updateDnsRecord failed: HTTP ${response.status}: ${errorText}`,
    );
  }

  const body = (await response.json()) as CloudflareCreateResponse<CloudflareDnsRecord>;
  if (!body.success) {
    const errorMessages = body.errors.map((e) => `${e.code}: ${e.message}`).join(", ");
    throw new Error(`[cloudflare-api] updateDnsRecord API errors: ${errorMessages}`);
  }

  return body.result;
}

export async function deleteDnsRecord(
  zoneId: string,
  apiToken: string,
  recordId: string,
): Promise<void> {
  const response = await fetchWithRetry(
    `${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${recordId}`,
    {
      method: "DELETE",
      headers: authHeaders(apiToken),
    },
    "deleteDnsRecord",
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(
      `[cloudflare-api] deleteDnsRecord failed: HTTP ${response.status}: ${errorText}`,
    );
  }

  const body = (await response.json()) as CloudflareCreateResponse<unknown>;
  if (!body.success) {
    const errorMessages = body.errors.map((e) => `${e.code}: ${e.message}`).join(", ");
    throw new Error(`[cloudflare-api] deleteDnsRecord API errors: ${errorMessages}`);
  }
}

export async function listWorkersRoutes(
  zoneId: string,
  apiToken: string,
): Promise<CloudflareWorkersRoute[]> {
  const response = await fetch(`${CLOUDFLARE_API_BASE}/zones/${zoneId}/workers/routes`, {
    headers: authHeaders(apiToken),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(
      `[cloudflare-api] listWorkersRoutes failed: HTTP ${response.status}: ${errorText}`,
    );
  }

  const body = (await response.json()) as CloudflareListResponse<CloudflareWorkersRoute>;
  if (!body.success) {
    const errorMessages = body.errors.map((e) => `${e.code}: ${e.message}`).join(", ");
    throw new Error(`[cloudflare-api] listWorkersRoutes API errors: ${errorMessages}`);
  }

  return body.result;
}

export async function createWorkersRoute(
  zoneId: string,
  apiToken: string,
  route: { pattern: string; script: string },
): Promise<CloudflareWorkersRoute> {
  const response = await fetch(`${CLOUDFLARE_API_BASE}/zones/${zoneId}/workers/routes`, {
    method: "POST",
    headers: authHeaders(apiToken),
    body: JSON.stringify(route),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(
      `[cloudflare-api] createWorkersRoute failed: HTTP ${response.status}: ${errorText}`,
    );
  }

  const body = (await response.json()) as CloudflareCreateResponse<CloudflareWorkersRoute>;
  if (!body.success) {
    const errorMessages = body.errors.map((e) => `${e.code}: ${e.message}`).join(", ");
    throw new Error(`[cloudflare-api] createWorkersRoute API errors: ${errorMessages}`);
  }

  return body.result;
}

interface CloudflareRedirectRuleActionParameters {
  status_code: number;
  target_url: { expression: string };
}

interface CloudflareRedirectRule {
  id: string;
  description: string;
  enabled: boolean;
  action: "redirect";
  expression: string;
  action_parameters: CloudflareRedirectRuleActionParameters;
}

interface CloudflareRuleset {
  id: string;
  name: string;
  phase: string;
  rules: CloudflareRedirectRule[];
}

interface CloudflareSingleResultResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: { code: number; message: string }[];
  result: T;
}

export async function getRedirectRuleset(
  zoneId: string,
  apiToken: string,
): Promise<CloudflareRuleset> {
  const response = await fetchWithRetry(
    `${CLOUDFLARE_API_BASE}/zones/${zoneId}/rulesets/phases/http_request_dynamic_redirect/entrypoint`,
    { headers: authHeaders(apiToken) },
    "getRedirectRuleset",
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(
      `[cloudflare-api] getRedirectRuleset failed: HTTP ${response.status}: ${errorText}`,
    );
  }

  const body = (await response.json()) as CloudflareSingleResultResponse<CloudflareRuleset>;
  if (!body.success) {
    const errorMessages = body.errors.map((e) => `${e.code}: ${e.message}`).join(", ");
    throw new Error(`[cloudflare-api] getRedirectRuleset API errors: ${errorMessages}`);
  }

  return body.result;
}

export async function createRedirectRule(
  zoneId: string,
  rulesetId: string,
  apiToken: string,
  rule: {
    description: string;
    expression: string;
    action_parameters: CloudflareRedirectRuleActionParameters;
  },
): Promise<CloudflareRedirectRule> {
  const response = await fetchWithRetry(
    `${CLOUDFLARE_API_BASE}/zones/${zoneId}/rulesets/${rulesetId}/rules`,
    {
      method: "POST",
      headers: authHeaders(apiToken),
      body: JSON.stringify({
        description: rule.description,
        expression: rule.expression,
        action: "redirect",
        action_parameters: rule.action_parameters,
        enabled: true,
      }),
    },
    "createRedirectRule",
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(
      `[cloudflare-api] createRedirectRule failed: HTTP ${response.status}: ${errorText}`,
    );
  }

  const body = (await response.json()) as CloudflareSingleResultResponse<CloudflareRedirectRule>;
  if (!body.success) {
    const errorMessages = body.errors.map((e) => `${e.code}: ${e.message}`).join(", ");
    throw new Error(`[cloudflare-api] createRedirectRule API errors: ${errorMessages}`);
  }

  return body.result;
}

interface CloudflareWorkersSubdomainResult {
  subdomain: string;
}

interface CloudflareWorkerScript {
  id: string;
}

/**
 * RFC-1325: account-scoped Workers subdomain —
 * `GET /accounts/{accountId}/workers/subdomain`. Used at site birth to verify a
 * provisional `--domain` host actually lives on this account.
 */
export async function getWorkersSubdomain(accountId: string, apiToken: string): Promise<string> {
  const response = await fetchWithRetry(
    `${CLOUDFLARE_API_BASE}/accounts/${accountId}/workers/subdomain`,
    { headers: authHeaders(apiToken) },
    "getWorkersSubdomain",
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(
      `[cloudflare-api] getWorkersSubdomain failed: HTTP ${response.status}: ${errorText}`,
    );
  }

  const body =
    (await response.json()) as CloudflareSingleResultResponse<CloudflareWorkersSubdomainResult>;
  if (!body.success) {
    const errorMessages = body.errors.map((e) => `${e.code}: ${e.message}`).join(", ");
    throw new Error(`[cloudflare-api] getWorkersSubdomain API errors: ${errorMessages}`);
  }

  return body.result.subdomain;
}

/**
 * RFC-1325: all Worker script names on the account — paginated
 * `GET /accounts/{accountId}/workers/scripts`. Used at site birth to refuse a
 * `<id>`/`dev-<id>`/`alt-<id>` worker-name collision before any write.
 */
export async function listWorkerNames(accountId: string, apiToken: string): Promise<string[]> {
  const names: string[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = new URL(`${CLOUDFLARE_API_BASE}/accounts/${accountId}/workers/scripts`);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const response = await fetchWithRetry(
      url.toString(),
      { headers: authHeaders(apiToken) },
      "listWorkerNames",
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => `HTTP ${response.status}`);
      throw new Error(
        `[cloudflare-api] listWorkerNames failed: HTTP ${response.status}: ${errorText}`,
      );
    }

    const body = (await response.json()) as CloudflareListResponse<CloudflareWorkerScript>;
    if (!body.success) {
      const errorMessages = body.errors.map((e) => `${e.code}: ${e.message}`).join(", ");
      throw new Error(`[cloudflare-api] listWorkerNames API errors: ${errorMessages}`);
    }

    names.push(...body.result.map((s) => s.id));

    const totalPages = body.result_info?.total_pages ?? 1;
    if (page >= totalPages) break;
    page++;
  }

  return names;
}

interface CloudflareTokenVerifyResult {
  id: string;
  status: string;
}

/**
 * RFC-1326: `GET /user/tokens/verify` — resolves the token's id and status so
 * cloudflare.token.check can name the exact dashboard token under test.
 */
export async function verifyToken(apiToken: string): Promise<{ id: string; status: string }> {
  const response = await fetchWithRetry(
    `${CLOUDFLARE_API_BASE}/user/tokens/verify`,
    { headers: authHeaders(apiToken) },
    "verifyToken",
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(`[cloudflare-api] verifyToken failed: HTTP ${response.status}: ${errorText}`);
  }

  const body =
    (await response.json()) as CloudflareSingleResultResponse<CloudflareTokenVerifyResult>;
  if (!body.success) {
    const errorMessages = body.errors.map((e) => `${e.code}: ${e.message}`).join(", ");
    throw new Error(`[cloudflare-api] verifyToken API errors: ${errorMessages}`);
  }

  return { id: body.result.id, status: body.result.status };
}

export type CloudflareProbeOutcome = "ok" | "missing" | "unknown";

const PERMISSION_DENIED_CODES = new Set([10000, 9109, 10001]);

/**
 * RFC-1326: one registry probe — a read-only GET proving a permission scope.
 * `ok` = endpoint answered; `missing` = HTTP 403 or a Cloudflare permission
 * error code (10000/9109/10001); anything else (network failure, unexpected
 * status) = `unknown` — a warning, never a `missing` verdict.
 */
export async function probePermission(
  path: string,
  apiToken: string,
): Promise<CloudflareProbeOutcome> {
  let response: Response;
  try {
    response = await fetch(`${CLOUDFLARE_API_BASE}${path}`, {
      headers: authHeaders(apiToken),
    });
  } catch {
    return "unknown";
  }

  if (response.ok) {
    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      errors?: { code: number }[];
    } | null;
    if (body && body.success === false) {
      const codes = (body.errors ?? []).map((e) => e.code);
      return codes.some((c) => PERMISSION_DENIED_CODES.has(c)) ? "missing" : "unknown";
    }
    return "ok";
  }
  if (response.status === 403) return "missing";
  return "unknown";
}

/**
 * Resolve a zone id from a domain name — `GET /zones?name=<domain>` — so
 * `--zone` accepts either an id or a domain (RFC-1326).
 */
export async function resolveZoneIdByName(
  domain: string,
  apiToken: string,
): Promise<string | null> {
  let response: Response;
  try {
    const url = new URL(`${CLOUDFLARE_API_BASE}/zones`);
    url.searchParams.set("name", domain);
    response = await fetch(url.toString(), { headers: authHeaders(apiToken) });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    result?: { id: string }[];
  } | null;
  if (!body?.success || !Array.isArray(body.result) || body.result.length === 0) return null;
  return body.result[0]!.id;
}

export type {
  CloudflareDnsRecord,
  CloudflareWorkersRoute,
  CloudflareRedirectRule,
  CloudflareRuleset,
};
