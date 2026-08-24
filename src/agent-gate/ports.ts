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
</CHANGE_SUMMARY>
*/

import type { IntegrationEvent } from "@warpgogol/werkstatt-shared/integration/port";
import type { RateLimiter } from "./limits.ts";

export interface AgentGatePorts {
  /** Read a static public artifact by site-relative path (e.g. "/api/agent/v1/offer.json"). */
  knowledge: { read(path: string): Promise<string | null> };
  /** Hand a validated event to the reliable delivery substrate. Throws on transport failure. */
  dispatch: { send(event: IntegrationEvent): Promise<{ accepted: boolean; eventId: string }> };
  now(): Date;
  /** RFC-0291: optional rate limiter factory. If absent, no rate limiting (fail-open). */
  createRateLimiter?: (maxPerWindow: number) => RateLimiter;
}
