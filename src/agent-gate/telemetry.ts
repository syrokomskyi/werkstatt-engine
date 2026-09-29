/*
<MODULE_CONTRACT>
<purpose>
RFC-1172: emission helper for the closed `werkstatt.agent.traffic` event.
Route boundaries create one {@link TrafficRecorder} per request, handlers
record the fields they know (operation, capability, problemKind, duplicate,
mcpProtocolVersion, observedIdentity) via optional chaining, and the boundary
calls {@link emitAgentTraffic} exactly once after the gate call resolves —
status derived from the response, durationMs measured around it. Emission is
fire-and-forget: a missing port, missing operation, or a throwing sink drops
the event silently — observability never breaks requests.
</purpose>
<non-goals>
  <item>Do not emit request/response payloads — the closed schema (werkstatt-shared/agent/telemetry) rejects them.</item>
  <item>Do not correlate or trace — RFC-1116's tracing non-goal stands.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1172: initial emission helper — TrafficRecorder + boundary emit + status derivation.</item>
  <item>RFC-1172: closed agent.traffic telemetry — ports.telemetry sink, TrafficRecorder + boundary emit via withTrafficEmit</item>
</CHANGE_SUMMARY>
*/

import { agentTrafficEventSchema, type AgentTrafficEvent } from "@warpgogol/werkstatt-shared/agent";

import type { AgentGatePorts } from "./ports.ts";

/**
 * Per-request context handlers fill on their terminal paths. The boundary
 * creates it, hands it into the gate call, and reads it back for the single
 * emission. Every field is optional — handlers set only what they know.
 */
export interface TrafficRecorder {
  /**
   * Closed operation token. Route-determinable for single-operation routes
   * (search/ask/health/action.call); handlers override when the request picks
   * the operation (MCP tools/list vs tools/call vs other, A2A ops, method
   * rejections). Emission is skipped when still unset at the boundary —
   * never emit a fake value.
   */
  operation?: AgentTrafficEvent["operation"];
  /** Action/tool/method id — action id, tool name, or raw JSON-RPC method for `other`. */
  capability?: string;
  /** RFC 9457 `type` token when the terminal path is a problem. */
  problemKind?: string;
  /** RFC-1112: idempotent replay served from a stored receipt. */
  duplicate?: boolean;
  /** Negotiated MCP protocol version (RFC-1113) — MCP requests only. */
  mcpProtocolVersion?: string;
  /** RFC-0291 identity headers, exactly as observed — never trusted. */
  observedIdentity?: Record<string, string>;
  /**
   * Handlers set this when the response status code does not express the
   * semantic outcome — JSON-RPC errors ride HTTP 200 (failure vs success),
   * method-not-found is a rejected operation inside a 200 envelope.
   */
  statusOverride?: AgentTrafficEvent["status"];
}

/**
 * Map the terminal response to the closed status enum: 2xx → success,
 * 429 → rate-limited, other 4xx → rejected (pre-handler gate refusal),
 * anything else → failure.
 */
export function deriveTrafficStatus(response: Response): AgentTrafficEvent["status"] {
  if (response.status >= 200 && response.status < 300) return "success";
  if (response.status === 429) return "rate-limited";
  if (response.status >= 400 && response.status < 500) return "rejected";
  return "failure";
}

/**
 * Extract the RFC 9457 `type` token from a problem+json response without
 * consuming the response (clone-read). Returns undefined for non-problem
 * responses or unreadable bodies.
 */
async function readProblemKind(response: Response): Promise<string | undefined> {
  if (!response.headers.get("content-type")?.includes("problem+json")) return undefined;
  try {
    const body = (await response.clone().json()) as { type?: unknown };
    return typeof body.type === "string" ? body.type : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Emit exactly one closed event per request. Fire-and-forget: never throws —
 * a missing port, a missing operation, or a sink error all degrade to a
 * silent drop (traffic handling outranks observability). Async so the
 * problem-kind clone-read can run; callers may `await` (tests, adapters) or
 * fire and forget.
 */
export async function emitAgentTraffic(
  ports: Pick<AgentGatePorts, "telemetry" | "now">,
  input: {
    systemId: string;
    protocol: AgentTrafficEvent["protocol"];
    response: Response;
    traffic: TrafficRecorder;
    durationMs: number;
  },
): Promise<void> {
  try {
    if (!ports.telemetry || !input.traffic.operation) return;
    const event = agentTrafficEventSchema.parse({
      type: "werkstatt.agent.traffic",
      timestamp: ports.now().toISOString(),
      systemId: input.systemId,
      protocol: input.protocol,
      operation: input.traffic.operation,
      capability: input.traffic.capability,
      status: input.traffic.statusOverride ?? deriveTrafficStatus(input.response),
      problemKind: input.traffic.problemKind ?? (await readProblemKind(input.response)),
      duplicate: input.traffic.duplicate,
      mcpProtocolVersion: input.traffic.mcpProtocolVersion,
      observedIdentity: input.traffic.observedIdentity,
      durationMs: Math.max(0, Math.round(input.durationMs)),
    });
    ports.telemetry(event);
  } catch {
    // Silent drop — telemetry never breaks the request path (RFC-1172).
  }
}

/**
 * Production sink — one structured JSON line per event on stdout, captured
 * by Workers logs. Wired in `astro.ts` buildPorts; tests inject collectors.
 */
export function workerLogTelemetry(event: AgentTrafficEvent): void {
  console.log(JSON.stringify(event));
}
