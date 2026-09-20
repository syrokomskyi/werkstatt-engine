// test-adjacency: exempt — imports astro:env/server, not loadable in vitest
/*
<MODULE_CONTRACT>
<purpose>
RFC-0290: the only astro-aware module in this package. Wires createAgentGate
into ready-to-export Astro APIRoutes: reads the QStash publish secret via
astro:env/server (the same substrate the send-message section already uses,
RFC-0181), and reads knowledge files by self-fetching the site's own static
public/ assets (works identically in dev and on Cloudflare Workers).
</purpose>
<non-goals>
  <item>Do not implement gate logic here — that is index.ts/mcp/*; this module
        only wires ports and exposes Astro's GET/POST shape.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0290: initial Astro adapter.</item>
  <item>RFC-0954: add createAgentSearchRoute for semantic search endpoint.</item>
  <item>RFC-1112: dispatch returns ActionReceipt; wire restRedisReceiptStore when UPSTASH_REDIS_* are configured.</item>
  <item>RFC-1114: add createAgentA2aRoute for the A2A endpoint.</item>
  <item>RFC-1114: minimal real A2A endpoint + honest agent card</item>
  <item>RFC-1115: search results flattened to citation shape; tookMs is measured, not hardcoded.</item>
  <item>RFC-1112/1113/1114 gap fix: CORS Allow-Headers gains Idempotency-Key, MCP-Protocol-Version, A2A-Version; Expose-Headers gains X-Agent-Idempotency.</item>
</CHANGE_SUMMARY>
*/

