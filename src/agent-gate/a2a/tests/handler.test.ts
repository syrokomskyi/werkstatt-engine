/*
<MODULE_CONTRACT>
<purpose>RFC-1114: the A2A conformance corpus — golden request/response pairs replayed through createAgentGate.handleA2a with fake ports. The pinned subset is SendMessage over JSON-RPC 2.0 with the A2A-Version header gate; the handler must satisfy these fixtures.</purpose>
<keywords>RFC-1114, agent surface, gate, A2A, SendMessage, conformance, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP>
  <entry key="tests">SendMessage happy path (completed task + receipt artifact), unknown capability, missing capability DataPart, malformed message, schema-violation rejected task, dispatch-failure failed task, preview task, rate limit + payload cap parity, A2A-Version gate, batch rejection, GET 405, idempotency replay, contextId echo, unknown method.</entry>
</MODULE_MAP>
<CHANGE_SUMMARY>
  <item>RFC-1114: initial A2A conformance corpus.</item>
  <item>RFC-1114: minimal real A2A endpoint + honest agent card</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { createAgentGate, type AgentGatePorts, __resetLimiterCache } from "../../index.ts";
import { __resetA2aLimiterCache } from "../handler.ts";
import { createFixedWindowLimiter } from "../../limits.ts";
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

function makeManifest(actionIds: string[] = ["lead.submit"]) {
  return buildAgentSurfaceManifest({
    generatedAt: "2026-01-01T00:00:00.000Z",
    site: "test-bundle",
    baseUrl: "https://test.example",
    languages: { default: "de", supported: ["de", "en"] },
    knowledge: [],
    actions: actionIds.map((id) => ({
      id,
      url: `/api/agent/actions/${id}`,
      title: { de: id },
      inputSchemaRef: `#/components/schemas/${id}-input`,
      entitlement: "agent.actions",
    })),
    a2a: { url: "/api/agent/a2a", protocolVersion: "1.0" },
  });
}

function makeFakePorts(overrides: Partial<AgentGatePorts> = {}): AgentGatePorts {
  return {
    knowledge: { read: async () => null },
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

function sendMessage(
  parts: unknown[],
  opts: { messageId?: string; contextId?: string; headers?: Record<string, string> } = {},
) {
  return new Request("https://test.example/api/agent/a2a", {
    method: "POST",
    headers: { "content-type": "application/json", ...opts.headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "SendMessage",
      params: {
        message: {
          messageId: opts.messageId ?? "msg-1",
          role: "user",
          ...(opts.contextId ? { contextId: opts.contextId } : {}),
          parts,
        },
      },
    }),
  });
}

function capabilityPart(capability: string, input: Record<string, unknown>) {
  return [{ kind: "data", data: { capability, input } }];
}

function rawRpc(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://test.example/api/agent/a2a", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

interface A2aTaskBody {
  result?: {
    id: string;
    contextId?: string;
    status: { state: string; timestamp: string };
    artifacts?: { name: string; parts: { kind: string; data: unknown }[] }[];
  };
  error?: { code: number; message: string; data?: { code?: string; retryAfterSeconds?: number } };
}

// ---------------------------------------------------------------------------
// AC-1: happy path — completed task whose artifact carries the ActionReceipt
// ---------------------------------------------------------------------------

test("SendMessage: valid capability DataPart returns a completed task with the receipt artifact", async () => {
  const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleA2a(
    sendMessage(capabilityPart("lead.submit", { message: "hello world!" })),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as A2aTaskBody;
  const task = body.result!;
  expect(task.status.state).toBe("completed");
  expect(task.status.timestamp).toBe("2026-07-05T00:00:00.000Z");
  const receipt = task.artifacts![0]!.parts[0]!.data as {
    receiptId: string;
    status: string;
    duplicate: boolean;
    submittedAt: string;
  };
  expect(task.artifacts![0]!.name).toBe("receipt");
  expect(task.id).toBe(receipt.receiptId);
  expect(receipt.status).toBe("accepted");
  expect(receipt.duplicate).toBe(false);
  expect(receipt.receiptId).toMatch(/^[0-9a-f-]{36}$/);
});

test("SendMessage: contextId is echoed back on the task", async () => {
  const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleA2a(
    sendMessage(capabilityPart("lead.submit", { message: "hello world!" }), {
      contextId: "ctx-42",
    }),
  );
  const body = (await res.json()) as A2aTaskBody;
  expect(body.result!.contextId).toBe("ctx-42");
});

// ---------------------------------------------------------------------------
// AC-2: unknown capability / missing capability DataPart → -32602
// ---------------------------------------------------------------------------

test("SendMessage: unknown capability returns -32602 with problem details in error.data", async () => {
  const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleA2a(
    sendMessage(capabilityPart("does.not.exist", { message: "hello world!" })),
  );
  const body = (await res.json()) as A2aTaskBody;
  expect(body.error!.code).toBe(-32602);
  expect(body.error!.data!.code).toBe("unknown-capability");
});

test("SendMessage: no capability DataPart returns -32602", async () => {
  const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleA2a(sendMessage([{ kind: "text", text: "hello there" }]));
  const body = (await res.json()) as A2aTaskBody;
  expect(body.error!.code).toBe(-32602);
  expect(body.error!.data!.code).toBe("schema-violation");
});

test("SendMessage: malformed message (missing messageId) returns -32602", async () => {
  const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleA2a(
    rawRpc({
      jsonrpc: "2.0",
      id: 1,
      method: "SendMessage",
      params: { message: { role: "user", parts: [] } },
    }),
  );
  const body = (await res.json()) as A2aTaskBody;
  expect(body.error!.code).toBe(-32602);
});

// ---------------------------------------------------------------------------
// Terminal-state tasks: rejected (schema) / failed (dispatch) / preview
// ---------------------------------------------------------------------------

test("SendMessage: schema violation returns a rejected task with the problem artifact", async () => {
  const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleA2a(
    sendMessage(capabilityPart("lead.submit", { message: "short" })),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as A2aTaskBody;
  const task = body.result!;
  expect(task.status.state).toBe("rejected");
  const problem = task.artifacts![0]!.parts[0]!.data as { code: string; errors: unknown[] };
  expect(task.artifacts![0]!.name).toBe("problem");
  expect(problem.code).toBe("schema-violation");
  expect(problem.errors.length > 0).toBeTruthy();
});

test("SendMessage: dispatch failure returns a failed task with the problem artifact", async () => {
  const gate = createAgentGate(
    makeManifest(),
    [LEAD_SUBMIT],
    makeFakePorts({
      dispatch: {
        send: async () => {
          throw new Error("boom");
        },
      },
    }),
  );
  const res = await gate.handleA2a(
    sendMessage(capabilityPart("lead.submit", { message: "hello world!" })),
  );
  const body = (await res.json()) as A2aTaskBody;
  const task = body.result!;
  expect(task.status.state).toBe("failed");
  const problem = task.artifacts![0]!.parts[0]!.data as { code: string; retryable: boolean };
  expect(problem.code).toBe("dispatch-failed");
  expect(problem.retryable).toBe(true);
});

test("SendMessage: sideEffect none capability returns a completed task with a preview artifact", async () => {
  const gate = createAgentGate(makeManifest(["lead.prepare"]), [LEAD_PREPARE], makeFakePorts());
  const res = await gate.handleA2a(
    sendMessage(capabilityPart("lead.prepare", { message: "hello world!" })),
  );
  const body = (await res.json()) as A2aTaskBody;
  const task = body.result!;
  expect(task.status.state).toBe("completed");
  expect(task.artifacts![0]!.name).toBe("preview");
  const preview = task.artifacts![0]!.parts[0]!.data as { valid: boolean; draftId: string };
  expect(preview.valid).toBe(true);
  expect(preview.draftId).toBeTruthy();
});

// ---------------------------------------------------------------------------
// AC-6: payload cap + rate limit parity with the MCP path
// ---------------------------------------------------------------------------

test("SendMessage: oversized input returns -32000 with payload-too-large", async () => {
  const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleA2a(
    sendMessage(capabilityPart("lead.submit", { message: "x".repeat(20000) })),
  );
  const body = (await res.json()) as A2aTaskBody;
  expect(body.error!.code).toBe(-32000);
  expect(body.error!.data!.code).toBe("payload-too-large");
});

test("SendMessage: per-IP rate limit returns -32000 with rate-limited + retryAfterSeconds", async () => {
  __resetA2aLimiterCache();
  __resetLimiterCache();
  const capped: CapabilityRecord = {
    ...LEAD_SUBMIT,
    limits: { perMinutePerIp: 2, maxPayloadBytes: 16384 },
  };
  const gate = createAgentGate(makeManifest(), [capped], makeFakePorts());
  const req = () =>
    new Request("https://test.example/api/agent/a2a", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": "1.2.3.4" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "SendMessage",
        params: {
          message: {
            messageId: crypto.randomUUID(),
            role: "user",
            parts: capabilityPart("lead.submit", { message: "hello world!" }),
          },
        },
      }),
    });
  expect((await gate.handleA2a(req())).status).toBe(200);
  expect((await gate.handleA2a(req())).status).toBe(200);
  const r3 = await gate.handleA2a(req());
  const body = (await r3.json()) as A2aTaskBody;
  expect(body.error!.code).toBe(-32000);
  expect(body.error!.data!.code).toBe("rate-limited");
  expect(body.error!.data!.retryAfterSeconds).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Version gate + transport boundary
// ---------------------------------------------------------------------------

test("A2A-Version: header 0.3 is rejected with -32008 + HTTP 400", async () => {
  const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleA2a(
    sendMessage(capabilityPart("lead.submit", { message: "hello world!" }), {
      headers: { "A2A-Version": "0.3" },
    }),
  );
  expect(res.status).toBe(400);
  const body = (await res.json()) as {
    error: { code: number; data: { supported: string[]; requested: string } };
  };
  expect(body.error.code).toBe(-32008);
  expect(body.error.data.supported).toEqual(["1.0"]);
  expect(body.error.data.requested).toBe("0.3");
});

test("A2A-Version: header 1.0 proceeds; absent header is served as 1.0", async () => {
  const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], makeFakePorts());
  const withHeader = await gate.handleA2a(
    sendMessage(capabilityPart("lead.submit", { message: "hello world!" }), {
      headers: { "A2A-Version": "1.0" },
    }),
  );
  expect(withHeader.status).toBe(200);
  const without = await gate.handleA2a(
    sendMessage(capabilityPart("lead.submit", { message: "hello world!" })),
  );
  expect(without.status).toBe(200);
});

test("unknown method returns -32601 method-not-found", async () => {
  const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleA2a(
    rawRpc({ jsonrpc: "2.0", id: 1, method: "GetTask", params: { id: "t1" } }),
  );
  const body = (await res.json()) as A2aTaskBody;
  expect(body.error!.code).toBe(-32601);
});

test("batch requests are rejected with -32600 invalid-request", async () => {
  const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleA2a(
    rawRpc([{ jsonrpc: "2.0", id: 1, method: "SendMessage" }]),
  );
  const body = (await res.json()) as A2aTaskBody;
  expect(body.error!.code).toBe(-32600);
});

test("GET is rejected with 405", async () => {
  const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleA2a(
    new Request("https://test.example/api/agent/a2a", { method: "GET" }),
  );
  expect(res.status).toBe(405);
});

// ---------------------------------------------------------------------------
// RFC-1112 parity: idempotency replay + disabled marker
// ---------------------------------------------------------------------------

function makeMemoryStore() {
  const map = new Map<string, { receipt: ActionReceipt; bodyHash: string }>();
  return {
    get: async (key: string) => map.get(key) ?? null,
    put: async (key: string, bodyHash: string, receipt: ActionReceipt) => {
      map.set(key, { receipt, bodyHash });
    },
  };
}

test("SendMessage: Idempotency-Key replay completes the task with the stored receipt as duplicate", async () => {
  __resetA2aLimiterCache();
  const store = makeMemoryStore();
  let dispatchCount = 0;
  const gate = createAgentGate(
    makeManifest(),
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
    sendMessage(capabilityPart("lead.submit", { message: "hello world!" }), {
      headers: { "Idempotency-Key": "key-1" },
    });
  const r1 = await gate.handleA2a(req());
  const first = ((await r1.json()) as A2aTaskBody).result!;
  const r2 = await gate.handleA2a(req());
  const second = ((await r2.json()) as A2aTaskBody).result!;
  expect(second.id).toBe(first.id);
  const receipt = second.artifacts![0]!.parts[0]!.data as { duplicate: boolean; status: string };
  expect(receipt.duplicate).toBe(true);
  expect(receipt.status).toBe("duplicate");
  expect(dispatchCount).toBe(1);
});

test("SendMessage: no idempotency port → X-Agent-Idempotency: disabled", async () => {
  __resetA2aLimiterCache();
  const gate = createAgentGate(makeManifest(), [LEAD_SUBMIT], makeFakePorts());
  const res = await gate.handleA2a(
    sendMessage(capabilityPart("lead.submit", { message: "hello world!" }), {
      headers: { "Idempotency-Key": "key-2" },
    }),
  );
  expect(res.headers.get("X-Agent-Idempotency")).toBe("disabled");
});

test("SendMessage: zero active capabilities still answers — every call resolves to -32602", async () => {
  const gate = createAgentGate(makeManifest([]), [], makeFakePorts());
  const res = await gate.handleA2a(
    sendMessage(capabilityPart("lead.submit", { message: "hello world!" })),
  );
  const body = (await res.json()) as A2aTaskBody;
  expect(body.error!.code).toBe(-32602);
  expect(body.error!.data!.code).toBe("unknown-capability");
});
