/*
<MODULE_CONTRACT>
<purpose>
RFC-1114: the JSON-RPC method router for the bounded A2A v1.0 subset. Handles
exactly SendMessage: a capability DataPart selects the action, the shared
validate→dispatch→receipt pipeline (RFC-1112) executes it, and the answer is a
terminal-state Task whose artifact carries the ActionReceipt. Everything else
is method-not-found (batching is rejected one level up, at the transport
boundary in index.ts).
</purpose>
<non-goals>
  <item>Do not implement GetTask/CancelTask/streaming/push — out of the pinned subset.</item>
  <item>Do not enforce auth — only rate limits and size caps (RFC-0291 parity).</item>
  <item>Do not reroute free-text messages to search — a missing capability
        DataPart is -32602, honest about what the surface can execute.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1114: initial A2A SendMessage handler over the shared action pipeline.</item>
  <item>RFC-1114: minimal real A2A endpoint + honest agent card</item>
</CHANGE_SUMMARY>
*/

import type { AgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";
import { buildAgentProblem, type AgentProblemDetails } from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import type { AgentGatePorts } from "../ports.ts";
import type { RateLimiter } from "../limits.ts";
import { validateAgainstCapabilitySchema } from "../actions.ts";
import {
  checkIdempotencyReplay,
  executeAction,
  mcpBodyHash,
} from "../action-pipeline.ts";
import {
  A2A_METHOD_SEND_MESSAGE,
  buildA2aTask,
  isA2aMessage,
  readCapabilityInvocation,
  type A2AMessage,
  type A2ATask,
} from "./protocol.ts";
import {
  JSON_RPC_ERROR,
  jsonRpcError,
  jsonRpcSuccess,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../mcp/protocol.ts";

export interface A2aHandlerContext {
  manifest: AgentSurfaceManifest;
  catalog: CapabilityRecord[];
  ports: AgentGatePorts;
  /** RFC-0291: identity headers extracted from the HTTP request (observe-only). */
  agentIdentity?: Record<string, string>;
  /** RFC-0291: client IP for rate-limit keying. */
  clientIp?: string;
  /** RFC-1112: the Idempotency-Key HTTP header, passed through by the transport boundary. */
  idempotencyKey?: string;
}

// RFC-0291: module-level limiter cache for the A2A path (mirrors mcp/handler.ts).
const a2aLimiterCache = new Map<string, RateLimiter>();

function getA2aLimiter(
  capabilityId: string,
  maxPerWindow: number,
  factory: (max: number) => RateLimiter,
): RateLimiter {
  const cacheKey = `${capabilityId}:${maxPerWindow}`;
  let limiter = a2aLimiterCache.get(cacheKey);
  if (!limiter) {
    limiter = factory(maxPerWindow);
    a2aLimiterCache.set(cacheKey, limiter);
  }
  return limiter;
}

/** Reset the A2A limiter cache — test-only. */
export function __resetA2aLimiterCache(): void {
  a2aLimiterCache.clear();
}

function problemError(id: JsonRpcRequest["id"], problem: AgentProblemDetails): JsonRpcResponse {
  return jsonRpcError(id ?? null, JSON_RPC_ERROR.SERVER_ERROR, problem.title, problem);
}

/** Wrap a terminal-state task in a JSON-RPC success envelope. */
function taskResult(id: JsonRpcRequest["id"], task: A2ATask): JsonRpcResponse {
  return jsonRpcSuccess(id ?? null, task);
}

async function handleSendMessage(
  req: JsonRpcRequest,
  ctx: A2aHandlerContext,
): Promise<JsonRpcResponse> {
  const id = req.id ?? null;
  const params = (req.params ?? {}) as { message?: unknown; configuration?: unknown };
  // SendMessageConfiguration.blocking is ignored — the server is always synchronous.

  if (!isA2aMessage(params.message)) {
    const problem = buildAgentProblem("invalid-json", {
      detail:
        "params.message must be an A2A Message: messageId (string), role \"user\", parts[].",
    });
    return jsonRpcError(id, JSON_RPC_ERROR.INVALID_PARAMS, problem.title, problem);
  }
  const message: A2AMessage = params.message;
  const timestamp = ctx.ports.now().toISOString();

  const invocation = readCapabilityInvocation(message);
  if (!invocation) {
    const problem = buildAgentProblem("schema-violation", {
      detail:
        'No capability DataPart — send a part { kind: "data", data: { capability: "<id>", input: {...} } }.',
    });
    return jsonRpcError(id, JSON_RPC_ERROR.INVALID_PARAMS, problem.title, problem);
  }

  const capability = ctx.catalog.find((c) => c.id === invocation.capabilityId);
  const ref = ctx.manifest.actions.find((a) => a.id === invocation.capabilityId);
  if (!capability || !ref) {
    const problem = buildAgentProblem("unknown-capability", {
      detail: `No active capability "${invocation.capabilityId}".`,
    });
    return jsonRpcError(id, JSON_RPC_ERROR.INVALID_PARAMS, problem.title, problem);
  }

  // RFC-0291: payload size cap on the action input (MCP-path parity).
  const argsBytes = new TextEncoder().encode(JSON.stringify(invocation.input)).length;
  if (argsBytes > capability.limits.maxPayloadBytes) {
    const problem = buildAgentProblem("payload-too-large", {
      detail: `Input is ${argsBytes} bytes; the limit is ${capability.limits.maxPayloadBytes}.`,
    });
    return problemError(id, problem);
  }

  // RFC-1112: the Idempotency-Key HTTP header travels via ctx (A2A has no
  // per-message key field in the pinned subset); the body hash is the
  // canonical JSON hash of the input — same as the MCP path.
  const bodyHash = ctx.idempotencyKey ? mcpBodyHash(invocation.input) : undefined;

  // RFC-1112: replay check runs before rate limiting — a replay must not
  // consume budget. A replayed receipt completes the task as a duplicate.
  const replay = await checkIdempotencyReplay({
    ports: ctx.ports,
    capability,
    idempotencyKey: ctx.idempotencyKey,
    bodyHash,
  });
  if (replay !== null) {
    if ("receiptId" in replay) {
      return taskResult(
        id,
        buildA2aTask({
          id: replay.receiptId,
          contextId: message.contextId,
          state: "completed",
          timestamp,
          artifacts: [{ name: "receipt", parts: [{ kind: "data", data: replay }] }],
        }),
      );
    }
    return problemError(id, replay as AgentProblemDetails);
  }

  // RFC-0291: per-IP rate limit (fail-open if no limiter).
  if (ctx.ports.createRateLimiter) {
    const limiter = getA2aLimiter(
      capability.id,
      capability.limits.perMinutePerIp,
      ctx.ports.createRateLimiter,
    );
    const clientIp = ctx.clientIp ?? "unknown";
    const result = limiter.check(`${capability.id}:${clientIp}`);
    if (!result.allowed) {
      const problem = buildAgentProblem("rate-limited", {
        retryAfterSeconds: result.retryAfterSeconds,
      });
      return problemError(id, problem);
    }
  }

  const validated = validateAgainstCapabilitySchema(capability.input, invocation.input);
  if (!validated.ok) {
    // The message was understood; the task is refused before dispatch —
    // a rejected task carries the problem details in its artifact.
    const problem = buildAgentProblem("schema-violation", {
      schemaRef: `/.well-known/agent.openapi.json#/components/schemas/${capability.id}-input`,
      errors: validated.errors,
    });
    return taskResult(
      id,
      buildA2aTask({
        id: crypto.randomUUID(),
        contextId: message.contextId,
        state: "rejected",
        timestamp,
        artifacts: [{ name: "problem", parts: [{ kind: "data", data: problem }] }],
      }),
    );
  }

  // RFC-1112: shared execution core — preview for sideEffect "none",
  // dispatch + receipt otherwise.
  const result = await executeAction({
    capability,
    manifest: ctx.manifest,
    ports: ctx.ports,
    validatedValue: validated.value,
    agentIdentity: ctx.agentIdentity ?? {},
    idempotencyKey: ctx.idempotencyKey,
    bodyHash,
  });
  switch (result.kind) {
    case "receipt":
      return taskResult(
        id,
        buildA2aTask({
          id: result.receipt.receiptId,
          contextId: message.contextId,
          state: "completed",
          timestamp,
          artifacts: [
            { name: "receipt", parts: [{ kind: "data", data: result.receipt }] },
          ],
        }),
      );
    case "preview":
      return taskResult(
        id,
        buildA2aTask({
          id: crypto.randomUUID(),
          contextId: message.contextId,
          state: "completed",
          timestamp,
          artifacts: [
            {
              name: "preview",
              parts: [{ kind: "data", data: { valid: true, draftId: result.draftId } }],
            },
          ],
        }),
      );
    case "problem":
      // Dispatch-level failure is a failed task, never a silent 200.
      return taskResult(
        id,
        buildA2aTask({
          id: crypto.randomUUID(),
          contextId: message.contextId,
          state: "failed",
          timestamp,
          artifacts: [
            { name: "problem", parts: [{ kind: "data", data: result.problem }] },
          ],
        }),
      );
  }
}

/** Route one JSON-RPC request to its handler. The transport boundary (index.ts) owns batching/HTTP-method rejection and the A2A-Version header gate. */
export async function handleA2aRequest(
  req: JsonRpcRequest,
  ctx: A2aHandlerContext,
): Promise<JsonRpcResponse> {
  if (req.method !== A2A_METHOD_SEND_MESSAGE) {
    return jsonRpcError(
      req.id ?? null,
      JSON_RPC_ERROR.METHOD_NOT_FOUND,
      `Method "${req.method}" not found.`,
    );
  }
  return handleSendMessage(req, ctx);
}