import type { APIRoute } from "astro";
import {
  UPSTASH_QSTASH_TOKEN,
  UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN,
} from "astro:env/server";
import { buildQstashPublish, restRedisReceiptStore } from "@warpgogol/werkstatt-shared/integration";
import type { AgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";
import {
  SEARCH_EMBEDDING_MODEL,
  SEARCH_MAX_TOP_K,
  SEARCH_DEFAULT_TOP_K,
  SEARCH_CHUNK_TEXT_MAX_LENGTH,
  SEARCH_MANIFEST_PATH,
  type SearchQuery,
  type SearchChunk,
  type SearchManifest,
} from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import { createAgentGate, type AgentGatePorts } from "./index.ts";
import { createFixedWindowLimiter } from "./limits.ts";
import { runAgentSearch } from "./search-route.ts";
import { runAgentHealth } from "./health-route.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  // RFC-1112/1113/1114: browser agents must be allowed to send the protocol
  // headers — Idempotency-Key (actions), MCP-Protocol-Version (MCP), A2A-Version.
  "Access-Control-Allow-Headers":
    "Content-Type, Signature-Agent, Signature, User-Agent, x-search-reindex-token, Idempotency-Key, MCP-Protocol-Version, A2A-Version",
  "Access-Control-Expose-Headers": "X-Agent-Idempotency",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

function buildPorts(manifest: AgentSurfaceManifest, request: Request): AgentGatePorts {
  return {
    knowledge: {
      async read(path: string): Promise<string | null> {
        try {
          const res = await fetch(new URL(path, request.url));
          return res.ok ? await res.text() : null;
        } catch {
          return null;
        }
      },
    },
    dispatch: {
      async send(event) {
        const publishRequest = buildQstashPublish(event, {
          token: UPSTASH_QSTASH_TOKEN ?? "",
          callbackUrl: `${manifest.baseUrl}/api/integration-route`,
        });
        const res = await fetch(publishRequest);
        if (!res.ok) throw new Error(`QStash publish responded ${res.status}`);
        // RFC-1112: the adapter stamps submittedAt at publish time; receiptId == eventId.
        return {
          receiptId: event.eventId,
          status: "accepted" as const,
          duplicate: false,
          submittedAt: new Date().toISOString(),
        };
      },
    },
    now: () => new Date(),
    // RFC-0291: 60-second fixed window per capability per IP.
    createRateLimiter: (maxPerWindow) => createFixedWindowLimiter(60, maxPerWindow),
    // RFC-1112: receipt store over the same EU Redis as the delivery ledger.
    // Absent when the secrets are not configured — the gate then answers with
    // X-Agent-Idempotency: disabled.
    ...(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN
      ? {
          idempotency: restRedisReceiptStore({
            url: UPSTASH_REDIS_REST_URL,
            token: UPSTASH_REDIS_REST_TOKEN,
          }),
        }
      : {}),
  };
}

/** Factory the generated apps/<site>/src/pages/api/agent/mcp.ts calls with its manifest + capabilities. */
export function createAgentMcpRoute(
  manifest: AgentSurfaceManifest,
  catalog: CapabilityRecord[],
): { GET: APIRoute; POST: APIRoute; OPTIONS: APIRoute } {
  return {
    GET: async () => withCors(new Response(null, { status: 405, headers: { Allow: "POST" } })),
    POST: async ({ request }) => {
      const gate = createAgentGate(manifest, catalog, buildPorts(manifest, request));
      return withCors(await gate.handleMcp(request));
    },
    OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  };
}

/** Factory the generated apps/<site>/src/pages/api/agent/a2a.ts calls (RFC-1114). */
export function createAgentA2aRoute(
  manifest: AgentSurfaceManifest,
  catalog: CapabilityRecord[],
): { GET: APIRoute; POST: APIRoute; OPTIONS: APIRoute } {
  return {
    GET: async () => withCors(new Response(null, { status: 405, headers: { Allow: "POST" } })),
    POST: async ({ request }) => {
      const gate = createAgentGate(manifest, catalog, buildPorts(manifest, request));
      return withCors(await gate.handleA2a(request));
    },
    OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  };
}

/** Factory the generated apps/<site>/src/pages/api/agent/actions/[id].ts calls. */
export function createAgentActionRoute(
  manifest: AgentSurfaceManifest,
  catalog: CapabilityRecord[],
): { POST: APIRoute; OPTIONS: APIRoute } {
  return {
    POST: async ({ request, params }) => {
      const gate = createAgentGate(manifest, catalog, buildPorts(manifest, request));
      return withCors(await gate.handleAction(String(params.id ?? ""), request));
    },
    OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  };
}

// ---------------------------------------------------------------------------
// RFC-0954: Semantic search route
// ---------------------------------------------------------------------------

/** Cloudflare Workers AI + Vectorize bindings available at runtime. */
interface SearchEnv {
  AI?: { run(model: string, options: { text: string[] }): Promise<{ data: number[][] }> };
  SEARCH_INDEX?: {
    query(
      vector: number[],
      options: { topK: number; returnMetadata?: "all" | "none" },
    ): Promise<{
      matches?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>;
    }>;
    upsert(
      vectors: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }>,
    ): Promise<void>;
  };
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

/** Max chunks per Workers AI embedding batch call. */
const EMBED_BATCH_SIZE = 100;

/** Max vectors per Vectorize upsert batch. */
const UPSERT_BATCH_SIZE = 100;

class SearchValidationError extends Error {}

const VALID_CHUNK_TYPES: readonly string[] = ["page", "knowledge", "faq", "prose"];

/** Parse SearchQuery from URL search params. */
function parseSearchQuery(url: URL): SearchQuery {
  const q = url.searchParams.get("q") ?? "";
  if (!q.trim()) {
    throw new SearchValidationError("Missing required query parameter 'q'");
  }
  if (q.length > 1000) {
    throw new SearchValidationError("Query parameter 'q' exceeds 1000 characters");
  }
  const topKRaw = url.searchParams.get("topK");
  let topK = SEARCH_DEFAULT_TOP_K;
  if (topKRaw) {
    const parsed = Number.parseInt(topKRaw, 10);
    if (Number.isNaN(parsed) || parsed < 1) {
      topK = SEARCH_DEFAULT_TOP_K;
    } else {
      topK = Math.min(parsed, SEARCH_MAX_TOP_K);
    }
  }
  const typeRaw = url.searchParams.get("type");
  if (typeRaw && !VALID_CHUNK_TYPES.includes(typeRaw)) {
    throw new SearchValidationError(
      `Invalid 'type' parameter — must be one of: ${VALID_CHUNK_TYPES.join(", ")}`,
    );
  }
  return {
    q,
    ...(url.searchParams.get("lang") ? { lang: url.searchParams.get("lang")! } : {}),
    ...(typeRaw ? { type: typeRaw as SearchChunk["type"] } : {}),
    topK,
  };
}

/** Resolve Cloudflare Workers env bindings via dynamic import (CF-IMPORT-01 compliant). */
async function resolveSearchEnv(): Promise<SearchEnv> {
  try {
    const { env } = await import("cloudflare:workers");
    return env as unknown as SearchEnv;
  } catch {
    return {};
  }
}

/** Fetch the static search manifest from the site's own assets. */
async function fetchSearchManifest(
  request: Request,
  env: SearchEnv,
): Promise<SearchManifest | null> {
  try {
    const manifestUrl = new URL(`/${SEARCH_MANIFEST_PATH}`, request.url);
    const res = env.ASSETS
      ? await env.ASSETS.fetch(new Request(manifestUrl))
      : await fetch(manifestUrl);
    if (!res.ok) return null;
    return (await res.json()) as SearchManifest;
  } catch {
    return null;
  }
}

/** Factory the generated apps/<site>/src/pages/api/agent/search.ts calls. */
export function createAgentSearchRoute(_manifest: AgentSurfaceManifest): {
  GET: APIRoute;
  POST: APIRoute;
  OPTIONS: APIRoute;
} {
  return {
    GET: async ({ request }) => {
      const env = await resolveSearchEnv();
      if (!env.AI || !env.SEARCH_INDEX) {
        return withCors(
          new Response(
            JSON.stringify({
              error: "Search index not available — AI or SEARCH_INDEX binding missing",
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      let query: SearchQuery;
      try {
        query = parseSearchQuery(new URL(request.url));
      } catch (err) {
        return withCors(
          new Response(JSON.stringify({ error: (err as Error).message }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      const searchManifest = await fetchSearchManifest(request, env);
      if (!searchManifest) {
        return withCors(
          new Response(JSON.stringify({ error: "Search manifest not found" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      try {
        // RFC-1115: core lives in search-route.ts — flattened citation shape,
        // measured tookMs, no astro imports (vitest-loadable).
        const response = await runAgentSearch(query, searchManifest, {
          ai: env.AI,
          searchIndex: env.SEARCH_INDEX,
        });

        return withCors(
          new Response(JSON.stringify(response), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      } catch (err) {
        return withCors(
          new Response(JSON.stringify({ error: `Search failed: ${(err as Error).message}` }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    },

    POST: async ({ request }) => {
      const env = await resolveSearchEnv();
      const url = new URL(request.url);

      // Reindex endpoint — requires x-search-reindex-token header when configured
      if (url.pathname.endsWith("/reindex")) {
        const reindexToken = process.env.SEARCH_REINDEX_TOKEN;
        if (reindexToken) {
          const provided = request.headers.get("x-search-reindex-token");
          if (provided !== reindexToken) {
            return withCors(
              new Response(JSON.stringify({ error: "Invalid reindex token" }), {
                status: 403,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }
        }

        if (!env.AI || !env.SEARCH_INDEX) {
          return withCors(
            new Response(
              JSON.stringify({
                error: "Search index not available — AI or SEARCH_INDEX binding missing",
              }),
              { status: 503, headers: { "Content-Type": "application/json" } },
            ),
          );
        }

        const searchManifest = await fetchSearchManifest(request, env);
        if (!searchManifest) {
          return withCors(
            new Response(JSON.stringify({ error: "Search manifest not found" }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }

        try {
          const chunks = searchManifest.chunks;
          let upserted = 0;

          for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
            const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
            const texts = batch.map((c) => c.text.slice(0, SEARCH_CHUNK_TEXT_MAX_LENGTH));

            const embedResult = await env.AI.run(SEARCH_EMBEDDING_MODEL, { text: texts });
            const vectors = embedResult.data;

            for (let j = 0; j < batch.length; j += UPSERT_BATCH_SIZE) {
              const upsertBatch: Array<{
                id: string;
                values: number[];
                metadata: Record<string, unknown>;
              }> = [];
              for (let k = j; k < Math.min(j + UPSERT_BATCH_SIZE, batch.length); k++) {
                upsertBatch.push({
                  id: batch[k].id,
                  values: vectors[k],
                  metadata: {
                    lang: batch[k].lang,
                    type: batch[k].type,
                    url: batch[k].url,
                    heading: batch[k].heading ?? "",
                  },
                });
              }
              await env.SEARCH_INDEX.upsert(upsertBatch);
              upserted += upsertBatch.length;
            }
          }

          return withCors(
            new Response(
              JSON.stringify({
                status: "ok",
                mutationId: `reindex-${Date.now()}`,
                chunks: upserted,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        } catch (err) {
          return withCors(
            new Response(JSON.stringify({ error: `Reindex failed: ${(err as Error).message}` }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
      }

      // Non-reindex POST — direct users to GET for queries
      return withCors(
        new Response(
          JSON.stringify({
            error: "Use GET for search queries, POST /reindex for reindexing",
          }),
          {
            status: 405,
            headers: { "Content-Type": "application/json", Allow: "GET, OPTIONS" },
          },
        ),
      );
    },

    OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  };
}

// ---------------------------------------------------------------------------
// RFC-1116: Agent surface health route
// ---------------------------------------------------------------------------

/**
 * Factory the generated apps/<site>/src/pages/api/agent/health.ts calls.
 * Core lives in health-route.ts (vitest-loadable); this adapter only resolves
 * env + the QStash token and wraps the response in CORS headers.
 */
export function createAgentHealthRoute(manifest: AgentSurfaceManifest): {
  GET: APIRoute;
  OPTIONS: APIRoute;
} {
  return {
    GET: async ({ request }) => {
      const env = await resolveSearchEnv();
      const { status, body } = await runAgentHealth(manifest, {
        requestUrl: request.url,
        fetchFn: fetch,
        env,
        qstashToken: UPSTASH_QSTASH_TOKEN,
      });
      return withCors(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
    OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  };
}
