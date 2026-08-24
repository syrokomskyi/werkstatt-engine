/*
<MODULE_CONTRACT>
<purpose>
Extract the action handler pipeline from index.ts into composable, testable
steps. Each step is a pure function that receives the accumulated context and
returns either a Response (short-circuit) or void (continue to next step).
</purpose>
<non-goals>
  <item>Do not implement rate limiting or validation logic here — delegate to existing modules.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Architecture review 2026-07-14: extract action handler behind a pipeline of named steps.</item>
</CHANGE_SUMMARY>
*/

import type { AgentSurfaceManifest } from "@warpgogol/werkstatt-shared/share/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import type { AgentGatePorts } from "./ports.ts";
import type { RateLimiter } from "./limits.ts";
import { validateAgainstCapabilitySchema, buildIntegrationEventFromAction } from "./actions.ts";

export interface ActionContext {
  capabilityId: string;
  request: Request;
  manifest: AgentSurfaceManifest;
  catalog: CapabilityRecord[];
  ports: AgentGatePorts;
  rawBody: string;
  clientIp: string;
  agentIdentity: Record<string, string>;
  // Mutable fields populated by pipeline steps
  capability?: CapabilityRecord;
  parsed?: unknown;
  validatedValue?: Record<string, unknown>;
}

export type StepResult = Response | void;

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

export function resolveCapability(ctx: ActionContext): StepResult {
  const capability = ctx.catalog.find((c) => c.id === ctx.capabilityId);
  const ref = ctx.manifest.actions.find((a) => a.id === ctx.capabilityId);
  if (!capability || !ref) {
    return jsonResponse({ accepted: false, error: "unknown-capability" }, 404);
  }
  ctx.capability = capability;
}

export function checkPayloadSize(ctx: ActionContext): StepResult {
  const byteLength = new TextEncoder().encode(ctx.rawBody).length;
  if (byteLength > ctx.capability!.limits.maxPayloadBytes) {
    return jsonResponse({ accepted: false, error: "payload-too-large" }, 413);
  }
}

export function checkRateLimit(ctx: ActionContext, limiter: RateLimiter | null): StepResult {
  if (!limiter) return;
  const result = limiter.check(`${ctx.capabilityId}:${ctx.clientIp}`);
  if (!result.allowed) {
    return jsonResponse(
      { accepted: false, error: "rate-limited", retryAfterSeconds: result.retryAfterSeconds },
      429,
      { "Retry-After": String(result.retryAfterSeconds) },
    );
  }
}

export function parseJsonBody(ctx: ActionContext): StepResult {
  try {
    ctx.parsed = ctx.rawBody.length > 0 ? JSON.parse(ctx.rawBody) : {};
  } catch {
    return jsonResponse({ accepted: false, error: "invalid-json" }, 400);
  }
}

export function validateSchema(ctx: ActionContext): StepResult {
  const validated = validateAgainstCapabilitySchema(ctx.capability!.input, ctx.parsed!);
  if (!validated.ok) {
    return jsonResponse(
      { accepted: false, error: "schema-violation", errors: validated.errors },
      400,
    );
  }
  ctx.validatedValue = validated.value;
}

export async function buildAndDispatchEvent(ctx: ActionContext): Promise<StepResult> {
  const locale =
    typeof ctx.validatedValue!.locale === "string" &&
    ctx.manifest.languages.supported.includes(ctx.validatedValue!.locale)
      ? ctx.validatedValue!.locale
      : ctx.manifest.languages.default;
  const event = buildIntegrationEventFromAction(
    ctx.capability!,
    ctx.validatedValue!,
    locale,
    ctx.ports.now(),
  );
  if (Object.keys(ctx.agentIdentity).length > 0) {
    event.payload._agentIdentity = ctx.agentIdentity;
  }
  try {
    const outcome = await ctx.ports.dispatch.send(event);
    return jsonResponse(outcome, 200);
  } catch {
    return jsonResponse(
      { accepted: false, error: "dispatch-failed", eventId: event.eventId, retryable: true },
      502,
    );
  }
}
