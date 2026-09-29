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
  <item>RFC-1169: preview envelope — sideEffect "none" schema violations answer ready:false/missing/problems (200, never 422); the preview branch returns draftId + summary + nextAction linkage via buildPreviewReady/buildPreviewFailure, shared by HTTP, MCP, and A2A.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1172: closed agent.traffic telemetry — ports.telemetry sink, TrafficRecorder + boundary emit via withTrafficEmit</item>
</CHANGE_SUMMARY>
*/

import type {
  AgentSurfaceManifest,
  ActionReceipt,
  AgentProblemDetails,
} from "@warpgogol/werkstatt-shared/agent";
import { buildAgentProblem } from "@warpgogol/werkstatt-shared/agent";
import {
  byteHash,
  canonicalJsonHashV1,
  snapshotCanonicalJsonObjectV1,
} from "@warpgogol/werkstatt-shared/fingerprint";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import type { AgentGatePorts } from "./ports.ts";
import type { RateLimiter } from "./limits.ts";
import {
  validateAgainstCapabilitySchema,
  buildIntegrationEventFromAction,
  type ValidationErrorCode,
  type ValidationFieldError,
} from "./actions.ts";

/** RFC-1112: receipt-store TTL — 24h covers client retry windows without accumulating keys. */
export const IDEMPOTENCY_TTL_SECONDS = 86400;

/** RFC-1112: Idempotency-Key longer than this is ignored (treated as absent). */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** RFC-1112: MCP params._meta key carrying the idempotency key. */
export const MCP_IDEMPOTENCY_META_KEY = "gogol.dev/idempotencyKey";

export interface ActionContext {
  capabilityId: string;
  request: Request;
  manifest: AgentSurfaceManifest;
  catalog: CapabilityRecord[];
  ports: AgentGatePorts;
  rawBody: string;
  clientIp: string;
  agentIdentity: Record<string, string>;
  /** RFC-1112: caller-supplied Idempotency-Key (validated length), if any. */
  idempotencyKey?: string;
  /** RFC-1112: sha256 of the raw request body — computed only when a key is present. */
  bodyHash?: string;
  // Mutable fields populated by pipeline steps
  capability?: CapabilityRecord;
  parsed?: unknown;
  validatedValue?: Record<string, unknown>;
  /** RFC-1172: optional per-request telemetry recorder — steps record what only they know (duplicate replay). */
  traffic?: import("./telemetry.ts").TrafficRecorder;
}

export type StepResult = Response | void;

/** RFC-1112: read + bound the Idempotency-Key header. Overlong keys are ignored. */
export function extractIdempotencyKey(request: Request): string | undefined {
  const key = request.headers.get("Idempotency-Key") ?? undefined;
  if (!key || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) return undefined;
  return key;
}

/** RFC-1112: byte-level body hash for the HTTP surface. */
export function httpBodyHash(rawBody: string): string {
  return byteHash(rawBody);
}

/**
 * RFC-1112: canonical body hash for the MCP surface — arguments arrive
 * pre-parsed, so the hash is over the canonical JSON snapshot (key-order
 * independent). Returns undefined when the input cannot be snapshotted.
 */
export function mcpBodyHash(args: unknown): string | undefined {
  const snapshot = snapshotCanonicalJsonObjectV1(args ?? {});
  return snapshot.ok ? canonicalJsonHashV1(snapshot.value) : undefined;
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

/** RFC-1112: RFC 9457 error response — every action failure uses this shape. */
export function problemResponse(
  problem: AgentProblemDetails,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: { "content-type": "application/problem+json", ...extraHeaders },
  });
}

export function resolveCapability(ctx: ActionContext): StepResult {
  const capability = ctx.catalog.find((c) => c.id === ctx.capabilityId);
  const ref = ctx.manifest.actions.find((a) => a.id === ctx.capabilityId);
  if (!capability || !ref) {
    return problemResponse(
      buildAgentProblem("unknown-capability", {
        detail: `No active capability "${ctx.capabilityId}".`,
      }),
    );
  }
  ctx.capability = capability;
}

export function checkPayloadSize(ctx: ActionContext): StepResult {
  const byteLength = new TextEncoder().encode(ctx.rawBody).length;
  if (byteLength > ctx.capability!.limits.maxPayloadBytes) {
    return problemResponse(
      buildAgentProblem("payload-too-large", {
        detail: `Payload is ${byteLength} bytes; the limit is ${ctx.capability!.limits.maxPayloadBytes}.`,
      }),
    );
  }
}

/**
 * RFC-1112: idempotency lookup — runs before rate limiting so a replay does not
 * consume budget. Returns the stored receipt (flipped to duplicate) on a
 * same-body hit, a 409 problem on a different-body reuse, or void on a miss.
 * Fail-open: a store read error proceeds without dedup.
 */
