/*
<MODULE_CONTRACT>
<purpose>
RFC-0290: the JSON-RPC method router for the stateless MCP subset. Handles
exactly: initialize, ping, tools/list, tools/call, resources/list,
resources/read. Everything else is method-not-found (batching is rejected
one level up, at the transport boundary in index.ts).
</purpose>
<non-goals>
  <item>Do not implement prompts/sampling/logging/notifications — out of the pinned subset.</item>
  <item>Do not enforce auth — only rate limits and size caps (RFC-0291).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0290: initial MCP method handler.</item>
  <item>RFC-0291: add rate limiting, size cap, identity passthrough, freshness _meta.</item>
</CHANGE_SUMMARY>
*/

import type { AgentSurfaceManifest } from "@warpgogol/werkstatt-shared/share/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import type { AgentGatePorts } from "../ports.ts";
import type { RateLimiter } from "../limits.ts";
import { validateAgainstCapabilitySchema, buildIntegrationEventFromAction } from "../actions.ts";
import { buildToolsList } from "./tools.ts";
import {
  PINNED_MCP_PROTOCOL_VERSION,
  JSON_RPC_ERROR,
  jsonRpcError,
  jsonRpcSuccess,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol.ts";

export interface McpHandlerContext {
  manifest: AgentSurfaceManifest;
  catalog: CapabilityRecord[];
  ports: AgentGatePorts;
  /** RFC-0291: identity headers extracted from the HTTP request (observe-only). */
  agentIdentity?: Record<string, string>;
  /** RFC-0291: client IP for rate-limit keying. */
  clientIp?: string;
}

// RFC-0291: module-level limiter cache for the MCP path (mirrors index.ts).
const mcpLimiterCache = new Map<string, RateLimiter>();

function getMcpLimiter(
  capabilityId: string,
  maxPerWindow: number,
  factory: (max: number) => RateLimiter,
): RateLimiter {
  const cacheKey = `${capabilityId}:${maxPerWindow}`;
  let limiter = mcpLimiterCache.get(cacheKey);
  if (!limiter) {
    limiter = factory(maxPerWindow);
    mcpLimiterCache.set(cacheKey, limiter);
  }
  return limiter;
}

/** Reset the MCP limiter cache — test-only. */
export function __resetMcpLimiterCache(): void {
  mcpLimiterCache.clear();
}

function absoluteUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

async function handleToolsCall(
  req: JsonRpcRequest,
  ctx: McpHandlerContext,
): Promise<JsonRpcResponse> {
  const params = (req.params ?? {}) as { name?: unknown; arguments?: unknown };
  const name = typeof params.name === "string" ? params.name : "";

  const knowledgeMatch = /^knowledge\.(.+)\.get$/.exec(name);
  if (knowledgeMatch) {
    const domain = knowledgeMatch[1];
    const ref = ctx.manifest.knowledge.find((k) => k.domain === domain);
    if (!ref) {
      return jsonRpcError(req.id ?? null, JSON_RPC_ERROR.INVALID_PARAMS, `Unknown tool "${name}".`);
    }
    const text = await ctx.ports.knowledge.read(ref.url);
    if (text === null) {
      return jsonRpcError(
        req.id ?? null,
        JSON_RPC_ERROR.SERVER_ERROR,
        `Could not read "${ref.url}".`,
      );
    }
    // RFC-0291: append freshness into MCP _meta where envelopes carry it.
    let _meta: Record<string, unknown> | undefined;
    try {
      const envelope = JSON.parse(text) as { freshness?: unknown };
      if (envelope.freshness) {
        _meta = { "gogol.dev/freshness": envelope.freshness };
      }
    } catch {
      // malformed JSON — the text is passed through as-is; freshness is absent.
    }
    return jsonRpcSuccess(req.id ?? null, {
      content: [{ type: "text", text }],
      ...(_meta ? { _meta } : {}),
    });
  }

  const actionMatch = /^action\.(.+)$/.exec(name);
  if (actionMatch) {
    const capabilityId = actionMatch[1];
    const capability = ctx.catalog.find((c) => c.id === capabilityId);
    const ref = ctx.manifest.actions.find((a) => a.id === capabilityId);
    if (!capability || !ref) {
      return jsonRpcError(req.id ?? null, JSON_RPC_ERROR.INVALID_PARAMS, `Unknown tool "${name}".`);
    }

    // RFC-0291: payload size cap on MCP action arguments.
    const argsBytes = new TextEncoder().encode(JSON.stringify(params.arguments ?? {})).length;
    if (argsBytes > capability.limits.maxPayloadBytes) {
      return jsonRpcError(req.id ?? null, JSON_RPC_ERROR.SERVER_ERROR, "Payload too large.", {
        retryable: false,
      });
    }

    // RFC-0291: per-IP rate limit (fail-open if no limiter).
    if (ctx.ports.createRateLimiter) {
      const limiter = getMcpLimiter(
        capabilityId,
        capability.limits.perMinutePerIp,
        ctx.ports.createRateLimiter,
      );
      const clientIp = ctx.clientIp ?? "unknown";
      const result = limiter.check(`${capabilityId}:${clientIp}`);
      if (!result.allowed) {
        return jsonRpcError(req.id ?? null, JSON_RPC_ERROR.SERVER_ERROR, "Rate limited.", {
          retryable: true,
          retryAfterSeconds: result.retryAfterSeconds,
        });
      }
    }

    const validated = validateAgainstCapabilitySchema(capability.input, params.arguments ?? {});
    if (!validated.ok) {
      return jsonRpcError(req.id ?? null, JSON_RPC_ERROR.INVALID_PARAMS, "Invalid arguments.", {
        errors: validated.errors,
      });
    }
    const locale =
      typeof (params.arguments as Record<string, unknown> | undefined)?.locale === "string" &&
      ctx.manifest.languages.supported.includes((params.arguments as Record<string, string>).locale)
        ? (params.arguments as Record<string, string>).locale
        : ctx.manifest.languages.default;
    const event = buildIntegrationEventFromAction(
      capability,
      validated.value,
      locale,
      ctx.ports.now(),
    );
    if (ctx.agentIdentity && Object.keys(ctx.agentIdentity).length > 0) {
      event.payload._agentIdentity = ctx.agentIdentity;
    }
    try {
      const outcome = await ctx.ports.dispatch.send(event);
      return jsonRpcSuccess(req.id ?? null, {
        content: [{ type: "text", text: JSON.stringify(outcome) }],
      });
    } catch (err) {
      return jsonRpcError(req.id ?? null, JSON_RPC_ERROR.SERVER_ERROR, "Dispatch failed.", {
        retryable: true,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return jsonRpcError(req.id ?? null, JSON_RPC_ERROR.INVALID_PARAMS, `Unknown tool "${name}".`);
}

async function handleResourcesRead(
  req: JsonRpcRequest,
  ctx: McpHandlerContext,
): Promise<JsonRpcResponse> {
  const params = (req.params ?? {}) as { uri?: unknown };
  const uri = typeof params.uri === "string" ? params.uri : "";
  const ref = ctx.manifest.knowledge.find((k) => absoluteUrl(ctx.manifest.baseUrl, k.url) === uri);
  if (!ref) {
    return jsonRpcError(
      req.id ?? null,
      JSON_RPC_ERROR.INVALID_PARAMS,
      `Unknown resource "${uri}".`,
    );
  }
  const text = await ctx.ports.knowledge.read(ref.url);
  if (text === null) {
    return jsonRpcError(
      req.id ?? null,
      JSON_RPC_ERROR.SERVER_ERROR,
      `Could not read "${ref.url}".`,
    );
  }
  // RFC-0291: append freshness into MCP _meta where envelopes carry it.
  let _meta: Record<string, unknown> | undefined;
  try {
    const envelope = JSON.parse(text) as { freshness?: unknown };
    if (envelope.freshness) {
      _meta = { "gogol.dev/freshness": envelope.freshness };
    }
  } catch {
    // malformed JSON — freshness is absent.
  }
  return jsonRpcSuccess(req.id ?? null, {
    contents: [{ uri, mimeType: "application/json", text }],
    ...(_meta ? { _meta } : {}),
  });
}

/** Route one JSON-RPC request to its handler. The transport boundary (index.ts) owns batching/HTTP-method rejection. */
export async function handleJsonRpcRequest(
  req: JsonRpcRequest,
  ctx: McpHandlerContext,
): Promise<JsonRpcResponse> {
  const id = req.id ?? null;
  switch (req.method) {
    case "initialize":
      return jsonRpcSuccess(id, {
        protocolVersion: PINNED_MCP_PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: {
          name: `${ctx.manifest.site} agent surface`,
          version: ctx.manifest.surfaceVersion,
        },
      });
    case "ping":
      return jsonRpcSuccess(id, {});
    case "tools/list":
      return jsonRpcSuccess(id, { tools: buildToolsList(ctx.manifest, ctx.catalog) });
    case "tools/call":
      return handleToolsCall(req, ctx);
    case "resources/list":
      return jsonRpcSuccess(id, {
        resources: ctx.manifest.knowledge.map((ref) => ({
          uri: absoluteUrl(ctx.manifest.baseUrl, ref.url),
          name: ref.domain,
          mimeType: "application/json",
        })),
      });
    case "resources/read":
      return handleResourcesRead(req, ctx);
    default:
      return jsonRpcError(id, JSON_RPC_ERROR.METHOD_NOT_FOUND, `Method "${req.method}" not found.`);
  }
}
