/*
<MODULE_CONTRACT>
<purpose>
RFC-1172: telemetry emission coverage — the adapter-side exactly-once
contract (AC-1), duplicate replay flag (AC-3), rate-limit status (AC-4),
negotiated MCP version (AC-5), response invariance + silent-drop semantics
(AC-6), and the PII-free payload boundary. Mirrors how `astro.ts`'s
withTrafficEmit composes gate call + emitAgentTraffic.
</purpose>
<non-goals>
  <item>Do not import astro.ts — it imports astro:env/server and is test-adjacency exempt.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1172: initial telemetry test suite.</item>
  <item>RFC-1172: closed agent.traffic telemetry — ports.telemetry sink, TrafficRecorder + boundary emit via withTrafficEmit</item>
</CHANGE_SUMMARY>
*/

import { beforeEach, describe, expect, test } from "vitest";

import { buildAgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";
import type { AgentTrafficEvent } from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";

import { createAgentGate, __resetLimiterCache } from "./index.ts";
import type { AgentGatePorts } from "./ports.ts";
import { createFixedWindowLimiter } from "./limits.ts";
import { httpBodyHash } from "./action-pipeline.ts";
import { deriveTrafficStatus, emitAgentTraffic, type TrafficRecorder } from "./telemetry.ts";

const LEAD_SUBMIT: CapabilityRecord = {
  id: "lead.submit",
  version: 2,
  kind: "action",
  sideEffect: "write",
  title: { de: "Anfrage senden", en: "Send an inquiry" },
  description: { de: "Sendet eine Anfrage.", en: "Sends an inquiry." },
  input: {
    type: "object",
    required: ["message"],
    additionalProperties: false,
    properties: { message: { type: "string", minLength: 10, maxLength: 4000 } },
  },
  output: {
    type: "object",
    required: ["receiptId"],
    additionalProperties: false,
    properties: { receiptId: { type: "string" } },
  },
  integration: { eventKind: "lead", source: "agent" },
  requires: { entitlements: [], sections: ["send-message"] },
  humanEquivalent: { sectionType: "send-message" },
  limits: { perMinutePerIp: 10, maxPayloadBytes: 16384 },
};

function makeManifest() {
  return buildAgentSurfaceManifest({
    generatedAt: "2026-01-01T00:00:00.000Z",
    site: "test-bundle",
    baseUrl: "https://test.example",
    languages: { default: "de", supported: ["de"] },
    knowledge: [
      { domain: "offer", url: "/api/agent/v1/offer.json", schema: "gogol.agent.knowledge/offer@1" },
    ],
    actions: [
      {
        id: "lead.submit",
        url: "/api/agent/v1/actions/lead.submit",
        title: LEAD_SUBMIT.title,
        inputSchemaRef: "#/components/schemas/lead.submit-input",
        entitlement: "agent.actions",
      },
    ],
  });
}

const PROTOCOL_VERSION_META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };

beforeEach(() => {
  // The gate keeps a module-global limiter cache — reset so fake factories apply.
  __resetLimiterCache();
});

function rpc(method: string, params?: unknown, id: string | number = 1) {
  const p = (params ?? {}) as Record<string, unknown>;
  const meta = { ...PROTOCOL_VERSION_META, ...((p._meta as Record<string, unknown>) ?? {}) };
  return new Request("https://test.example/api/agent/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "Signature-Agent": "test-agent/1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...p, _meta: meta } }),
  });
}

function actionRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://test.example/api/agent/v1/actions/lead.submit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Signature-Agent": "test-agent/1.0",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

interface Collect {
  events: AgentTrafficEvent[];
  ports: AgentGatePorts;
}

/** Ports with the telemetry collector the adapter's boundary emit targets. */
function makeCollectPorts(overrides: Partial<AgentGatePorts> = {}): Collect {
  const events: AgentTrafficEvent[] = [];
  const ports: AgentGatePorts = {
    knowledge: {
      read: async (path: string) => (path === "/api/agent/v1/offer.json" ? '{"data":{}}' : null),
    },
    dispatch: {
      send: async (event) => ({
        receiptId: event.eventId,
        status: "accepted" as const,
        duplicate: false,
        submittedAt: "2026-07-05T00:00:00.000Z",
      }),
    },
    now: () => new Date("2026-07-05T00:00:00.000Z"),
    createRateLimiter: (maxPerWindow) => createFixedWindowLimiter(60, maxPerWindow),
    telemetry: (e) => events.push(e),
    ...overrides,
  };
  return { events, ports };
}

