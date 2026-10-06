/*
<MODULE_CONTRACT>
<purpose>
RFC-1212: journaled usage-record emission for metered capabilities — the
billing sibling of {@link emitAgentTraffic}. Called from the dispatch boundary
(executeAction) AFTER a successful dispatch.send: exactly one AgentUsageRecord
per metered invocation; rejected, rate-limited, schema-violated, or
idempotent-replayed calls never reach this code path, so they never bill.
Free-allowance accounting decrements the same fixed-window counter
infrastructure the rate limiter uses (RFC-0291), keyed
`metering:<capabilityId>` per caller identity; an unavailable counter store
degrades to "allowance exhausted → billable" — the call is never blocked by
metering state. Emission is fire-and-forget through the optional `usage` port
— the engine never imports billing packages (pull model, AC-9).
</purpose>
<non-goals>
  <item>Do not bill, price, or contact Stripe — the record is journaled for the
        site-side billing bridge to drain.</item>
  <item>Do not emit for undispatched calls — metering attaches strictly
        post-dispatch inside executeAction.</item>
  <item>Do not emit when the capability declares no metering block.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1212: initial emission — usage port + free-window counter + workerLogUsage sink.</item>
</CHANGE_SUMMARY>
*/

import {
  AGENT_USAGE_SCHEMA_ID,
  agentUsageRecordSchema,
  type AgentUsageRecord,
  type CapabilityMetering,
} from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";

import type { AgentGatePorts } from "./ports.ts";
import type { RateLimiter } from "./limits.ts";

/** Window granularity → seconds. "month" uses a 30-day fixed window. */
const WINDOW_SECONDS: Record<NonNullable<CapabilityMetering["window"]>, number> = {
  day: 86_400,
  month: 2_592_000,
};

/**
 * Free-allowance limiter store — separate from the rate-limit store so a
 * metering bucket never collides with a throttle bucket for the same
 * capability. Keyed `metering:<capabilityId>:<free>:<windowSeconds>`.
 */
const freeWindowLimiters = new Map<string, RateLimiter>();

/** Reset the free-allowance cache — test-only. */
export function __resetFreeWindowCache(): void {
  freeWindowLimiters.clear();
}

/**
 * Consume one free unit from the caller's allowance window. Returns true when
 * a free unit was consumed (call is not billable), false when the allowance
 * is exhausted or no counter store exists — both mean "billable".
 */
function consumeFreeUnit(
  ports: AgentGatePorts,
  metering: CapabilityMetering,
  capabilityId: string,
  identity: string,
): boolean {
  const free = metering.freeUnitsPerWindow ?? 0;
  if (free === 0 || !ports.createRateLimiter) return false;
  const windowSeconds = WINDOW_SECONDS[metering.window ?? "month"];
  const key = `metering:${capabilityId}:${free}:${windowSeconds}`;
  try {
    let limiter = freeWindowLimiters.get(key);
    if (!limiter) {
      limiter = ports.createRateLimiter(free, windowSeconds);
      freeWindowLimiters.set(key, limiter);
    }
    return limiter.check(`${capabilityId}:${identity}`).allowed;
  } catch {
    // Counter store failure → allowance treated as exhausted (RFC-1212).
    return false;
  }
}

/**
 * Emit exactly one journaled AgentUsageRecord for a dispatched metered call.
 * Fire-and-forget like the traffic emit — a missing port or a throwing sink
 * drops the record silently; billing transport never breaks a tool call (the
 * adapter's journal is the durability boundary, replayed by the site bridge).
 */
export async function emitAgentUsage(
  ports: Pick<AgentGatePorts, "usage" | "now" | "createRateLimiter">,
  input: {
    siteId: string;
    capability: CapabilityRecord;
    callerIdentity: string;
    idempotencyKey?: string;
  },
): Promise<void> {
  try {
    const metering = input.capability.metering;
    if (!ports.usage || !metering) return;
    const billable = !consumeFreeUnit(
      ports as AgentGatePorts,
      metering,
      input.capability.id,
      input.callerIdentity,
    );
    const record = agentUsageRecordSchema.parse({
      schema: AGENT_USAGE_SCHEMA_ID,
      siteId: input.siteId,
      capability: input.capability.id,
      callerIdentity: input.callerIdentity,
      units: 1,
      billable,
      idempotencyKey: input.idempotencyKey,
      occurredAt: ports.now().toISOString(),
    });
    ports.usage(record);
  } catch {
    // Silent drop — metering never breaks the request path.
  }
}

/**
 * Production sink — one structured `gogol.agent-usage/1` JSON line per record
 * on stdout, captured by Workers logs and drained by the site billing bridge.
 * Wired in `astro.ts` buildPorts; tests inject collectors.
 */
export function workerLogUsage(record: AgentUsageRecord): void {
  console.log(JSON.stringify(record));
}
