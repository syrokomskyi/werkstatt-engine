/*
<MODULE_CONTRACT>
<purpose>RFC-0290: the conformance corpus — golden request/response pairs replayed through createAgentGate with fake ports. Fixtures were written from the pinned MCP spec before the handler; the handler must satisfy them. RFC-1113: the corpus speaks the 2026-07-28 stateless era — every request carries _meta["io.modelcontextprotocol/protocolVersion"].</purpose>
<keywords>RFC-0290, RFC-0291, RFC-1113, agent surface, gate, MCP, conformance, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP>
  <entry key="tests">server/discover, initialize rejection, per-request version gate, header consistency, ping, tools/list, tools/call (knowledge+action+errors), resources/*, method-not-found, batch rejection, GET 405, HTTP action route, rate limiting (429), identity passthrough, freshness _meta, MCP size cap.</entry>
</MODULE_MAP>
<CHANGE_SUMMARY>
  <item>RFC-0290: initial conformance corpus.</item>
  <item>RFC-0291: add rate limiting, identity, freshness, MCP size cap tests.</item>
  <item>RFC-1113: 2026-07-28 stateless era — _meta version on every request, server/discover, initialize → UnsupportedProtocolVersionError, header consistency.</item>
  <item>RFC-1113: align agent discovery surface with RFC 9727 and MCP 2026-07-28 stateless era</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { createAgentGate, type AgentGatePorts, __resetLimiterCache } from "../index.ts";
import { __resetMcpLimiterCache } from "../mcp/handler.ts";
import { createFixedWindowLimiter } from "../limits.ts";
import { buildAgentSurfaceManifest, type ActionReceipt } from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";

const LEAD_SUBMIT: CapabilityRecord = {
  id: "lead.submit",
  version: 2,
  kind: "action",
  sideEffect: "write",
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
    required: ["receiptId", "status", "duplicate", "submittedAt"],
    additionalProperties: false,
    properties: {
      receiptId: { type: "string", format: "uuid" },
      status: { type: "string" },
      duplicate: { type: "boolean" },
      submittedAt: { type: "string" },
    },
  },
  integration: { eventKind: "lead", source: "agent" },
  requires: { entitlements: [], sections: ["send-message"] },
  humanEquivalent: { sectionType: "send-message" },
  limits: { perMinutePerIp: 10, maxPayloadBytes: 16384 },
};

/** RFC-1112: side-effect-free preview capability (no integration, no humanEquivalent). */
const LEAD_PREPARE: CapabilityRecord = {
  id: "lead.prepare",
  version: 1,
  kind: "action",
  sideEffect: "none",
  title: { de: "Anfrage prüfen", en: "Preview an inquiry" },
  description: { de: "Prüft eine Anfrage.", en: "Validates an inquiry." },
  input: {
    type: "object",
    required: ["message"],
    additionalProperties: false,
    properties: { message: { type: "string", minLength: 10, maxLength: 4000 } },
  },
  output: {
    type: "object",
    required: ["valid", "draftId"],
    additionalProperties: false,
    properties: {
      valid: { type: "boolean" },
      draftId: { type: "string" },
    },
  },
  requires: { entitlements: [], sections: [] },
  limits: { perMinutePerIp: 10, maxPayloadBytes: 16384 },
};

function makeManifest(withAction: boolean) {
  return buildAgentSurfaceManifest({
    generatedAt: "2026-01-01T00:00:00.000Z",
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
    ...overrides,
  };
}

/** RFC-1113: the _meta key + version every modern request declares. */
const PROTOCOL_VERSION_META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };

function rpc(method: string, params?: unknown, id: string | number = 1) {
  const p = (params ?? {}) as Record<string, unknown>;
  const meta = { ...PROTOCOL_VERSION_META, ...((p._meta as Record<string, unknown>) ?? {}) };
  return new Request("https://test.example/api/agent/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...p, _meta: meta } }),
  });
}