export async function checkIdempotencyReplay(input: {
  ports: AgentGatePorts;
  capability: CapabilityRecord;
  idempotencyKey?: string;
  bodyHash?: string;
}): Promise<ActionReceipt | AgentProblemDetails | null> {
  const { ports, capability, idempotencyKey, bodyHash } = input;
  if (!idempotencyKey || !ports.idempotency || capability.sideEffect === "none" || !bodyHash) {
    return null;
  }
  let stored: { receipt: ActionReceipt; bodyHash: string } | null;
  try {
    stored = await ports.idempotency.get(idempotencyKey);
  } catch {
    return null;
  }
  if (!stored) return null;
  if (stored.bodyHash !== bodyHash) {
    return buildAgentProblem("idempotency-key-reuse", {
      detail: "This Idempotency-Key was already used with a different payload.",
    });
  }
  return { ...stored.receipt, status: "duplicate", duplicate: true };
}

/** Pipeline-step wrapper around checkIdempotencyReplay for the HTTP surface. */
export async function checkIdempotency(ctx: ActionContext): Promise<StepResult> {
  const replay = await checkIdempotencyReplay({
    ports: ctx.ports,
    capability: ctx.capability!,
    idempotencyKey: ctx.idempotencyKey,
    bodyHash: ctx.bodyHash,
  });
  if (replay === null) return;
  if ("receiptId" in replay) {
    // RFC-1172: replayed from a stored receipt — mark the traffic event.
    if (ctx.traffic) ctx.traffic.duplicate = true;
    return jsonResponse(replay, 200);
  }
  return problemResponse(replay);
}

export function checkRateLimit(ctx: ActionContext, limiter: RateLimiter | null): StepResult {
  if (!limiter) return;
  const result = limiter.check(`${ctx.capabilityId}:${ctx.clientIp}`);
  if (!result.allowed) {
    return problemResponse(
      buildAgentProblem("rate-limited", { retryAfterSeconds: result.retryAfterSeconds }),
      { "Retry-After": String(result.retryAfterSeconds) },
    );
  }
}

export function parseJsonBody(ctx: ActionContext): StepResult {
  try {
    ctx.parsed = ctx.rawBody.length > 0 ? JSON.parse(ctx.rawBody) : {};
  } catch {
    return problemResponse(buildAgentProblem("invalid-json"));
  }
}

export function validateSchema(ctx: ActionContext): StepResult {
  const validated = validateAgainstCapabilitySchema(ctx.capability!.input, ctx.parsed!);
  if (!validated.ok) {
    // RFC-1169: preview capabilities answer validation failures with the
    // readiness envelope (200), not a 422 problem — "incomplete, ask the user"
    // must be distinguishable from "malformed".
    if (ctx.capability!.sideEffect === "none") {
      return jsonResponse(buildPreviewFailure(validated.errors), 200);
    }
    return problemResponse(
      buildAgentProblem("schema-violation", {
        schemaRef: `/.well-known/agent.openapi.json#/components/schemas/${ctx.capabilityId}-input`,
        errors: validated.errors,
      }),
    );
  }
  ctx.validatedValue = validated.value;
}

// ---------------------------------------------------------------------------
// RFC-1112: shared execution core — used by the HTTP pipeline AND mcp/handler.ts
// so both surfaces share one validation + receipt assembly.
// ---------------------------------------------------------------------------

export interface ActionExecutionInput {
  capability: CapabilityRecord;
  manifest: AgentSurfaceManifest;
  ports: AgentGatePorts;
  validatedValue: Record<string, unknown>;
  agentIdentity: Record<string, string>;
  idempotencyKey?: string;
  bodyHash?: string;
}

export type ActionExecution =
  | { kind: "receipt"; receipt: ActionReceipt }
  | { kind: "preview"; envelope: ActionPreviewResult }
  | { kind: "problem"; problem: AgentProblemDetails };

/** RFC-1169: one machine-readable field violation on the preview failure branch. */
export interface ActionPreviewProblem {
  field: string;
  code: ValidationErrorCode;
  detail: string;
}

/**
 * RFC-1169: the preview-path answer shape. `ready` is the only unconditional
 * field; everything else is present only in its branch — the closed capability
 * output subset cannot express conditional presence, so the shape is enforced
 * by agent.surface.contract.check, not by the schema.
 */
export interface ActionPreviewResult {
  ready: boolean;
  /** Present when ready — deterministic canonical hash of the validated input. */
  draftId?: string;
  /** Present when !ready — absent required field names. */
  missing?: string[];
  /** Present when !ready — non-missing violations; unmappable errors keep field "". */
  problems?: ActionPreviewProblem[];
  /** Present when ready — the validated input echoed for user confirmation. */
  summary?: Record<string, unknown>;
  /** Present when ready — the submit-sibling capability id from the catalog. */
  nextAction?: string;
  /** Present when ready — human+model readable consequence of nextAction. */
  sideEffect?: string;
}

/**
 * RFC-1169: build the ready:false branch from validator errors. REQUIRED-coded
 * errors populate `missing`; everything else lands in `problems` so no
 * violation is ever dropped.
 */