/** Mirror of astro.ts withTrafficEmit — boundary emit after the gate call. */
async function emitBoundary(
  collect: Collect,
  protocol: AgentTrafficEvent["protocol"],
  response: Response,
  traffic: TrafficRecorder,
  durationMs = 7,
) {
  await emitAgentTraffic(collect.ports, {
    systemId: "test-bundle",
    protocol,
    response,
    traffic,
    durationMs,
  });
}

describe("boundary emit — exactly once per terminal path (AC-1)", () => {
  test("action success → one success event with capability + observed identity", async () => {
    const collect = makeCollectPorts();
    const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], collect.ports);
    const traffic: TrafficRecorder = {};
    const res = await gate.handleAction(
      "lead.submit",
      actionRequest({ message: "Please send me a proposal." }),
      traffic,
    );
    await emitBoundary(collect, "http", res, traffic);

    expect(collect.events).toHaveLength(1);
    const e = collect.events[0]!;
    expect(e).toMatchObject({
      type: "werkstatt.agent.traffic",
      systemId: "test-bundle",
      protocol: "http",
      operation: "action.call",
      capability: "lead.submit",
      status: "success",
      durationMs: 7,
    });
    expect(e.observedIdentity).toEqual({ "Signature-Agent": "test-agent/1.0" });
  });

  test("action problem (unknown capability) → one rejected event with problemKind", async () => {
    const collect = makeCollectPorts();
    const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], collect.ports);
    const traffic: TrafficRecorder = {};
    const res = await gate.handleAction(
      "ghost.cap",
      actionRequest({ message: "Please send me a proposal." }),
      traffic,
    );
    await emitBoundary(collect, "http", res, traffic);

    expect(collect.events).toHaveLength(1);
    expect(collect.events[0]).toMatchObject({
      operation: "action.call",
      capability: "ghost.cap",
      status: "rejected",
    });
    expect(collect.events[0]!.problemKind).toBeTruthy();
  });

  test("MCP tools/list → one success event", async () => {
    const collect = makeCollectPorts();
    const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], collect.ports);
    const traffic: TrafficRecorder = {};
    const res = await gate.handleMcp(rpc("tools/list"), traffic);
    await emitBoundary(collect, "mcp", res, traffic);

    expect(collect.events).toHaveLength(1);
    expect(collect.events[0]).toMatchObject({
      protocol: "mcp",
      operation: "tools/list",
      capability: "tools/list",
      status: "success",
    });
  });

  test("MCP method-not-found → rejected inside 200 envelope", async () => {
    const collect = makeCollectPorts();
    const gate = createAgentGate(makeManifest(), [], collect.ports);
    const traffic: TrafficRecorder = {};
    const res = await gate.handleMcp(rpc("unknown/method"), traffic);
    await emitBoundary(collect, "mcp", res, traffic);

    expect(collect.events).toHaveLength(1);
    expect(collect.events[0]).toMatchObject({
      operation: "other",
      capability: "unknown/method",
      status: "rejected",
      problemKind: "json-rpc:-32601",
    });
  });

  test("malformed JSON → rejected", async () => {
    const collect = makeCollectPorts();
    const gate = createAgentGate(makeManifest(), [], collect.ports);
    const traffic: TrafficRecorder = {};
    const res = await gate.handleMcp(
      new Request("https://test.example/api/agent/mcp", { method: "POST", body: "not-json" }),
      traffic,
    );
    await emitBoundary(collect, "mcp", res, traffic);

    expect(collect.events).toHaveLength(1);
    expect(collect.events[0]).toMatchObject({ operation: "other", status: "rejected" });
  });
});

describe("duplicate replay (AC-3)", () => {
  test("stored-receipt replay emits duplicate: true", async () => {
    const body = { message: "Please send me a proposal." };
    const raw = JSON.stringify(body);
    const receipt = {
      receiptId: "r-1",
      status: "accepted" as const,
      duplicate: false,
      submittedAt: "2026-07-05T00:00:00.000Z",
    };
    const collect = makeCollectPorts({
      idempotency: {
        get: async () => ({ receipt, bodyHash: httpBodyHash(raw) }),
        put: async () => {},
      },
    });
    const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], collect.ports);
    const traffic: TrafficRecorder = {};
    const res = await gate.handleAction(
      "lead.submit",
      new Request("https://test.example/api/agent/v1/actions/lead.submit", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "key-1" },
        body: raw,
      }),
      traffic,
    );
    expect((await res.json()).status).toBe("duplicate");
    await emitBoundary(collect, "http", res, traffic);

    expect(collect.events).toHaveLength(1);
    expect(collect.events[0]).toMatchObject({ operation: "action.call", duplicate: true });
  });
});