/** Raw request without the injected _meta version — for version-gate tests. */
function rawRpc(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://test.example/api/agent/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
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

test("server/discover: returns supportedVersions + capabilities + serverInfo", async () => {
  const manifest = makeManifest(false);
  const gate = createAgentGate(manifest, [], makeFakePorts());
  const body = await rpcResult(await gate.handleMcp(rpc("server/discover")));
  expect(body.result).toEqual({
    resultType: "complete",
    supportedVersions: ["2026-07-28"],
    capabilities: { tools: {}, resources: {} },
    _meta: {
      "io.modelcontextprotocol/serverInfo": {
        name: "test-bundle agent surface",
        version: "2.0.0",
      },
    },
  });
});

test("server/discover: answers even without a declared protocol version", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const res = await gate.handleMcp(rawRpc({ jsonrpc: "2.0", id: 1, method: "server/discover" }));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result: { supportedVersions: string[] } };
  expect(body.result.supportedVersions).toEqual(["2026-07-28"]);
});

test("initialize: legacy handshake returns UnsupportedProtocolVersionError naming supported versions", async () => {
  const manifest = makeManifest(false);
  const gate = createAgentGate(manifest, [], makeFakePorts());
  const res = await gate.handleMcp(
    rawRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    }),
  );
  expect(res.status).toBe(400);
  const body = (await res.json()) as {
    error: { code: number; data: { supported: string[]; requested: string } };
  };
  expect(body.error.code).toBe(-32022);
  expect(body.error.data.supported).toEqual(["2026-07-28"]);
  expect(body.error.data.requested).toBe("2025-06-18");
});

test("version gate: missing _meta protocol version → -32022 + HTTP 400", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const res = await gate.handleMcp(rawRpc({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }));
  expect(res.status).toBe(400);
  const body = (await res.json()) as {
    error: { code: number; data: { supported: string[]; requested: null } };
  };
  expect(body.error.code).toBe(-32022);
  expect(body.error.data.supported).toEqual(["2026-07-28"]);
  expect(body.error.data.requested).toBeNull();
});

test("version gate: unsupported _meta protocol version → -32022 + HTTP 400", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const res = await gate.handleMcp(
    rawRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2025-11-25" } },
    }),
  );
  expect(res.status).toBe(400);
  const body = (await res.json()) as {
    error: { code: number; data: { supported: string[]; requested: string } };
  };
  expect(body.error.code).toBe(-32022);
  expect(body.error.data.requested).toBe("2025-11-25");
});

test("version gate: MCP-Protocol-Version header matching _meta → request proceeds", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const res = await gate.handleMcp(
    rawRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
      },
      { "MCP-Protocol-Version": "2026-07-28" },
    ),
  );
  expect(res.status).toBe(200);
});

test("version gate: MCP-Protocol-Version header mismatching _meta → 400", async () => {
  const gate = createAgentGate(makeManifest(false), [], makeFakePorts());
  const res = await gate.handleMcp(
    rawRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
      },
      { "MCP-Protocol-Version": "2025-11-25" },
    ),
  );
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: { code: number } };
  expect(body.error.code).toBe(-32600);
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

