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

export type {
  CloudflareDnsRecord,
  CloudflareWorkersRoute,
  CloudflareRedirectRule,
  CloudflareRuleset,
};
