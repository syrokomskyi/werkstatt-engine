/*
<MODULE_CONTRACT>
<purpose>
RFC-0290: the JSON-RPC method router for the stateless MCP subset. Handles
exactly: server/discover, ping, tools/list, tools/call, resources/list,
resources/read. Everything else is method-not-found (batching is rejected
one level up, at the transport boundary in index.ts).
RFC-1113: the 2026-07-28 stateless era — every request except server/discover
must declare _meta["io.modelcontextprotocol/protocolVersion"] from
SUPPORTED_MCP_PROTOCOL_VERSIONS; the legacy initialize handshake returns
UnsupportedProtocolVersionError naming the supported list.
</purpose>
<non-goals>
  <item>Do not implement prompts/sampling/logging/notifications — out of the pinned subset.</item>
  <item>Do not enforce auth — only rate limits and size caps (RFC-0291).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0290: initial MCP method handler.</item>
  <item>RFC-0291: add rate limiting, size cap, identity passthrough, freshness _meta.</item>
  <item>RFC-1112: idempotency via params._meta, shared executeAction core, problem-details in error.data.</item>
  <item>RFC-1113: server/discover + per-request protocol-version gate; initialize → UnsupportedProtocolVersionError.</item>
  <item>RFC-1113: align agent discovery surface with RFC 9727 and MCP 2026-07-28 stateless era</item>
</CHANGE_SUMMARY>
*/

import type { AgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import type { AgentGatePorts } from "../ports.ts";
import type { RateLimiter } from "../limits.ts";
import { validateAgainstCapabilitySchema } from "../actions.ts";
import {
  checkIdempotencyReplay,
  executeAction,
  mcpBodyHash,
  MCP_IDEMPOTENCY_META_KEY,
} from "../action-pipeline.ts";
import { buildAgentProblem, type AgentProblemDetails } from "@warpgogol/werkstatt-shared/agent";
import { buildToolsList } from "./tools.ts";
import {
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  JSON_RPC_ERROR,
  jsonRpcError,
  jsonRpcSuccess,
  readRequestProtocolVersion,
  unsupportedProtocolVersion,
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
      const problem = buildAgentProblem("payload-too-large", {
        detail: `Arguments are ${argsBytes} bytes; the limit is ${capability.limits.maxPayloadBytes}.`,
      });
      return jsonRpcError(req.id ?? null, JSON_RPC_ERROR.SERVER_ERROR, problem.title, problem);
    }

    // RFC-1112: idempotency key travels in params._meta (MCP has no headers);
    // the body hash is the canonical JSON hash of the arguments.
    const meta = (params as { _meta?: Record<string, unknown> })._meta;
    const idempotencyKey =
      typeof meta?.[MCP_IDEMPOTENCY_META_KEY] === "string"
        ? (meta[MCP_IDEMPOTENCY_META_KEY] as string)
        : undefined;
    const bodyHash = idempotencyKey ? mcpBodyHash(params.arguments) : undefined;

    // RFC-1112: replay check runs before rate limiting — a replay must not
    // consume budget.
    const replay = await checkIdempotencyReplay({
      ports: ctx.ports,
      capability,
      idempotencyKey,
      bodyHash,
    });
    if (replay !== null) {
      if ("receiptId" in replay) {
        return jsonRpcSuccess(req.id ?? null, {
          content: [{ type: "text", text: JSON.stringify(replay) }],
        });
      }
      const problem = replay as AgentProblemDetails;
      return jsonRpcError(req.id ?? null, JSON_RPC_ERROR.SERVER_ERROR, problem.title, problem);
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
        const problem = buildAgentProblem("rate-limited", {
          retryAfterSeconds: result.retryAfterSeconds,
        });
        return jsonRpcError(req.id ?? null, JSON_RPC_ERROR.SERVER_ERROR, problem.title, problem);
      }
    }

    const validated = validateAgainstCapabilitySchema(capability.input, params.arguments ?? {});
    if (!validated.ok) {
      const problem = buildAgentProblem("schema-violation", {
        schemaRef: `/.well-known/agent.openapi.json#/components/schemas/${capabilityId}-input`,
        errors: validated.errors,
      });
      return jsonRpcError(req.id ?? null, JSON_RPC_ERROR.INVALID_PARAMS, problem.title, problem);
    }

    // RFC-1112: shared execution core — preview for sideEffect "none",
    // dispatch + receipt otherwise.
    const result = await executeAction({
      capability,
      manifest: ctx.manifest,
      ports: ctx.ports,
      validatedValue: validated.value,
      agentIdentity: ctx.agentIdentity ?? {},
      idempotencyKey,
      bodyHash,
    });
    switch (result.kind) {
      case "receipt":
        return jsonRpcSuccess(req.id ?? null, {
          content: [{ type: "text", text: JSON.stringify(result.receipt) }],
        });
      case "preview":
        return jsonRpcSuccess(req.id ?? null, {
          content: [
            { type: "text", text: JSON.stringify({ valid: true, draftId: result.draftId }) },
          ],
        });
      case "problem":
        return jsonRpcError(
          req.id ?? null,
          JSON_RPC_ERROR.SERVER_ERROR,
          result.problem.title,
          result.problem,
        );
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

/** Route one JSON-RPC request to its handler. The transport boundary (index.ts) owns batching/HTTP-method rejection and the MCP-Protocol-Version header consistency check. */
export async function handleJsonRpcRequest(
  req: JsonRpcRequest,
  ctx: McpHandlerContext,
): Promise<JsonRpcResponse> {
  const id = req.id ?? null;

  // RFC-1113: server/discover is the version-negotiation recovery path — it
  // answers unconditionally so a client holding an unsupported version can
  // still learn SUPPORTED_MCP_PROTOCOL_VERSIONS (spec: servers MUST implement it).
  if (req.method === "server/discover") {
    return jsonRpcSuccess(id, {
      resultType: "complete",
      supportedVersions: [...SUPPORTED_MCP_PROTOCOL_VERSIONS],
      capabilities: { tools: {}, resources: {} },
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: `${ctx.manifest.site} agent surface`,
          version: ctx.manifest.surfaceVersion,
        },
      },
    });
  }

  // RFC-1113: initialize is the legacy-era handshake — a modern-only server
  // answers with the spec-defined error naming the supported versions.
  if (req.method === "initialize") {
    const params = (req.params ?? {}) as { protocolVersion?: unknown };
    return unsupportedProtocolVersion(
      id,
      params.protocolVersion ?? readRequestProtocolVersion(req),
    );
  }

  // RFC-1113: per-request version gate — every other method must declare a
  // supported version in params._meta["io.modelcontextprotocol/protocolVersion"].
  // Absent or unsupported → UnsupportedProtocolVersionError (HTTP 400 upstream).
  const requestedVersion = readRequestProtocolVersion(req);
  if (
    requestedVersion === undefined ||
    !(SUPPORTED_MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requestedVersion)
  ) {
    return unsupportedProtocolVersion(id, requestedVersion);
  }

  switch (req.method) {
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
