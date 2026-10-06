/*
<MODULE_CONTRACT>
<purpose>
RFC-0290: the Agent Gate — a framework-agnostic runtime that turns a site's
Agent Surface Manifest + active capability records into (a) a stateless MCP
endpoint and (b) direct HTTP action handlers. Instantiated with data (the
manifest), never with per-site code (AS-1). astro.ts is the only
astro-aware caller.
</purpose>
<non-goals>
  <item>Do not read files, secrets, or the network directly — ports do that.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1114: minimal real A2A endpoint + honest agent card</item>
  <item>RFC-1114: review findings — schema-violation for malformed message, drop unreachable fallback</item>
  <item>RFC-1172: closed agent.traffic telemetry — ports.telemetry sink, TrafficRecorder + boundary emit via withTrafficEmit</item>
  <item>RFC-1172: fo-review — extractAgentIdentity on all routes, honest mcpProtocolVersion, top-level import, test header</item>
  <item>RFC-1187: phases 1-3 — contracts, Redis registry, AS core + Bearer pipeline</item>
  <history>RFC-0290, RFC-0291, RFC-1112, RFC-1113, RFC-1114</history>
</CHANGE_SUMMARY>
*/

import type { AgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import type { AgentGatePorts } from "./ports.ts";
import type { RateLimiter } from "./limits.ts";
import { handleJsonRpcRequest } from "./mcp/handler.ts";
import { handleA2aRequest } from "./a2a/handler.ts";
import {
  A2A_METHOD_SEND_MESSAGE,
  A2A_VERSION_HEADER,
  a2aVersionNotSupported,
  isSupportedA2aVersionHeader,
} from "./a2a/protocol.ts";
import {
  isJsonRpcRequest,
  jsonRpcError,
  readRequestProtocolVersion,
  JSON_RPC_ERROR,
  MCP_PROTOCOL_VERSION_HEADER,
  type JsonRpcResponse,
} from "./mcp/protocol.ts";
import type { TrafficRecorder } from "./telemetry.ts";
import { extractHttpPresentation } from "./presentation.ts";
import {
  type ActionContext,
  resolveCapability,
  checkPayloadSize,
  checkIdempotency,
  checkRateLimit,
  rateLimitMax,
  resolveAgentAuth,
  parseJsonBody,
  validateSchema,
  dispatchOrPreview,
  deprecationHeaders,
  extractIdempotencyKey,
  httpBodyHash,
  problemResponse,
} from "./action-pipeline.ts";
import { buildAgentProblem } from "@warpgogol/werkstatt-shared/agent";
import { resolveBearerAgent } from "./agent-auth.ts";

export type { AgentGatePorts } from "./ports.ts";
export * from "./agent-auth.ts";
export * from "./actions.ts";
export * from "./mcp/protocol.ts";
export * from "./mcp/tools.ts";
export * from "./limits.ts";
export type { McpHandlerContext } from "./mcp/handler.ts";
export type { A2aHandlerContext } from "./a2a/handler.ts";
export * from "./a2a/protocol.ts";
export type { ActionContext, StepResult } from "./action-pipeline.ts";

/**
 * RFC-0291: in-isolate limiter store. Keyed by `${capabilityId}:${maxPerWindow}`
 * so different capabilities get separate limiters. Extracted from the monolithic
 * handler to enable testing and future swap-out (e.g. Durable Objects).
 */
class LimitStore {
  private cache = new Map<string, RateLimiter>();

  get(capabilityId: string, maxPerWindow: number, ports: AgentGatePorts): RateLimiter | null {
    if (!ports.createRateLimiter) return null;
    const cacheKey = `${capabilityId}:${maxPerWindow}`;
    let limiter = this.cache.get(cacheKey);
    if (!limiter) {
      limiter = ports.createRateLimiter(maxPerWindow);
      this.cache.set(cacheKey, limiter);
    }
    return limiter;
  }

  clear(): void {
    this.cache.clear();
  }
}

const limitStore = new LimitStore();

/** Reset the limiter cache — test-only. */
export function __resetLimiterCache(): void {
  limitStore.clear();
}

function extractClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

const IDENTITY_HEADERS = ["Signature-Agent", "Signature", "User-Agent"] as const;
const IDENTITY_MAX_BYTES = 1024;

/** RFC-0291/1172: observed identity headers (bounded) — exported for adapter routes. */
export function extractAgentIdentity(request: Request): Record<string, string> {
  const identity: Record<string, string> = {};
  let totalBytes = 0;
  for (const header of IDENTITY_HEADERS) {
    const value = request.headers.get(header);
    if (!value) continue;
    const remaining = IDENTITY_MAX_BYTES - totalBytes;
    if (remaining <= 0) break;
    const truncated = value.slice(0, remaining);
    identity[header] = truncated;
    totalBytes += new TextEncoder().encode(truncated).length;
  }
  return identity;
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

export interface AgentGate {
  handleMcp(request: Request, traffic?: TrafficRecorder): Promise<Response>;
  handleAction(
    capabilityId: string,
    request: Request,
    traffic?: TrafficRecorder,
  ): Promise<Response>;
  handleA2a(request: Request, traffic?: TrafficRecorder): Promise<Response>;
}

/** Construct the gate for one site from its manifest + active capability records + ports. */
export function createAgentGate(
  manifest: AgentSurfaceManifest,
  catalog: CapabilityRecord[],
  ports: AgentGatePorts,
): AgentGate {
  return {
    async handleMcp(request: Request, traffic?: TrafficRecorder): Promise<Response> {
      if (request.method !== "POST") {
        if (traffic) traffic.operation = "other";
        return new Response(null, { status: 405, headers: { Allow: "POST" } });
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        if (traffic) {
          traffic.operation = "other";
          traffic.statusOverride = "rejected";
        }
        return jsonResponse(jsonRpcError(null, JSON_RPC_ERROR.PARSE_ERROR, "Invalid JSON."));
      }
      if (Array.isArray(body)) {
        if (traffic) {
          traffic.operation = "other";
          traffic.statusOverride = "rejected";
        }
        return jsonResponse(
          jsonRpcError(null, JSON_RPC_ERROR.INVALID_REQUEST, "Batch requests are not supported."),
        );
      }
      if (!isJsonRpcRequest(body)) {
        if (traffic) {
          traffic.operation = "other";
          traffic.statusOverride = "rejected";
        }
        return jsonResponse(
          jsonRpcError(null, JSON_RPC_ERROR.INVALID_REQUEST, "Invalid JSON-RPC 2.0 request."),
        );
      }
      // RFC-1172: request-shaped fields — method picks the operation, capability
      // carries the raw method (tool name for tools/call).
      if (traffic) {
        traffic.observedIdentity = extractAgentIdentity(request);
        // RFC-1172: the declared version — equal to negotiated on success (the
        // gate enforces header==meta), absent on initialize/no-version paths
        // where nothing was negotiated.
        traffic.mcpProtocolVersion =
          readRequestProtocolVersion(body) ??
          request.headers.get(MCP_PROTOCOL_VERSION_HEADER) ??
          undefined;
        const method = body.method;
        const toolName =
          method === "tools/call" && typeof body.params === "object" && body.params !== null
            ? (body.params as { name?: unknown }).name
            : undefined;
        traffic.operation = method === "tools/list" || method === "tools/call" ? method : "other";
        traffic.capability =
          method === "tools/call" && typeof toolName === "string" ? toolName : method;
      }
      // RFC-1113 / MCP 2026-07-28: on Streamable HTTP the MCP-Protocol-Version
      // header MUST match _meta["io.modelcontextprotocol/protocolVersion"];
      // a mismatch is a 400 Bad Request.
      const headerVersion = request.headers.get(MCP_PROTOCOL_VERSION_HEADER);
      const metaVersion = readRequestProtocolVersion(body);
      if (headerVersion !== null && metaVersion !== undefined && headerVersion !== metaVersion) {
        if (traffic) traffic.statusOverride = "failure";
        return jsonResponse(
          jsonRpcError(
            body.id ?? null,
            JSON_RPC_ERROR.INVALID_REQUEST,
            `${MCP_PROTOCOL_VERSION_HEADER} header does not match the _meta protocol version.`,
          ),
          400,
        );
      }
      // RFC-1187: a verified Bearer upgrades tools/call to the registered tier
      // — the same contract as the HTTP action route (degrades to anonymous).
      const verifiedAgent = ports.auth ? await resolveBearerAgent(request, ports.auth) : null;
      const agentIdentity = extractAgentIdentity(request);
      if (verifiedAgent) agentIdentity.verifiedAgentId = verifiedAgent.agentId;
      if (traffic?.observedIdentity === undefined) {
        if (traffic) traffic.observedIdentity = agentIdentity;
      }
      const result: JsonRpcResponse = await handleJsonRpcRequest(body, {
        manifest,
        catalog,
        ports,
        agentIdentity,
        clientIp: extractClientIp(request),
        ...(verifiedAgent ? { verifiedAgent } : {}),
      });
      // RFC-1172: JSON-RPC errors ride HTTP 200 — the status code cannot
      // express them, so record the semantic outcome + problem token.
      if (traffic && "error" in result) {
        traffic.statusOverride =
          result.error.code === JSON_RPC_ERROR.METHOD_NOT_FOUND ? "rejected" : "failure";
        traffic.problemKind = `json-rpc:${result.error.code}`;
      }
      // RFC-1113: the 2026-07-28 schema requires UnsupportedProtocolVersionError
      // to be served with HTTP 400 on the HTTP transport.
      const status =
        "error" in result && result.error.code === JSON_RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION
          ? 400
          : 200;
      return jsonResponse(result, status);
    },

    async handleAction(
      capabilityId: string,
      request: Request,
      traffic?: TrafficRecorder,
    ): Promise<Response> {
      const raw = await request.text();
      const clientIp = extractClientIp(request);
      const agentIdentity = extractAgentIdentity(request);
      if (traffic) {
        traffic.operation = "action.call";
        traffic.capability = capabilityId;
        traffic.observedIdentity = agentIdentity;
      }
      // RFC-1112: the idempotency key + body hash are extracted before the
      // pipeline so the replay check can run ahead of rate limiting.
      const idempotencyKey = extractIdempotencyKey(request);
      const bodyHash = idempotencyKey ? httpBodyHash(raw) : undefined;

      const ctx: ActionContext = {
        capabilityId,
        request,
        manifest,
        catalog,
        ports,
        rawBody: raw,
        clientIp,
        agentIdentity,
        idempotencyKey,
        bodyHash,
        // RFC-1213: verifiable presentation rides the dedicated header — the
        // body schema stays closed per capability.
        presentation: extractHttpPresentation(request),
        ...(traffic ? { traffic } : {}),
      };

      const steps: (() => Response | Promise<Response | void> | void)[] = [
        () => resolveCapability(ctx),
        () => checkPayloadSize(ctx),
        () => checkIdempotency(ctx),
        // RFC-1187: Bearer resolution precedes the limiter — a verified agent
        // selects the elevated per-agent bucket (rateLimitMax/Key read ctx).
        () => resolveAgentAuth(ctx),
        () =>
          checkRateLimit(
            ctx,
            limitStore.get(`${capabilityId}:${rateLimitMax(ctx)}`, rateLimitMax(ctx), ports),
          ),
        () => parseJsonBody(ctx),
        () => validateSchema(ctx),
        () => dispatchOrPreview(ctx),
      ];

      let response: Response | undefined;
      for (const step of steps) {
        const result = await step();
        if (result instanceof Response) {
          response = result;
          break;
        }
      }
      // Unreachable in practice — dispatchOrPreview always returns a Response.
      response ??= problemResponse(
        buildAgentProblem("dispatch-failed", { detail: "Pipeline completed without a result." }),
      );
      // RFC-1112: mark responses when no receipt store is configured.
      if (!ports.idempotency) response.headers.set("X-Agent-Idempotency", "disabled");
      // RFC-1171: deprecated alias paths answer with RFC 9745/8594 headers;
      // canonical paths stay clean.
      const depHeaders = deprecationHeaders(manifest, capabilityId, new URL(request.url).pathname);
      if (depHeaders) {
        for (const [name, value] of Object.entries(depHeaders)) {
          response.headers.set(name, value);
        }
      }
      return response;
    },

    async handleA2a(request: Request, traffic?: TrafficRecorder): Promise<Response> {
      if (request.method !== "POST") {
        if (traffic) traffic.operation = "other";
        return new Response(null, { status: 405, headers: { Allow: "POST" } });
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        if (traffic) {
          traffic.operation = "other";
          traffic.statusOverride = "rejected";
        }
        return jsonResponse(jsonRpcError(null, JSON_RPC_ERROR.PARSE_ERROR, "Invalid JSON."));
      }
      if (Array.isArray(body)) {
        if (traffic) {
          traffic.operation = "other";
          traffic.statusOverride = "rejected";
        }
        return jsonResponse(
          jsonRpcError(null, JSON_RPC_ERROR.INVALID_REQUEST, "Batch requests are not supported."),
        );
      }
      if (!isJsonRpcRequest(body)) {
        if (traffic) {
          traffic.operation = "other";
          traffic.statusOverride = "rejected";
        }
        return jsonResponse(
          jsonRpcError(null, JSON_RPC_ERROR.INVALID_REQUEST, "Invalid JSON-RPC 2.0 request."),
        );
      }
      // RFC-1172: SendMessage dispatches an action; anything else is `other`
      // with the raw method in capability.
      if (traffic) {
        traffic.observedIdentity = extractAgentIdentity(request);
        traffic.operation = body.method === A2A_METHOD_SEND_MESSAGE ? "action.call" : "other";
        traffic.capability = body.method;
      }
      // RFC-1114: A2A-Version header gate — a present header must match 1.x;
      // absent is served as 1.0 (documented deviation: no 0.3 semantics exist).
      const a2aVersion = request.headers.get(A2A_VERSION_HEADER);
      if (!isSupportedA2aVersionHeader(a2aVersion)) {
        // Non-null here: isSupportedA2aVersionHeader only rejects a present header.
        return jsonResponse(a2aVersionNotSupported(body.id ?? null, a2aVersion!), 400);
      }
      // RFC-1187: Bearer upgrades SendMessage to the registered tier — same
      // contract as the HTTP action route and MCP tools/call.
      const verifiedAgent = ports.auth ? await resolveBearerAgent(request, ports.auth) : null;
      const agentIdentity = extractAgentIdentity(request);
      if (verifiedAgent) agentIdentity.verifiedAgentId = verifiedAgent.agentId;
      if (traffic) traffic.observedIdentity = agentIdentity;
      const result: JsonRpcResponse = await handleA2aRequest(body, {
        manifest,
        catalog,
        ports,
        agentIdentity,
        clientIp: extractClientIp(request),
        idempotencyKey: extractIdempotencyKey(request),
        presentation: extractHttpPresentation(request),
        ...(verifiedAgent ? { verifiedAgent } : {}),
      });
      // RFC-1172: JSON-RPC errors ride HTTP 200 — record the semantic outcome.
      if (traffic && "error" in result) {
        traffic.statusOverride =
          result.error.code === JSON_RPC_ERROR.METHOD_NOT_FOUND ? "rejected" : "failure";
        traffic.problemKind = `json-rpc:${result.error.code}`;
      }
      const response = jsonResponse(result);
      // RFC-1112: mark responses when no receipt store is configured.
      if (!ports.idempotency) response.headers.set("X-Agent-Idempotency", "disabled");
      return response;
    },
  };
}

export { createAgentReflectRoute } from "./reflect-route.ts";
export type { CreateAgentReflectRouteOptions } from "./reflect-route.ts";
