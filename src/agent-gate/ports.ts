/*
<MODULE_CONTRACT>
<purpose>
RFC-0290: the dependency-injection ports the Agent Gate runs against. Keeps
the gate framework-agnostic — `astro.ts` is the only module that constructs
concrete port implementations (fetch-based knowledge reads, QStash dispatch).
</purpose>
<non-goals>
  <item>Do not implement any port here — that is astro.ts (or test fixtures' fakes).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0290: initial ports contract.</item>
  <item>RFC-0291: add optional createRateLimiter port.</item>
  <item>RFC-1112: dispatch.send returns ActionReceipt; add optional idempotency port.</item>
</CHANGE_SUMMARY>
*/

import type { IntegrationEvent } from "@warpgogol/werkstatt-shared/integration/port";
import type { ActionReceipt } from "@warpgogol/werkstatt-shared/agent";
import type { RateLimiter } from "./limits.ts";

/**
 * RFC-1112: durable receipt store for Idempotency-Key replay. `get` returns the
 * stored record or null on a miss; `put` persists the receipt under the key for
 * `ttlSeconds`. Implementations throw on transport errors — the pipeline treats
 * a `get` throw as a miss (fail-open) and a `put` throw as non-fatal.
 */
export interface IdempotencyPort {
  get(key: string): Promise<{ receipt: ActionReceipt; bodyHash: string } | null>;
  put(key: string, bodyHash: string, receipt: ActionReceipt, ttlSeconds: number): Promise<void>;
}

export interface AgentGatePorts {
  /** Read a static public artifact by site-relative path (e.g. "/api/agent/v1/offer.json"). */
  knowledge: { read(path: string): Promise<string | null> };
  /**
   * Hand a validated event to the reliable delivery substrate. Returns the
   * ActionReceipt the caller sees (receiptId == event.eventId, submittedAt
   * stamped by the adapter at publish time). Throws on transport failure.
   */
  dispatch: { send(event: IntegrationEvent): Promise<ActionReceipt> };
  now(): Date;
  /** RFC-0291: optional rate limiter factory. If absent, no rate limiting (fail-open). */
  createRateLimiter?: (maxPerWindow: number) => RateLimiter;
  /**
   * RFC-1112: optional receipt store for Idempotency-Key dedup. If absent,
   * requests proceed without dedup and responses carry `X-Agent-Idempotency: disabled`.
   */
  idempotency?: IdempotencyPort;
}
