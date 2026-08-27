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
</CHANGE_SUMMARY>
*/

import type { APIRoute } from "astro";
import { UPSTASH_QSTASH_TOKEN } from "astro:env/server";
import { buildQstashPublish } from "@warpgogol/werkstatt-shared/integration";
import type { AgentSurfaceManifest } from "@warpgogol/werkstatt-shared/share/agent";
import {
  SEARCH_EMBEDDING_MODEL,
  SEARCH_EMBEDDING_DIMENSIONS,
  SEARCH_MAX_TOP_K,
  SEARCH_DEFAULT_TOP_K,
  SEARCH_CHUNK_TEXT_MAX_LENGTH,
  SEARCH_MANIFEST_PATH,
  type SearchQuery,
  type SearchResponse,
  type SearchResult,
  type SearchChunk,
  type SearchManifest,
} from "@warpgogol/werkstatt-shared/share/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import { createAgentGate, type AgentGatePorts } from "./index.ts";
import { createFixedWindowLimiter } from "./limits.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Signature-Agent, Signature, User-Agent, x-search-reindex-token",
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
        return { accepted: true, eventId: event.eventId };
      },
    },
    now: () => new Date(),
    // RFC-0291: 60-second fixed window per capability per IP.
    createRateLimiter: (maxPerWindow) => createFixedWindowLimiter(60, maxPerWindow),
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
  return {
    q,
    ...(url.searchParams.get("lang") ? { lang: url.searchParams.get("lang")! } : {}),
    ...(url.searchParams.get("type")
      ? { type: url.searchParams.get("type") as SearchChunk["type"] }
      : {}),
    topK,
  };
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
      const env = (request as unknown as { env?: SearchEnv }).env ?? {};
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

      const chunkById = new Map<string, SearchChunk>(searchManifest.chunks.map((c) => [c.id, c]));

      try {
        const embeddingResult = await env.AI.run(SEARCH_EMBEDDING_MODEL, {
          text: [query.q],
        });
        const queryVector = embeddingResult.data[0];

        const vectorizeResult = await env.SEARCH_INDEX.query(queryVector, {
          topK: query.topK ?? SEARCH_DEFAULT_TOP_K,
          returnMetadata: "all",
        });

        const results: SearchResult[] = [];
        for (const match of vectorizeResult.matches ?? []) {
          const chunk = chunkById.get(match.id);
          if (!chunk) continue;
          results.push({ chunk, score: match.score });
        }

        const response: SearchResponse = {
          query: query.q,
          results,
          tookMs: 0,
        };

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
      const env = (request as unknown as { env?: SearchEnv }).env ?? {};
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
