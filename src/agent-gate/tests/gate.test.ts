/*
<MODULE_CONTRACT>
<purpose>RFC-0290: the conformance corpus — golden request/response pairs replayed through createAgentGate with fake ports. Fixtures were written from the pinned MCP spec (2025-06-18) before the handler; the handler must satisfy them.</purpose>
<keywords>RFC-0290, RFC-0291, agent surface, gate, MCP, conformance, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP>
  <entry key="tests">initialize, ping, tools/list, tools/call (knowledge+action+errors), resources/*, method-not-found, batch rejection, GET 405, HTTP action route, rate limiting (429), identity passthrough, freshness _meta, MCP size cap.</entry>
</MODULE_MAP>
<CHANGE_SUMMARY>
  <item>RFC-0290: initial conformance corpus.</item>
  <item>RFC-0291: add rate limiting, identity, freshness, MCP size cap tests.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { createAgentGate, type AgentGatePorts, __resetLimiterCache } from "../index.ts";
import { __resetMcpLimiterCache } from "../mcp/handler.ts";
import { createFixedWindowLimiter } from "../limits.ts";
import { buildAgentSurfaceManifest } from "@warpgogol/werkstatt-shared/share/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";

const LEAD_SUBMIT: CapabilityRecord = {
  id: "lead.submit",
  version: 1,
  kind: "action",
  title: { de: "Anfrage senden", en: "Submit an inquiry" },
  description: { de: "Übermittelt eine Anfrage.", en: "Delivers an inquiry." },
  input: {
    type: "object",
    required: ["message"],
    additionalProperties: false,
    properties: { message: { type: "string", minLength: 10, maxLength: 4000 } },
  },
  output: {
    type: "object",
    additionalProperties: false,
    properties: { accepted: { type: "boolean" }, eventId: { type: "string" } },
  },
  integration: { eventKind: "lead", source: "agent" },
  requires: { entitlements: [], sections: ["send-message"] },
  humanEquivalent: { sectionType: "send-message" },
  limits: { perMinutePerIp: 10, maxPayloadBytes: 16384 },
};

function makeManifest(withAction: boolean) {
  return buildAgentSurfaceManifest({
    site: "test-bundle",
    baseUrl: "https://test.example",
    languages: { default: "de", supported: ["de", "en"] },
    knowledge: [
      { domain: "offer", url: "/api/agent/v1/offer.json", schema: "gogol.agent.knowledge/offer@1" },
    ],
    actions: withAction
      ? [
          {
            id: "lead.submit",
            url: "/api/agent/actions/lead.submit",
            title: LEAD_SUBMIT.title,
            inputSchemaRef: "#/components/schemas/lead.submit-input",
            entitlement: "agent.actions",
          },
        ]
      : [],
  });
}

function makeFakePorts(overrides: Partial<AgentGatePorts> = {}): AgentGatePorts {
  return {
    knowledge: {
      read: async (path: string) => (path === "/api/agent/v1/offer.json" ? '{"data":{}}' : null),
    },
    dispatch: { send: async (event) => ({ accepted: true, eventId: event.eventId }) },
    now: () => new Date("2026-07-05T00:00:00.000Z"),
    createRateLimiter: (maxPerWindow) => createFixedWindowLimiter(60, maxPerWindow),
    ...overrides,
  };
}

function rpc(method: string, params?: unknown, id: string | number = 1) {
  return new Request("https://test.example/api/agent/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
  });
}

async function rpcResult(res: Response) {
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
  };
  return body;
}

test("initialize: returns the pinned protocol version + serverInfo", async () => {
  const manifest = makeManifest(false);
  const gate = createAgentGate(manifest, [], makeFakePorts());
  const body = await rpcResult(await gate.handleMcp(rpc("initialize")));
  expect(body.result).toEqual({
    protocolVersion: "2025-06-18",
    capabilities: { tools: {}, resources: {} },
    serverInfo: { name: "test-bundle agent surface", version: "1.0.0" },
  });
});

test("ping: returns an empty object", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const body = await rpcResult(await gate.handleMcp(rpc("ping")));
  expect(body.result).toEqual({});
});

test("tools/list: knowledge-only manifest lists exactly one tool", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const body = await rpcResult(await gate.handleMcp(rpc("tools/list")));
  const tools = (body.result as { tools: Array<{ name: string }> }).tools;
  expect(tools.map((t) => t.name)).toEqual(["knowledge.offer.get"]);
});

test("tools/list: with an active action, lists both tools with the action's real input schema", async () => {
  const gate = createAgentGate(makeManifest(true), [LEAD_SUBMIT], makeFakePorts());
  const body = await rpcResult(await gate.handleMcp(rpc("tools/list")));
  const tools = (body.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools;
  expect(tools.map((t) => t.name)).toEqual(["knowledge.offer.get", "action.lead.submit"]);
  expect(tools[1]!.inputSchema).toEqual(LEAD_SUBMIT.input);
});

test("tools/call knowledge: returns the file contents as text", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const body = await rpcResult(
    await gate.handleMcp(rpc("tools/call", { name: "knowledge.offer.get" })),
  );
  expect(body.result).toEqual({ content: [{ type: "text", text: '{"data":{}}' }] });
});

test("tools/call action: happy path dispatches and returns accepted + eventId", async () => {
  const gate = createAgentGate(makeManifest(true), [LEAD_SUBMIT], makeFakePorts());
  const body = await rpcResult(
    await gate.handleMcp(
      rpc("tools/call", { name: "action.lead.submit", arguments: { message: "hello world!" } }),
    ),
  );
  const content = (body.result as { content: Array<{ type: string; text: string }> }).content;
  const parsed = JSON.parse(content[0]!.text) as { accepted: boolean; eventId: string };
  expect(parsed.accepted).toBe(true);
  expect(parsed.eventId).toMatch(/^[0-9a-f-]{36}$/);
});

test("tools/call action: invalid arguments return -32602 with field errors", async () => {
  const gate = createAgentGate(makeManifest(true), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleMcp(
    rpc("tools/call", { name: "action.lead.submit", arguments: { message: "short" } }),
  );
  const body = (await res.json()) as { error: { code: number; data: { errors: unknown[] } } };
  expect(body.error.code).toBe(-32602);
  expect(body.error.data.errors.length > 0).toBeTruthy();
});

test("tools/call action: dispatch failure returns a retryable server error", async () => {
  const gate = createAgentGate(
    makeManifest(true),
    [LEAD_SUBMIT],
    makeFakePorts({
      dispatch: {
        send: async () => {
          throw new Error("boom");
        },
      },
    }),
  );
  const res = await gate.handleMcp(
    rpc("tools/call", { name: "action.lead.submit", arguments: { message: "hello world!" } }),
  );
  const body = (await res.json()) as { error: { code: number; data: { retryable: boolean } } };
  expect(body.error.code).toBe(-32000);
  expect(body.error.data.retryable).toBe(true);
});

test("tools/call: unknown tool name returns -32602", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const res = await gate.handleMcp(rpc("tools/call", { name: "action.does-not-exist" }));
  const body = (await res.json()) as { error: { code: number } };
  expect(body.error.code).toBe(-32602);
});

test("resources/list: one resource per knowledge ref with an absolute uri", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const body = await rpcResult(await gate.handleMcp(rpc("resources/list")));
  expect(body.result).toEqual({
    resources: [
      {
        uri: "https://test.example/api/agent/v1/offer.json",
        name: "offer",
        mimeType: "application/json",
      },
    ],
  });
});

test("resources/read: reads the matching knowledge file by absolute uri", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const body = await rpcResult(
    await gate.handleMcp(
      rpc("resources/read", { uri: "https://test.example/api/agent/v1/offer.json" }),
    ),
  );
  expect(body.result).toEqual({
    contents: [
      {
        uri: "https://test.example/api/agent/v1/offer.json",
        mimeType: "application/json",
        text: '{"data":{}}',
      },
    ],
  });
});

test("unknown method returns -32601 method-not-found", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const res = await gate.handleMcp(rpc("prompts/list"));
  const body = (await res.json()) as { error: { code: number } };
  expect(body.error.code).toBe(-32601);
});

test("batch requests (array body) are rejected with -32600 invalid-request", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const res = await gate.handleMcp(
    new Request("https://test.example/api/agent/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]),
    }),
  );
  const body = (await res.json()) as { error: { code: number } };
  expect(res.status).toBe(200);
  expect(body.error.code).toBe(-32600);
});

test("GET is rejected with 405", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const res = await gate.handleMcp(
    new Request("https://test.example/api/agent/mcp", { method: "GET" }),
  );
  expect(res.status).toBe(405);
});

// ---------------------------------------------------------------------------
// Direct HTTP action route
// ---------------------------------------------------------------------------

test("handleAction: happy path returns 200 with the output shape", async () => {
  const gate = createAgentGate(makeManifest(true), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleAction(
    "lead.submit",
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      body: JSON.stringify({ message: "hello world!" }),
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { accepted: boolean };
  expect(body.accepted).toBe(true);
});

test("handleAction: unknown capability id returns 404", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const res = await gate.handleAction(
    "does.not.exist",
    new Request("https://test.example/api/agent/actions/does.not.exist", {
      method: "POST",
      body: "{}",
    }),
  );
  expect(res.status).toBe(404);
});

test("handleAction: schema violation returns 400", async () => {
  const gate = createAgentGate(makeManifest(true), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleAction(
    "lead.submit",
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      body: JSON.stringify({ message: "short" }),
    }),
  );
  expect(res.status).toBe(400);
});

test("handleAction: oversized payload returns 413", async () => {
  const gate = createAgentGate(makeManifest(true), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleAction(
    "lead.submit",
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      body: JSON.stringify({ message: "x".repeat(20000) }),
    }),
  );
  expect(res.status).toBe(413);
});

test("handleAction: dispatch failure returns 502", async () => {
  const gate = createAgentGate(
    makeManifest(true),
    [LEAD_SUBMIT],
    makeFakePorts({
      dispatch: {
        send: async () => {
          throw new Error("boom");
        },
      },
    }),
  );
  const res = await gate.handleAction(
    "lead.submit",
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      body: JSON.stringify({ message: "hello world!" }),
    }),
  );
  expect(res.status).toBe(502);
});

// ---------------------------------------------------------------------------
// RFC-0291: rate limiting, identity passthrough, freshness, MCP size cap
// ---------------------------------------------------------------------------

const RATE_LIMITED_CAP: CapabilityRecord = {
  ...LEAD_SUBMIT,
  limits: { perMinutePerIp: 2, maxPayloadBytes: 16384 },
};

test("handleAction: per-IP rate limit returns 429 with Retry-After after exceeding threshold", async () => {
  __resetLimiterCache();
  const gate = createAgentGate(makeManifest(true), [RATE_LIMITED_CAP], makeFakePorts());
  const req = () =>
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      headers: { "CF-Connecting-IP": "1.2.3.4" },
      body: JSON.stringify({ message: "hello world!" }),
    });
  const r1 = await gate.handleAction("lead.submit", req());
  expect(r1.status).toBe(200);
  const r2 = await gate.handleAction("lead.submit", req());
  expect(r2.status).toBe(200);
  const r3 = await gate.handleAction("lead.submit", req());
  expect(r3.status).toBe(429);
  expect(r3.headers.get("Retry-After")).toBeTruthy();
  const body = (await r3.json()) as { error: string; retryAfterSeconds: number };
  expect(body.error).toBe("rate-limited");
  expect(body.retryAfterSeconds).toBeGreaterThan(0);
});

test("handleAction: different IPs get separate rate limit buckets", async () => {
  __resetLimiterCache();
  const gate = createAgentGate(makeManifest(true), [RATE_LIMITED_CAP], makeFakePorts());
  const req = (ip: string) =>
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      headers: { "CF-Connecting-IP": ip },
      body: JSON.stringify({ message: "hello world!" }),
    });
  expect((await gate.handleAction("lead.submit", req("1.1.1.1"))).status).toBe(200);
  expect((await gate.handleAction("lead.submit", req("1.1.1.1"))).status).toBe(200);
  // Different IP — should not be affected by the first IP's bucket
  expect((await gate.handleAction("lead.submit", req("2.2.2.2"))).status).toBe(200);
});

test("handleAction: identity headers are passed through as payload._agentIdentity", async () => {
  __resetLimiterCache();
  let capturedPayload: Record<string, unknown> | undefined;
  const gate = createAgentGate(
    makeManifest(true),
    [LEAD_SUBMIT],
    makeFakePorts({
      dispatch: {
        send: async (event) => {
          capturedPayload = event.payload;
          return { accepted: true, eventId: event.eventId };
        },
      },
    }),
  );
  await gate.handleAction(
    "lead.submit",
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      headers: {
        "Signature-Agent": "test-agent/1.0",
        "User-Agent": "bot/2.0",
      },
      body: JSON.stringify({ message: "hello world!" }),
    }),
  );
  expect(capturedPayload).toBeDefined();
  expect(capturedPayload!._agentIdentity).toEqual({
    "Signature-Agent": "test-agent/1.0",
    "User-Agent": "bot/2.0",
  });
});

test("handleAction: identity headers are capped at 1KB total", async () => {
  __resetLimiterCache();
  let capturedPayload: Record<string, unknown> | undefined;
  const gate = createAgentGate(
    makeManifest(true),
    [LEAD_SUBMIT],
    makeFakePorts({
      dispatch: {
        send: async (event) => {
          capturedPayload = event.payload;
          return { accepted: true, eventId: event.eventId };
        },
      },
    }),
  );
  const hugeValue = "x".repeat(2000);
  await gate.handleAction(
    "lead.submit",
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      headers: { "User-Agent": hugeValue },
      body: JSON.stringify({ message: "hello world!" }),
    }),
  );
  expect(capturedPayload).toBeDefined();
  const identity = capturedPayload!._agentIdentity as Record<string, string>;
  expect(identity["User-Agent"].length).toBeLessThanOrEqual(1024);
});

test("tools/call knowledge: freshness is present in _meta when envelope carries it", async () => {
  const gate = createAgentGate(
    makeManifest(false),
    [],
    makeFakePorts({
      knowledge: {
        read: async () =>
          JSON.stringify({
            domain: "offer",
            schema: "gogol.agent.knowledge/offer@1",
            contentHash: "abc123",
            freshness: { lastVerified: "2026-07-01", source: "ckl" },
            data: {},
          }),
      },
    }),
  );
  const body = await rpcResult(
    await gate.handleMcp(rpc("tools/call", { name: "knowledge.offer.get" })),
  );
  const result = body.result as { _meta?: { "gogol.dev/freshness"?: unknown } };
  expect(result._meta).toBeDefined();
  expect(result._meta!["gogol.dev/freshness"]).toEqual({
    lastVerified: "2026-07-01",
    source: "ckl",
  });
});

test("resources/read: freshness is present in _meta when envelope carries it", async () => {
  const gate = createAgentGate(
    makeManifest(false),
    [],
    makeFakePorts({
      knowledge: {
        read: async () =>
          JSON.stringify({
            domain: "offer",
            schema: "gogol.agent.knowledge/offer@1",
            contentHash: "abc123",
            freshness: { lastVerified: "2026-07-01", source: "ckl" },
            data: {},
          }),
      },
    }),
  );
  const body = await rpcResult(
    await gate.handleMcp(
      rpc("resources/read", { uri: "https://test.example/api/agent/v1/offer.json" }),
    ),
  );
  const result = body.result as { _meta?: { "gogol.dev/freshness"?: unknown } };
  expect(result._meta).toBeDefined();
  expect(result._meta!["gogol.dev/freshness"]).toEqual({
    lastVerified: "2026-07-01",
    source: "ckl",
  });
});

test("tools/call action: MCP path enforces per-IP rate limit", async () => {
  __resetMcpLimiterCache();
  __resetLimiterCache();
  const gate = createAgentGate(makeManifest(true), [RATE_LIMITED_CAP], makeFakePorts());
  const req = (ip: string) =>
    new Request("https://test.example/api/agent/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "action.lead.submit", arguments: { message: "hello world!" } },
      }),
    });
  expect((await gate.handleMcp(req("1.1.1.1"))).status).toBe(200);
  expect((await gate.handleMcp(req("1.1.1.1"))).status).toBe(200);
  const r3 = await gate.handleMcp(req("1.1.1.1"));
  const body = (await r3.json()) as {
    error: { code: number; data: { retryable: boolean; retryAfterSeconds: number } };
  };
  expect(body.error.code).toBe(-32000);
  expect(body.error.data.retryable).toBe(true);
  expect(body.error.data.retryAfterSeconds).toBeGreaterThan(0);
});

test("tools/call action: MCP path enforces payload size cap", async () => {
  const gate = createAgentGate(makeManifest(true), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleMcp(
    rpc("tools/call", {
      name: "action.lead.submit",
      arguments: { message: "x".repeat(20000) },
    }),
  );
  const body = (await res.json()) as { error: { code: number; data: { retryable: boolean } } };
  expect(body.error.code).toBe(-32000);
  expect(body.error.data.retryable).toBe(false);
});
