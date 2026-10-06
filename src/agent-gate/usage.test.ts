/*
<MODULE_CONTRACT>
<purpose>
RFC-1212 AC-5/AC-6 tests: a dispatched metered call journals exactly one
AgentUsageRecord (capability id + caller identity + free-window verdict);
unmetered, preview ("none"), dispatch-failed, and replayed calls emit none.
</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1212: initial test coverage.</item>
</CHANGE_SUMMARY>
*/

import { beforeEach, test, expect } from "vitest";
import { executeAction } from "./action-pipeline.ts";
import { __resetFreeWindowCache } from "./usage.ts";
import { createFixedWindowLimiter } from "./limits.ts";
import { buildAgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";
import type { AgentUsageRecord } from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import type { AgentGatePorts } from "./ports.ts";

const MANIFEST = buildAgentSurfaceManifest({
  generatedAt: "2026-01-01T00:00:00.000Z",
  site: "test-site",
  baseUrl: "https://test.example",
  languages: { default: "en", supported: ["en"] },
});

const METERED: CapabilityRecord = {
  id: "quote.submit",
  version: 1,
  kind: "action",
  sideEffect: "write",
  title: { en: "Submit a quote" },
  description: { en: "Creates a quote request." },
  input: {
    type: "object",
    additionalProperties: false,
    properties: { email: { type: "string" } },
  },
  output: {
    type: "object",
    additionalProperties: false,
    properties: { receiptId: { type: "string" } },
  },
  requires: { entitlements: ["agent.actions", "quote.paid"], sections: [] },
  integration: { eventKind: "lead", source: "agent" },
  limits: { perMinutePerIp: 10, maxPayloadBytes: 10240 },
  metering: {
    product: "agent-services.quote-run",
    unit: "invocation",
    pricePerUnit: { amount: 0.05, currency: "EUR" },
    freeUnitsPerWindow: 2,
    window: "month",
  },
};

const UNMETERED: CapabilityRecord = { ...METERED, id: "lead.submit", metering: undefined };

const PREVIEW_METERED: CapabilityRecord = {
  ...METERED,
  id: "quote.prepare",
  sideEffect: "none",
};

function ports(collector: AgentUsageRecord[], dispatchFails = false): AgentGatePorts {
  return {
    knowledge: { read: async () => null },
    dispatch: {
      send: async (event) => {
        if (dispatchFails) throw new Error("transport down");
        return {
          receiptId: event.eventId,
          status: "accepted" as const,
          duplicate: false,
          submittedAt: "2026-01-01T00:00:00.000Z",
        };
      },
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    usage: (r) => collector.push(r),
    createRateLimiter: (max, windowSeconds = 60) => createFixedWindowLimiter(windowSeconds, max),
  };
}

function run(
  capability: CapabilityRecord,
  collector: AgentUsageRecord[],
  opts: { dispatchFails?: boolean; verified?: string; idempotencyKey?: string } = {},
) {
  return executeAction({
    capability,
    manifest: MANIFEST,
    ports: ports(collector, opts.dispatchFails),
    validatedValue: { email: "agent@example.com" },
    agentIdentity: opts.verified ? { verifiedAgentId: opts.verified } : {},
    idempotencyKey: opts.idempotencyKey,
    bodyHash: "abc",
  });
}

beforeEach(() => __resetFreeWindowCache());

test("AC-5: a dispatched metered call emits exactly one AgentUsageRecord", async () => {
  const records: AgentUsageRecord[] = [];
  const result = await run(METERED, records, {
    verified: "agent-42",
    idempotencyKey: "key-1",
  });
  expect(result.kind).toBe("receipt");
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    schema: "gogol.agent-usage/1",
    siteId: "test-site",
    capability: "quote.submit",
    callerIdentity: "agent-42",
    units: 1,
    idempotencyKey: "key-1",
  });
});

test("AC-5: anonymous callers carry callerIdentity anonymous", async () => {
  const records: AgentUsageRecord[] = [];
  await run(METERED, records);
  expect(records[0]!.callerIdentity).toBe("anonymous");
});

test("AC-5: free allowance window marks early calls non-billable, then billable", async () => {
  const records: AgentUsageRecord[] = [];
  await run(METERED, records, { verified: "agent-42" });
  await run(METERED, records, { verified: "agent-42" });
  await run(METERED, records, { verified: "agent-42" });
  expect(records.map((r) => r.billable)).toEqual([false, false, true]);
});

test("AC-6: an unmetered capability emits no usage record", async () => {
  const records: AgentUsageRecord[] = [];
  const result = await run(UNMETERED, records);
  expect(result.kind).toBe("receipt");
  expect(records).toHaveLength(0);
});

test("AC-6: a dispatch failure emits no usage record", async () => {
  const records: AgentUsageRecord[] = [];
  const result = await run(METERED, records, { dispatchFails: true });
  expect(result.kind).toBe("problem");
  expect(records).toHaveLength(0);
});

test("AC-6: a preview capability never dispatches → no usage record", async () => {
  const records: AgentUsageRecord[] = [];
  const result = await run(PREVIEW_METERED, records);
  expect(result.kind).toBe("preview");
  expect(records).toHaveLength(0);
});

test("no usage port → metering drops silently and the call still succeeds", async () => {
  const result = await executeAction({
    capability: METERED,
    manifest: MANIFEST,
    ports: {
      knowledge: { read: async () => null },
      dispatch: {
        send: async (event) => ({
          receiptId: event.eventId,
          status: "accepted" as const,
          duplicate: false,
          submittedAt: "2026-01-01T00:00:00.000Z",
        }),
      },
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    },
    validatedValue: { email: "a@b.c" },
    agentIdentity: {},
  });
  expect(result.kind).toBe("receipt");
});