export function buildPreviewFailure(errors: ValidationFieldError[]): ActionPreviewResult {
  return {
    ready: false,
    missing: errors.filter((e) => e.code === "REQUIRED").map((e) => e.path),
    problems: errors
      .filter((e) => e.code !== "REQUIRED")
      .map((e) => ({ field: e.path, code: e.code, detail: e.message })),
  };
}

/** RFC-1169: build the ready:true branch — draftId, echoed summary, optional nextAction linkage. */
export function buildPreviewReady(
  capability: CapabilityRecord,
  draftId: string,
  summary: Record<string, unknown>,
): ActionPreviewResult {
  const envelope: ActionPreviewResult = { ready: true, draftId, summary };
  if (capability.nextAction) {
    envelope.nextAction = capability.nextAction.capability;
    envelope.sideEffect = capability.nextAction.sideEffect;
  }
  return envelope;
}

/**
 * Execute a validated action: sideEffect "none" returns a deterministic
 * preview envelope (draftId = canonical hash of the validated input, plus
 * summary/nextAction per RFC-1169); "write" dispatches the IntegrationEvent
 * and stores the receipt under the Idempotency-Key when a store is
 * configured. A failed receipt-store write is non-fatal (the dispatch
 * already succeeded — the receipt is still returned).
 */
export async function executeAction(input: ActionExecutionInput): Promise<ActionExecution> {
  const { capability, manifest, ports, validatedValue, agentIdentity, idempotencyKey, bodyHash } =
    input;

  if (capability.sideEffect === "none") {
    const snapshot = snapshotCanonicalJsonObjectV1(validatedValue);
    if (!snapshot.ok) {
      return {
        kind: "problem",
        problem: buildAgentProblem("schema-violation", {
          detail: `Input could not be canonicalized: ${snapshot.message}`,
        }),
      };
    }
    return {
      kind: "preview",
      envelope: buildPreviewReady(capability, canonicalJsonHashV1(snapshot.value), validatedValue),
    };
  }

  const locale =
    typeof validatedValue.locale === "string" &&
    manifest.languages.supported.includes(validatedValue.locale)
      ? validatedValue.locale
      : manifest.languages.default;
  const event = buildIntegrationEventFromAction(
    capability,
    validatedValue,
    locale,
    ports.now(),
    idempotencyKey,
  );
  if (Object.keys(agentIdentity).length > 0) {
    event.payload._agentIdentity = agentIdentity;
  }
  try {
    const receipt = await ports.dispatch.send(event);
    if (idempotencyKey && ports.idempotency && bodyHash) {
      try {
        await ports.idempotency.put(idempotencyKey, bodyHash, receipt, IDEMPOTENCY_TTL_SECONDS);
      } catch (err) {
        console.warn(
          `agent-gate: receipt store put failed for key "${idempotencyKey}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { kind: "receipt", receipt };
  } catch {
    return {
      kind: "problem",
      problem: buildAgentProblem("dispatch-failed", {
        detail: `The delivery substrate rejected event ${event.eventId}.`,
      }),
    };
  }
}

/** Pipeline-step wrapper around executeAction for the HTTP surface. */
export async function dispatchOrPreview(ctx: ActionContext): Promise<StepResult> {
  const result = await executeAction({
    capability: ctx.capability!,
    manifest: ctx.manifest,
    ports: ctx.ports,
    validatedValue: ctx.validatedValue!,
    agentIdentity: ctx.agentIdentity,
    idempotencyKey: ctx.idempotencyKey,
    bodyHash: ctx.bodyHash,
  });
  switch (result.kind) {
    case "receipt":
      return jsonResponse(result.receipt, 200);
    case "preview":
      return jsonResponse(result.envelope, 200);
    case "problem":
      return problemResponse(result.problem);
  }
}

/**
 * RFC-1171: deprecation headers for alias-path responses. The request pathname
 * is matched against manifest `deprecations[].path` with `{id}` substituted by
 * the requested capability id. Headers appear only once `deprecateAt` has
 * passed — the declaration can ship ahead of the signal. Returns undefined for
 * canonical paths and undated/malformed entries.
 */
export function deprecationHeaders(
  manifest: AgentSurfaceManifest,
  capabilityId: string,
  requestPathname: string,
  now = Date.now(),
): Record<string, string> | undefined {
  for (const dep of manifest.deprecations ?? []) {
    if (dep.path.replaceAll("{id}", capabilityId) !== requestPathname) continue;
    const deprecateMs = Date.parse(dep.deprecateAt);
    const sunsetMs = Date.parse(dep.sunsetAt);
    if (Number.isNaN(deprecateMs) || Number.isNaN(sunsetMs) || now < deprecateMs) {
      return undefined;
    }
    return {
      // RFC 9745: Deprecation is a unix-seconds structured field.
      Deprecation: `@${Math.floor(deprecateMs / 1000)}`,
      // RFC 8594: Sunset is an HTTP-date.
      Sunset: new Date(sunsetMs).toUTCString(),
      Link: `<${dep.successor.replaceAll("{id}", capabilityId)}>; rel="successor-version"`,
    };
  }
  return undefined;
}