test("tools/call action: happy path dispatches and returns an ActionReceipt", async () => {
  const gate = createAgentGate(makeManifest(true), [LEAD_SUBMIT], makeFakePorts());
  const body = await rpcResult(
    await gate.handleMcp(
      rpc("tools/call", { name: "action.lead.submit", arguments: { message: "hello world!" } }),
    ),
  );
  const content = (body.result as { content: Array<{ type: string; text: string }> }).content;
  const parsed = JSON.parse(content[0]!.text) as {
    receiptId: string;
    status: string;
    duplicate: boolean;
    submittedAt: string;
  };
  expect(parsed.status).toBe("accepted");
  expect(parsed.duplicate).toBe(false);
  expect(parsed.receiptId).toMatch(/^[0-9a-f-]{36}$/);
  expect(parsed.submittedAt).toBe("2026-07-05T00:00:00.000Z");
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

test("handleAction: happy path returns 200 with an ActionReceipt", async () => {
  const gate = createAgentGate(makeManifest(true), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleAction(
    "lead.submit",
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      body: JSON.stringify({ message: "hello world!" }),
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    receiptId: string;
    status: string;
    duplicate: boolean;
    submittedAt: string;
  };
  expect(body.status).toBe("accepted");
  expect(body.duplicate).toBe(false);
  expect(body.receiptId).toMatch(/^[0-9a-f-]{36}$/);
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

test("handleAction: schema violation returns 422 problem+json", async () => {
  const gate = createAgentGate(makeManifest(true), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleAction(
    "lead.submit",
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      body: JSON.stringify({ message: "short" }),
    }),
  );
  expect(res.status).toBe(422);
  expect(res.headers.get("content-type")).toBe("application/problem+json");
  const body = (await res.json()) as { code: string; retryable: boolean; errors: unknown[] };
  expect(body.code).toBe("schema-violation");
  expect(body.retryable).toBe(false);
  expect(body.errors.length > 0).toBeTruthy();
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

test("handleAction: dispatch failure returns 502 problem+json", async () => {
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
  const body = (await res.json()) as { code: string; retryable: boolean };
  expect(body.code).toBe("dispatch-failed");
  expect(body.retryable).toBe(true);
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
  const body = (await r3.json()) as { code: string; retryAfterSeconds: number };
  expect(body.code).toBe("rate-limited");
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
          return {
            receiptId: event.eventId,
            status: "accepted" as const,
            duplicate: false,
            submittedAt: "2026-07-05T00:00:00.000Z",
          };
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
          return {
            receiptId: event.eventId,
            status: "accepted" as const,
            duplicate: false,
            submittedAt: "2026-07-05T00:00:00.000Z",
          };
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
        params: {
          name: "action.lead.submit",
          arguments: { message: "hello world!" },
          _meta: PROTOCOL_VERSION_META,
        },
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

// ---------------------------------------------------------------------------
// RFC-1112: idempotency, receipts, preview capabilities
// ---------------------------------------------------------------------------

/** In-memory receipt store fake for the idempotency port. */
function makeMemoryStore() {
  const map = new Map<string, { receipt: ActionReceipt; bodyHash: string }>();
  return {
    map,
    get: async (key: string) => map.get(key) ?? null,
    put: async (key: string, bodyHash: string, receipt: ActionReceipt) => {
      map.set(key, { receipt, bodyHash });
    },
  };
}

test("handleAction: Idempotency-Key replay returns the stored receipt as duplicate", async () => {
  __resetLimiterCache();
  const store = makeMemoryStore();
  let dispatchCount = 0;
  const gate = createAgentGate(
    makeManifest(true),
    [LEAD_SUBMIT],
    makeFakePorts({
      idempotency: store,
      dispatch: {
        send: async (event) => {
          dispatchCount += 1;
          return {
            receiptId: event.eventId,
            status: "accepted" as const,
            duplicate: false,
            submittedAt: "2026-07-05T00:00:00.000Z",
          };
        },
      },
    }),
  );
  const req = () =>
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      headers: { "Idempotency-Key": "key-1" },
      body: JSON.stringify({ message: "hello world!" }),
    });
  const r1 = await gate.handleAction("lead.submit", req());
  expect(r1.status).toBe(200);
  const first = (await r1.json()) as { receiptId: string; duplicate: boolean };
  expect(first.duplicate).toBe(false);

  const r2 = await gate.handleAction("lead.submit", req());
  expect(r2.status).toBe(200);
  const second = (await r2.json()) as { receiptId: string; status: string; duplicate: boolean };
  expect(second.receiptId).toBe(first.receiptId);
  expect(second.status).toBe("duplicate");
  expect(second.duplicate).toBe(true);
  expect(dispatchCount).toBe(1);
});

test("handleAction: same Idempotency-Key with a different body returns 409", async () => {
  __resetLimiterCache();
  const store = makeMemoryStore();
  const gate = createAgentGate(
    makeManifest(true),
    [LEAD_SUBMIT],
    makeFakePorts({ idempotency: store }),
  );
  const req = (message: string) =>
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      headers: { "Idempotency-Key": "key-2" },
      body: JSON.stringify({ message }),
    });
  await gate.handleAction("lead.submit", req("hello world!"));
  const res = await gate.handleAction("lead.submit", req("a different message"));
  expect(res.status).toBe(409);
  const body = (await res.json()) as { code: string; retryable: boolean };
  expect(body.code).toBe("idempotency-key-reuse");
  expect(body.retryable).toBe(false);
});

test("handleAction: Idempotency-Key derives a deterministic eventId", async () => {
  __resetLimiterCache();
  const eventIds: string[] = [];
  const gate = createAgentGate(
    makeManifest(true),
    [LEAD_SUBMIT],
    makeFakePorts({
      dispatch: {
        send: async (event) => {
          eventIds.push(event.eventId);
          return {
            receiptId: event.eventId,
            status: "accepted" as const,
            duplicate: false,
            submittedAt: "2026-07-05T00:00:00.000Z",
          };
        },
      },
    }),
  );
  const req = (key: string) =>
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({ message: "hello world!" }),
    });
  await gate.handleAction("lead.submit", req("same-key"));
  await gate.handleAction("lead.submit", req("same-key"));
  await gate.handleAction("lead.submit", req("other-key"));
  // No store → each request dispatches, but same key → same eventId.
  expect(eventIds[0]).toBe(eventIds[1]);
  expect(eventIds[0]).not.toBe(eventIds[2]);
  expect(eventIds[0]).toMatch(/^[0-9a-f-]{36}$/);
});

test("handleAction: no idempotency port → X-Agent-Idempotency: disabled", async () => {
  __resetLimiterCache();
  const gate = createAgentGate(makeManifest(true), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleAction(
    "lead.submit",
    new Request("https://test.example/api/agent/actions/lead.submit", {
      method: "POST",
      headers: { "Idempotency-Key": "key-3" },
      body: JSON.stringify({ message: "hello world!" }),
    }),
  );
  expect(res.headers.get("X-Agent-Idempotency")).toBe("disabled");
});

test("handleAction: sideEffect none capability returns a preview draftId without dispatching", async () => {
  __resetLimiterCache();
  let dispatched = false;
  const manifest = buildAgentSurfaceManifest({
    generatedAt: "2026-01-01T00:00:00.000Z",
    site: "test-bundle",
    baseUrl: "https://test.example",
    languages: { default: "de", supported: ["de", "en"] },
    knowledge: [],
    actions: [
      {
        id: "lead.prepare",
        url: "/api/agent/actions/lead.prepare",
        title: LEAD_PREPARE.title,
        inputSchemaRef: "#/components/schemas/lead.prepare-input",
        entitlement: "agent.actions",
      },
    ],
  });
  const gate = createAgentGate(
    manifest,
    [LEAD_PREPARE],
    makeFakePorts({
      dispatch: {
        send: async () => {
          dispatched = true;
          throw new Error("must not be called");
        },
      },
    }),
  );
  const res = await gate.handleAction(
    "lead.prepare",
    new Request("https://test.example/api/agent/actions/lead.prepare", {
      method: "POST",
      body: JSON.stringify({ message: "hello world!" }),
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { valid: boolean; draftId: string };
  expect(body.valid).toBe(true);
  expect(body.draftId).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(dispatched).toBe(false);
});

test("tools/call action: _meta idempotency key replays via MCP", async () => {
  __resetMcpLimiterCache();
  __resetLimiterCache();
  const store = makeMemoryStore();
  let dispatchCount = 0;
  const gate = createAgentGate(
    makeManifest(true),
    [LEAD_SUBMIT],
    makeFakePorts({
      idempotency: store,
      dispatch: {
        send: async (event) => {
          dispatchCount += 1;
          return {
            receiptId: event.eventId,
            status: "accepted" as const,
            duplicate: false,
            submittedAt: "2026-07-05T00:00:00.000Z",
          };
        },
      },
    }),
  );
  const call = () =>
    rpc("tools/call", {
      name: "action.lead.submit",
      arguments: { message: "hello world!" },
      _meta: { "gogol.dev/idempotencyKey": "mcp-key-1" },
    });
  const b1 = await rpcResult(await gate.handleMcp(call()));
  const c1 = (b1.result as { content: Array<{ text: string }> }).content;
  const first = JSON.parse(c1[0]!.text) as { receiptId: string; duplicate: boolean };
  expect(first.duplicate).toBe(false);

  const b2 = await rpcResult(await gate.handleMcp(call()));
  const c2 = (b2.result as { content: Array<{ text: string }> }).content;
  const second = JSON.parse(c2[0]!.text) as { receiptId: string; duplicate: boolean };
  expect(second.receiptId).toBe(first.receiptId);
  expect(second.duplicate).toBe(true);
  expect(dispatchCount).toBe(1);
});