describe("rate-limit status (AC-4)", () => {
  test("limiter deny → status rate-limited", async () => {
    const collect = makeCollectPorts({
      createRateLimiter: () => ({
        check: () => ({ allowed: false, retryAfterSeconds: 30 }),
      }),
    });
    const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], collect.ports);
    const traffic: TrafficRecorder = {};
    const res = await gate.handleAction(
      "lead.submit",
      actionRequest({ message: "Please send me a proposal." }),
      traffic,
    );
    expect(res.status).toBe(429);
    await emitBoundary(collect, "http", res, traffic);

    expect(collect.events).toHaveLength(1);
    expect(collect.events[0]).toMatchObject({ status: "rate-limited" });
  });
});

describe("negotiated MCP version (AC-5)", () => {
  test("tools/call carries mcpProtocolVersion from _meta", async () => {
    const collect = makeCollectPorts();
    const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], collect.ports);
    const traffic: TrafficRecorder = {};
    const res = await gate.handleMcp(rpc("tools/call", { name: "knowledge.offer.get" }), traffic);
    await emitBoundary(collect, "mcp", res, traffic);

    expect(collect.events[0]).toMatchObject({
      operation: "tools/call",
      capability: "knowledge.offer.get",
      mcpProtocolVersion: "2026-07-28",
    });
  });
});

describe("emission never alters the response (AC-6)", () => {
  test("response identical with telemetry on vs off", async () => {
    const on = makeCollectPorts();
    const off = makeCollectPorts({ telemetry: undefined });
    const mk = (ports: AgentGatePorts) => createAgentGate(makeManifest(), [LEAD_SUBMIT], ports);
    const req = () => actionRequest({ message: "Please send me a proposal." });

    const resOn = await mk(on.ports).handleAction("lead.submit", req(), {});
    const resOff = await mk(off.ports).handleAction("lead.submit", req(), {});

    expect(resOn.status).toBe(resOff.status);
    // receiptId is random per request — compare the deterministic fields.
    const { receiptId: _on, ...bodyOn } = (await resOn.json()) as Record<string, unknown>;
    const { receiptId: _off, ...bodyOff } = (await resOff.json()) as Record<string, unknown>;
    expect(bodyOn).toEqual(bodyOff);
  });

  test("throwing sink is swallowed", async () => {
    const collect = makeCollectPorts({
      telemetry: () => {
        throw new Error("sink exploded");
      },
    });
    const traffic: TrafficRecorder = { operation: "health" };
    await emitBoundary(collect, "http", new Response("{}", { status: 200 }), traffic);
    expect(collect.events).toHaveLength(0); // drop, not throw
  });

  test("no telemetry port → silent no-op", async () => {
    const collect = makeCollectPorts({ telemetry: undefined });
    await emitBoundary(collect, "http", new Response("{}", { status: 200 }), {
      operation: "health",
    });
    expect(collect.events).toHaveLength(0);
  });

  test("unset operation → no event (never emit a fake value)", async () => {
    const collect = makeCollectPorts();
    await emitBoundary(collect, "mcp", new Response("{}", { status: 200 }), {});
    expect(collect.events).toHaveLength(0);
  });
});

describe("PII boundary", () => {
  test("event JSON carries no request payload", async () => {
    const collect = makeCollectPorts();
    const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], collect.ports);
    const traffic: TrafficRecorder = {};
    const res = await gate.handleAction(
      "lead.submit",
      actionRequest({ message: "Please send me a proposal — secret details" }),
      traffic,
    );
    await emitBoundary(collect, "http", res, traffic);

    const line = JSON.stringify(collect.events[0]);
    expect(line).not.toContain("secret details");
    expect(line).not.toContain("message");
  });
});

describe("deriveTrafficStatus", () => {
  test("2xx → success; 429 → rate-limited; 4xx → rejected; 5xx → failure", () => {
    expect(deriveTrafficStatus(new Response(null, { status: 200 }))).toBe("success");
    expect(deriveTrafficStatus(new Response(null, { status: 202 }))).toBe("success");
    expect(deriveTrafficStatus(new Response(null, { status: 429 }))).toBe("rate-limited");
    expect(deriveTrafficStatus(new Response(null, { status: 400 }))).toBe("rejected");
    expect(deriveTrafficStatus(new Response(null, { status: 404 }))).toBe("rejected");
    expect(deriveTrafficStatus(new Response(null, { status: 502 }))).toBe("failure");
  });
});
