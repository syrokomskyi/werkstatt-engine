/*
<MODULE_CONTRACT>
<purpose>
RFC-0290: the supported MCP protocol versions and the minimal JSON-RPC 2.0
shapes the gate speaks. Owning this small subset (rather than a full MCP SDK)
bounds the protocol surface to exactly what conformance fixtures pin.
RFC-1113: the gate speaks the 2026-07-28 stateless era only — per-request
version via _meta["io.modelcontextprotocol/protocolVersion"], server/discover,
and UnsupportedProtocolVersionError; the legacy initialize handshake is gone.
</purpose>
<non-goals>
  <item>Do not model batching, notifications, sessions, or any transport beyond
        one request → one response (the stateless Streamable HTTP subset).</item>
  <item>Do not retain legacy-era (≤ 2025-11-25) initialize negotiation —
        forward-only per RFC-1113.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0290: initial protocol constants.</item>
  <item>RFC-1113: replace PINNED_MCP_PROTOCOL_VERSION with SUPPORTED_MCP_PROTOCOL_VERSIONS; add UNSUPPORTED_PROTOCOL_VERSION (-32022) + unsupportedProtocolVersion helper.</item>
  <item>RFC-1113: align agent discovery surface with RFC 9727 and MCP 2026-07-28 stateless era</item>
</CHANGE_SUMMARY>
*/

/**
 * RFC-1113: the MCP protocol versions this gate accepts, newest first.
 * Modern-only (2026-07-28 stateless era) — upgrading is one reviewed change:
 * extend the list, regenerate fixtures from the new spec, fix the handler
 * until they pass (AS-5/AS-7).
 */
export const SUPPORTED_MCP_PROTOCOL_VERSIONS = ["2026-07-28"] as const;

/** The _meta key carrying the per-request protocol version (2026-07-28 spec). */
export const MCP_PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";

/** The HTTP header that MUST carry the same version on Streamable HTTP. */
export const MCP_PROTOCOL_VERSION_HEADER = "MCP-Protocol-Version";

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorBody;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/** Standard JSON-RPC 2.0 codes, plus -32000 (server error range) for dispatch failures. */
export const JSON_RPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR: -32000,
  /** MCP 2026-07-28: the request's protocol version is not supported. */
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const;

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return v.jsonrpc === "2.0" && typeof v.method === "string";
}

export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

export function jsonRpcSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

/**
 * RFC-1113 / MCP 2026-07-28: UnsupportedProtocolVersionError — the spec-defined
 * diagnostic for a request whose declared protocol version is unknown or
 * unsupported. `data.supported` lists the versions the client may retry with.
 * On Streamable HTTP this response is served with status 400.
 */
export function unsupportedProtocolVersion(id: JsonRpcId, requested: unknown): JsonRpcError {
  return jsonRpcError(
    id,
    JSON_RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION,
    "Unsupported protocol version",
    {
      supported: [...SUPPORTED_MCP_PROTOCOL_VERSIONS],
      requested: typeof requested === "string" ? requested : null,
    },
  );
}

/** Read the per-request protocol version from `params._meta` (2026-07-28 spec). */
export function readRequestProtocolVersion(request: JsonRpcRequest): string | undefined {
  const params = request.params;
  if (typeof params !== "object" || params === null) return undefined;
  const meta = (params as Record<string, unknown>)._meta;
  if (typeof meta !== "object" || meta === null) return undefined;
  const version = (meta as Record<string, unknown>)[MCP_PROTOCOL_VERSION_META_KEY];
  return typeof version === "string" ? version : undefined;
}
