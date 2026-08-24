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
  <item>RFC-0290: initial gate factory.</item>
  <item>RFC-0291: add per-IP rate limiting, identity header passthrough, MCP size cap.</item>
</CHANGE_SUMMARY>
*/

import type { AgentSurfaceManifest } from "@warpgogol/werkstatt-shared/share/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import type { AgentGatePorts } from "./ports.ts";
import type { RateLimiter } from "./limits.ts";
import { handleJsonRpcRequest } from "./mcp/handler.ts";
import {
  isJsonRpcRequest,
  jsonRpcError,
  JSON_RPC_ERROR,
  type JsonRpcResponse,
} from "./mcp/protocol.ts";
import {
  type ActionContext,
  resolveCapability,
  checkPayloadSize,
  checkRateLimit,
  parseJsonBody,
  validateSchema,
  buildAndDispatchEvent,
} from "./action-pipeline.ts";

export type { AgentGatePorts } from "./ports.ts";
export * from "./actions.ts";
export * from "./mcp/protocol.ts";
export * from "./mcp/tools.ts";
export * from "./limits.ts";
export type { McpHandlerContext } from "./mcp/handler.ts";
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

function extractAgentIdentity(request: Request): Record<string, string> {
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
  handleMcp(request: Request): Promise<Response>;
  handleAction(capabilityId: string, request: Request): Promise<Response>;
}

/** Construct the gate for one site from its manifest + active capability records + ports. */
export function createAgentGate(
  manifest: AgentSurfaceManifest,
  catalog: CapabilityRecord[],
  ports: AgentGatePorts,
): AgentGate {
  return {
    async handleMcp(request: Request): Promise<Response> {
      if (request.method !== "POST") {
        return new Response(null, { status: 405, headers: { Allow: "POST" } });
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse(jsonRpcError(null, JSON_RPC_ERROR.PARSE_ERROR, "Invalid JSON."));
      }
      if (Array.isArray(body)) {
        return jsonResponse(
          jsonRpcError(null, JSON_RPC_ERROR.INVALID_REQUEST, "Batch requests are not supported."),
        );
      }
      if (!isJsonRpcRequest(body)) {
        return jsonResponse(
          jsonRpcError(null, JSON_RPC_ERROR.INVALID_REQUEST, "Invalid JSON-RPC 2.0 request."),
        );
      }
      const result: JsonRpcResponse = await handleJsonRpcRequest(body, {
        manifest,
        catalog,
        ports,
        agentIdentity: extractAgentIdentity(request),
        clientIp: extractClientIp(request),
      });
      return jsonResponse(result);
    },

    async handleAction(capabilityId: string, request: Request): Promise<Response> {
      const raw = await request.text();
      const clientIp = extractClientIp(request);
      const agentIdentity = extractAgentIdentity(request);

      const ctx: ActionContext = {
        capabilityId,
        request,
        manifest,
        catalog,
        ports,
        rawBody: raw,
        clientIp,
        agentIdentity,
      };

      const steps: (() => Response | Promise<Response | void> | void)[] = [
        () => resolveCapability(ctx),
        () => checkPayloadSize(ctx),
        () =>
          checkRateLimit(
            ctx,
            limitStore.get(capabilityId, ctx.capability!.limits.perMinutePerIp, ports),
          ),
        () => parseJsonBody(ctx),
        () => validateSchema(ctx),
        () => buildAndDispatchEvent(ctx),
      ];

      for (const step of steps) {
        const result = await step();
        if (result instanceof Response) return result;
      }
      return jsonResponse({ accepted: false, error: "pipeline-incomplete" }, 500);
    },
  };
}
