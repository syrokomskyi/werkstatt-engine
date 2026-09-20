/*
<MODULE_CONTRACT>
<purpose>
RFC-1114: the bounded A2A v1.0 subset the gate speaks — one JSON-RPC method
(SendMessage), the message/task shapes, and the protocol-version pin. Owning
this small subset (rather than a full A2A SDK) bounds the protocol surface to
exactly what conformance fixtures pin — the same pattern as the MCP subset
(RFC-0290).
</purpose>
<non-goals>
  <item>Do not model GetTask, CancelTask, streaming (SSE), push notifications,
        or task persistence — the server is synchronous; a SendMessage resolves
        to a terminal-state Task in one round-trip.</item>
  <item>Do not retain A2A 0.x semantics — the card pins protocolVersion 1.0;
        older clients get VersionNotSupportedError.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1114: initial A2A protocol subset — SendMessage, message/task shapes, version pin + header gate.</item>
  <item>RFC-1114: minimal real A2A endpoint + honest agent card</item>
</CHANGE_SUMMARY>
*/

import {
  JSON_RPC_ERROR,
  jsonRpcError,
  type JsonRpcError,
  type JsonRpcId,
} from "../mcp/protocol.ts";

/** RFC-1114: the only A2A protocol version this gate serves. */
export const PINNED_A2A_PROTOCOL_VERSION = "1.0";

/** The HTTP header carrying the client's A2A protocol version (A2A v1.0 spec). */
export const A2A_VERSION_HEADER = "A2A-Version";

/** The single JSON-RPC method of the pinned subset (A2A v1.0 name — `message/send` is the 0.3 name). */
export const A2A_METHOD_SEND_MESSAGE = "SendMessage";

/** A2A v1.0 error code for a request whose declared protocol version is unsupported. */
export const A2A_ERROR_VERSION_NOT_SUPPORTED = -32008;

/**
 * RFC-1114: the A2A-Version header gate. A present header must match `1.x`;
 * an absent header is served as 1.0 (a 1.0-only server has no 0.3 semantics
 * to apply — documented deviation from the spec's "empty means 0.3" default).
 */
export function isSupportedA2aVersionHeader(headerValue: string | null): boolean {
  if (headerValue === null) return true;
  const trimmed = headerValue.trim();
  return trimmed === "1" || trimmed.startsWith("1.");
}

/** A2A v1.0 VersionNotSupportedError — names the version this server speaks. */
export function a2aVersionNotSupported(id: JsonRpcId, requested: string): JsonRpcError {
  return jsonRpcError(id, A2A_ERROR_VERSION_NOT_SUPPORTED, "A2A protocol version not supported", {
    supported: [PINNED_A2A_PROTOCOL_VERSION],
    requested,
  });
}

// ---------------------------------------------------------------------------
// Message + task shapes (A2A v1.0)
// ---------------------------------------------------------------------------

export interface A2ATextPart {
  kind: "text";
  text: string;
}

export interface A2ADataPart {
  kind: "data";
  data: Record<string, unknown>;
}

export type A2APart = A2ATextPart | A2ADataPart;

export interface A2AMessage {
  /** Required in v1.0 — a missing messageId is -32602. */
  messageId: string;
  role: "user";
  /** Echoed back on the task when provided; no multi-turn state is kept. */
  contextId?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
}

export type A2ATaskState = "completed" | "failed" | "rejected";

export interface A2ATaskStatus {
  state: A2ATaskState;
  /** ISO 8601 — stamped from ports.now(). */
  timestamp: string;
}

export interface A2AArtifact {
  name: string;
  parts: { kind: "data"; data: unknown }[];
}

export interface A2ATask {
  /** Derived from ActionReceipt.receiptId — correlatable with receipts. */
  id: string;
  contextId?: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
}

/**
 * Skill routing convention: a DataPart `{ "capability": "<id>", "input": {...} }`
 * selects the action. A message with no capability DataPart is rejected with
 * -32602 — free-text search is already served by interfaces.search; the A2A
 * surface stays honest about what it can execute.
 */
export interface A2ACapabilityInvocation {
  capabilityId: string;
  input: Record<string, unknown>;
}

/** Extract the capability invocation from message parts, or null when absent/malformed. */
export function readCapabilityInvocation(message: A2AMessage): A2ACapabilityInvocation | null {
  for (const part of message.parts) {
    if (part.kind !== "data") continue;
    const capability = part.data["capability"];
    if (typeof capability !== "string" || capability.length === 0) continue;
    const input = part.data["input"];
    return {
      capabilityId: capability,
      input:
        typeof input === "object" && input !== null && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {},
    };
  }
  return null;
}

/** Minimal structural check for the SendMessage `message` param. */
export function isA2aMessage(value: unknown): value is A2AMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.messageId !== "string" || v.messageId.length === 0) return false;
  if (v.role !== "user") return false;
  if (!Array.isArray(v.parts)) return false;
  return v.parts.every((part) => {
    if (typeof part !== "object" || part === null) return false;
    const p = part as Record<string, unknown>;
    if (p.kind === "text") return typeof p.text === "string";
    if (p.kind === "data") return typeof p.data === "object" && p.data !== null;
    return false;
  });
}

/** Build a terminal-state task. `id` is the receiptId on dispatch, a fresh UUID otherwise. */
export function buildA2aTask(input: {
  id: string;
  contextId?: string;
  state: A2ATaskState;
  timestamp: string;
  artifacts?: A2AArtifact[];
}): A2ATask {
  return {
    id: input.id,
    ...(input.contextId !== undefined ? { contextId: input.contextId } : {}),
    status: { state: input.state, timestamp: input.timestamp },
    ...(input.artifacts && input.artifacts.length > 0 ? { artifacts: input.artifacts } : {}),
  };
}

export { JSON_RPC_ERROR, jsonRpcError };
export type { JsonRpcId, JsonRpcRequest, JsonRpcResponse } from "../mcp/protocol.ts";
