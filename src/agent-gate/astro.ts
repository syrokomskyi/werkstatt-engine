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
  <item>RFC-1115: search results flattened to citation shape; tookMs is measured, not hardcoded.</item>
  <item>RFC-1112/1113/1114 gap fix: CORS Allow-Headers gains Idempotency-Key, MCP-Protocol-Version, A2A-Version; Expose-Headers gains X-Agent-Idempotency.</item>
  <item>RFC-1172: closed agent.traffic telemetry — ports.telemetry sink, TrafficRecorder + boundary emit via withTrafficEmit</item>
  <item>RFC-1172: fo-review — extractAgentIdentity on all routes, honest mcpProtocolVersion, top-level import, test header</item>
  <item>RFC-1187: phases 1-3 — contracts, Redis registry, AS core + Bearer pipeline</item>
  <history>RFC-0290, RFC-0954, RFC-1112, RFC-1114</history>
</CHANGE_SUMMARY>
*/

import type { APIRoute } from "astro";
import {
  UPSTASH_QSTASH_TOKEN,
  UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN,
  getSecret,
} from "astro:env/server";
import { buildQstashPublish, restRedisReceiptStore } from "@warpgogol/werkstatt-shared/integration";
import { restRedisAgentRegistry } from "@warpgogol/werkstatt-shared/integration/agent-registry";
import type { AgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";
import {
  b64uDecode,
  b64uEncode,
  deriveAgentId,
  buildAgentProblem,
  type AgentRegistrationVerifier,
} from "@warpgogol/werkstatt-shared/agent";
import { getPublicKey, verifyBytes } from "@warpgogol/werkstatt-shared/signing";
import { createHash } from "node:crypto";
import {
  runOAuthChallenge,
  runAgentRegister,
  runAgentToken,
  runAgentJwks,
  runWhoami,
  runRotate,
  type AgentAuthPorts,
} from "./agent-auth.ts";
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
import { createAgentGate, extractAgentIdentity, type AgentGatePorts } from "./index.ts";
import { emitAgentTraffic, workerLogTelemetry, type TrafficRecorder } from "./telemetry.ts";
import { createFixedWindowLimiter } from "./limits.ts";
import { runAgentSearch } from "./search-route.ts";
import { runAgentHealth } from "./health-route.ts";
import { runNlwebAsk } from "./nlweb-ask.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  // RFC-1112/1113/1114/1187: browser agents must be allowed to send the protocol
  // headers — Idempotency-Key (actions), MCP-Protocol-Version (MCP), A2A-Version,
  // Authorization (Bearer tokens for the registration tier).
  "Access-Control-Allow-Headers":
    "Content-Type, Signature-Agent, Signature, User-Agent, x-search-reindex-token, Idempotency-Key, MCP-Protocol-Version, A2A-Version, Authorization",
  "Access-Control-Expose-Headers": "X-Agent-Idempotency",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * RFC-1187: decode the SIGNING_PRIVATE_KEY secret into an Ed25519 seed.
 * Accepts the repo's two encodings: PEM wrapping the raw 32-byte seed
 * (toPem output) or a standard PKCS8 DER (48 bytes — seed is the tail),
 * plus 64-char hex.
 */
function parseSigningSecret(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (trimmed.includes("-----BEGIN")) {
    const b64 = trimmed
      .replace(/-----BEGIN [A-Z ]+-----/g, "")
      .replace(/-----END [A-Z ]+-----/g, "")
      .replace(/\s+/g, "");
    const bytes = new Uint8Array(Buffer.from(b64, "base64"));
    if (bytes.length === 32) return bytes;
    if (bytes.length === 48) return bytes.slice(-32);
    return null;
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return new Uint8Array(Buffer.from(trimmed, "hex"));
  }
  return null;
}

/**
 * RFC-1187: concrete key-proof verifier — the ONLY place the signatureAgent
 * JWKS fetch happens (SSRF guards live here: https-only, redirect error,
 * 3s timeout, 64 KiB body cap). Tries every Ed25519 OKP key in the fetched
 * directory (kid narrows when present); the derived agentId binds to the
 * signatureAgent URL, not to any caller-chosen handle.
 */
function createAgentRegistrationVerifier(): AgentRegistrationVerifier {
  return {
    async verify(proof) {
      try {
        const url = new URL(proof.signatureAgent);
        if (url.protocol !== "https:") return null;
        const res = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(3000),
          headers: { accept: "application/json" },
        });
        if (!res.ok) return null;
        const text = await res.text();
        if (text.length > 64 * 1024) return null;
        const doc = JSON.parse(text) as {
          keys?: Array<{ kty?: string; crv?: string; x?: string; kid?: string }>;
        };
        const candidates = (doc.keys ?? []).filter(
          (key) =>
            key.kty === "OKP" &&
            key.crv === "Ed25519" &&
            typeof key.x === "string" &&
            (!proof.kid || key.kid === proof.kid),
        );
        const signature = b64uDecode(proof.signature);
        if (!signature || signature.length !== 64) return null;
        const message = new TextEncoder().encode(proof.challenge);
        for (const key of candidates) {
          const publicKey = b64uDecode(key.x!);
          if (publicKey?.length === 32 && (await verifyBytes(publicKey, message, signature))) {
            return {
              agentId: deriveAgentId(proof.signatureAgent, (input) =>
                createHash("sha256").update(input, "utf8").digest("hex"),
              ),
            };
          }
        }
        return null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * RFC-1187: assemble the authorization-server ports when the runtime wiring
 * exists — Upstash Redis (registry) + SIGNING_PRIVATE_KEY (token issuance,
 * the same passport key). Absent either → anonymous tier everywhere.
 */
async function buildAuthPorts(manifest: AgentSurfaceManifest): Promise<AgentAuthPorts | null> {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return null;
  const secret = getSecret("SIGNING_PRIVATE_KEY");
  if (!secret) return null;
  const privateKey = parseSigningSecret(secret);
  if (!privateKey) {
    console.warn("agent-auth: SIGNING_PRIVATE_KEY is set but unreadable — auth ports disabled");
    return null;
  }
  const publicKey = await getPublicKey(privateKey);
  return {
    registry: restRedisAgentRegistry({
      url: UPSTASH_REDIS_REST_URL,
      token: UPSTASH_REDIS_REST_TOKEN,
    }),
    verifier: createAgentRegistrationVerifier(),
    tokenPrivateKey: privateKey,
    tokenPublicKey: publicKey,
    issuer: manifest.baseUrl.replace(/\/+$/, ""),
    resourceMetadataUrl: `${manifest.baseUrl.replace(/\/+$/, "")}/.well-known/oauth-protected-resource`,
  };
}

async function buildPorts(
  manifest: AgentSurfaceManifest,
  request: Request,
): Promise<AgentGatePorts> {
  const authPorts = await buildAuthPorts(manifest);
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
    // RFC-1172: one structured JSON line per gate request → Workers logs.
    telemetry: workerLogTelemetry,
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
    // RFC-1187: auth ports ride the same request-scoped build — null when the
    // site has no signing key wired (anonymous tier stays the contract).
    ...(authPorts ? { auth: authPorts } : {}),
  };
}

/**
 * RFC-1172: boundary emit — build ports, run the handler with a fresh
 * TrafficRecorder, emit exactly one closed event after the response resolves.
 */
async function withTrafficEmit(
  manifest: AgentSurfaceManifest,
  request: Request,
  protocol: "http" | "mcp" | "a2a" | "nlweb",
  run: (traffic: TrafficRecorder, ports: AgentGatePorts) => Promise<Response>,
): Promise<Response> {
  const ports = await buildPorts(manifest, request);
  const traffic: TrafficRecorder = {};
  const started = Date.now();
  const response = await run(traffic, ports);
  await emitAgentTraffic(ports, {
    systemId: manifest.site,
    protocol,
    response,
    traffic,
    durationMs: Date.now() - started,
  });
  return response;
}

/** Factory the generated apps/<site>/src/pages/api/agent/mcp.ts calls with its manifest + capabilities. */
export function createAgentMcpRoute(
  manifest: AgentSurfaceManifest,
  catalog: CapabilityRecord[],
): { GET: APIRoute; POST: APIRoute; OPTIONS: APIRoute } {
  return {
    GET: async ({ request }) =>
      withCors(
        await withTrafficEmit(manifest, request, "mcp", (traffic, ports) =>
          createAgentGate(manifest, catalog, ports).handleMcp(request, traffic),
        ),
      ),
    POST: async ({ request }) =>
      withCors(
        await withTrafficEmit(manifest, request, "mcp", (traffic, ports) =>
          createAgentGate(manifest, catalog, ports).handleMcp(request, traffic),
        ),
      ),
    OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  };
}

/** Factory the generated apps/<site>/src/pages/api/agent/a2a.ts calls (RFC-1114). */
export function createAgentA2aRoute(
  manifest: AgentSurfaceManifest,
  catalog: CapabilityRecord[],
): { GET: APIRoute; POST: APIRoute; OPTIONS: APIRoute } {
  return {
    GET: async ({ request }) =>
      withCors(
        await withTrafficEmit(manifest, request, "a2a", (traffic, ports) =>
          createAgentGate(manifest, catalog, ports).handleA2a(request, traffic),
        ),
      ),
    POST: async ({ request }) =>
      withCors(
        await withTrafficEmit(manifest, request, "a2a", (traffic, ports) =>
          createAgentGate(manifest, catalog, ports).handleA2a(request, traffic),
        ),
      ),
    OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  };
}

/** Factory the generated apps/<site>/src/pages/api/agent/actions/[id].ts calls. */
export function createAgentActionRoute(
  manifest: AgentSurfaceManifest,
  catalog: CapabilityRecord[],
): { POST: APIRoute; OPTIONS: APIRoute } {
  return {
    POST: async ({ request, params }) =>
      withCors(
        await withTrafficEmit(manifest, request, "http", (traffic, ports) =>
          createAgentGate(manifest, catalog, ports).handleAction(
            String(params.id ?? ""),
            request,
            traffic,
          ),
        ),
      ),
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
export function createAgentSearchRoute(manifest: AgentSurfaceManifest): {
  GET: APIRoute;
  POST: APIRoute;
  OPTIONS: APIRoute;
} {
  return {
    GET: async ({ request }) =>
      await withTrafficEmit(manifest, request, "http", async (traffic) => {
        traffic.operation = "search";
        traffic.observedIdentity = extractAgentIdentity(request);
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
      }),

    POST: async ({ request }) =>
      await withTrafficEmit(manifest, request, "http", async (traffic) => {
        const env = await resolveSearchEnv();
        const url = new URL(request.url);

        traffic.observedIdentity = extractAgentIdentity(request);
        // RFC-1172: reindex is operator maintenance, not a query — `other`.
        traffic.operation = url.pathname.endsWith("/reindex") ? "other" : "search";
        if (traffic.operation === "other") traffic.capability = "search.reindex";

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
      }),

    OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  };
}

// ---------------------------------------------------------------------------
// RFC-1165: NLWeb /ask route
// ---------------------------------------------------------------------------

/**
 * Factory the generated apps/<site>/src/pages/ask.ts calls.
 * Core lives in nlweb-ask.ts (vitest-loadable, deterministic extractive —
 * ADR-0097); this adapter only resolves env bindings, the search manifest,
 * and the RFC-1164 .jsonld mirror fetch, then maps { status, body } to HTTP.
 */
export function createAgentNlwebRoute(manifest: AgentSurfaceManifest): {
  POST: APIRoute;
  OPTIONS: APIRoute;
} {
  return {
    POST: async ({ request }) =>
      await withTrafficEmit(manifest, request, "nlweb", async (traffic) => {
        traffic.operation = "ask";
        traffic.observedIdentity = extractAgentIdentity(request);
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

        const searchManifest = await fetchSearchManifest(request, env);
        if (!searchManifest) {
          return withCors(
            new Response(JSON.stringify({ error: "Search manifest not found" }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return withCors(
            new Response(JSON.stringify({ error: "Request body must be JSON" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }

        // RFC-1164: schema_object per result is sourced from the route's .jsonld
        // mirror — served sibling of the search manifest, fetched via ASSETS.
        const fetchMirror = async (mirrorPath: string): Promise<unknown | null> => {
          try {
            const url = new URL(`/${mirrorPath}`, request.url);
            const res = env.ASSETS ? await env.ASSETS.fetch(new Request(url)) : await fetch(url);
            return res.ok ? await res.json() : null;
          } catch {
            return null;
          }
        };

        try {
          const { status, body: responseBody } = await runNlwebAsk(body, manifest, searchManifest, {
            ai: env.AI,
            searchIndex: env.SEARCH_INDEX,
            fetchMirror,
          });
          return withCors(
            new Response(JSON.stringify(responseBody), {
              status,
              headers: { "Content-Type": "application/json" },
            }),
          );
        } catch (err) {
          return withCors(
            new Response(JSON.stringify({ error: `Ask failed: ${(err as Error).message}` }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
      }),

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
    GET: async ({ request }) =>
      await withTrafficEmit(manifest, request, "http", async (traffic) => {
        traffic.operation = "health";
        traffic.observedIdentity = extractAgentIdentity(request);
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
      }),
    OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  };
}

// ---------------------------------------------------------------------------
// RFC-1187: authorization-server route adapters — thin wrappers over the pure
// agent-auth.ts core. A missing `ports.auth` (no Redis secrets / no signing
// key) answers oauth-unavailable rather than 500: the anonymous contract
// stays the fallback everywhere.
// ---------------------------------------------------------------------------

const OAUTH_UNAVAILABLE = () =>
  new Response(JSON.stringify(buildAgentProblem("oauth-unavailable")), {
    status: 404,
    headers: { "content-type": "application/problem+json" },
  });

const AUTH_BACKEND_UNAVAILABLE = () =>
  new Response(
    JSON.stringify(
      buildAgentProblem("dispatch-failed", { detail: "Authorization backend unavailable." }),
    ),
    { status: 502, headers: { "content-type": "application/problem+json" } },
  );

function oauthRoute(
  manifest: AgentSurfaceManifest,
  operation: string,
  methods: string[],
  handler: (request: Request, auth: AgentAuthPorts) => Promise<Response> | Response,
): Record<string, APIRoute> {
  const run: APIRoute = async ({ request }) =>
    withCors(
      await withTrafficEmit(manifest, request, "http", async (traffic, ports) => {
        traffic.operation = "other";
        traffic.capability = operation;
        traffic.observedIdentity = extractAgentIdentity(request);
        if (!ports.auth) return OAUTH_UNAVAILABLE();
        try {
          return await handler(request, ports.auth);
        } catch (err) {
          // Registry/Redis outage on the stateful endpoints — retryable problem,
          // never a bare Workers 500 page.
          console.warn(
            `agent-auth: ${operation} backend failure: ${err instanceof Error ? err.message : String(err)}`,
          );
          return AUTH_BACKEND_UNAVAILABLE();
        }
      }),
    );
  const routes: Record<string, APIRoute> = {
    OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  };
  for (const method of methods) routes[method] = run;
  return routes;
}

/** POST /api/agent/oauth/challenge — single-use registration nonce. */
export function createAgentOAuthChallengeRoute(
  manifest: AgentSurfaceManifest,
): Record<string, APIRoute> {
  return oauthRoute(manifest, "oauth.challenge", ["POST"], (_req, auth) => runOAuthChallenge(auth));
}

/** POST /api/agent/oauth/token — client_credentials → EdDSA JWT. */
export function createAgentOAuthTokenRoute(
  manifest: AgentSurfaceManifest,
): Record<string, APIRoute> {
  return oauthRoute(manifest, "oauth.token", ["POST"], (req, auth) => runAgentToken(req, auth));
}

/** GET /api/agent/oauth/jwks.json — passport public key "v1" as JWKS. */
export function createAgentOAuthJwksRoute(
  manifest: AgentSurfaceManifest,
): Record<string, APIRoute> {
  return oauthRoute(manifest, "oauth.jwks", ["GET"], (_req, auth) =>
    runAgentJwks({
      kty: "OKP",
      crv: "Ed25519",
      x: b64uEncode(auth.tokenPublicKey),
      kid: "v1",
      alg: "EdDSA",
      use: "sig",
    } as JsonWebKey),
  );
}

/** POST /api/agent/v1/registration — WBA key-proof registration. */
export function createAgentRegistrationRoute(
  manifest: AgentSurfaceManifest,
): Record<string, APIRoute> {
  return oauthRoute(manifest, "registration.register", ["POST"], (req, auth) =>
    runAgentRegister(req, auth),
  );
}

/** GET /api/agent/v1/registration/whoami — Bearer-required self-report. */
export function createAgentWhoamiRoute(manifest: AgentSurfaceManifest): Record<string, APIRoute> {
  return oauthRoute(manifest, "registration.whoami", ["GET"], (req, auth) => runWhoami(req, auth));
}

/** POST /api/agent/v1/registration/rotate — Bearer-required credential rotation. */
export function createAgentRotateRoute(manifest: AgentSurfaceManifest): Record<string, APIRoute> {
  return oauthRoute(manifest, "registration.rotate", ["POST"], (req, auth) => runRotate(req, auth));
}
