/*
<MODULE_CONTRACT>
<purpose>
RFC-0290: the pinned MCP protocol constant and the minimal JSON-RPC 2.0 shapes
the gate speaks. Owning this small subset (rather than a full MCP SDK)
bounds the protocol surface to exactly what conformance fixtures pin.
</purpose>
<non-goals>
  <item>Do not model batching, notifications, or any transport beyond one
        request → one response (the stateless Streamable HTTP subset).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0290: initial protocol constants.</item>
</CHANGE_SUMMARY>
*/

/** Upgrading this is one reviewed change: bump, regenerate fixtures from the new spec, fix the handler until they pass (AS-5/AS-7). */
export const PINNED_MCP_PROTOCOL_VERSION = "2025-06-18";

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
