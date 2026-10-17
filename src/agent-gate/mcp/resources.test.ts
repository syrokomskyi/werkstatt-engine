/*
<MODULE_CONTRACT>
<purpose>
RFC-1211 AC-3 tests: MCP resources/list exposes every ui:// resource of the
active catalog, resources/read serves the committed /.well-known/ui/*.html
bytes, and tools/call embeds a {type:"resource"} block for ui-capable
capabilities.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1211: initial test coverage.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { handleJsonRpcRequest, type McpHandlerContext } from "./handler.ts";
import { MCP_PROTOCOL_VERSION_META_KEY, type JsonRpcRequest } from "./protocol.ts";
import { SUPPORTED_MCP_PROTOCOL_VERSIONS } from "./protocol.ts";
import { buildAgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";

const SUPPORTED = SUPPORTED_MCP_PROTOCOL_VERSIONS[0]!;
const UI_HTML = "<!doctype html><!-- gogol.agent-ui/1 --><html><body>preview</body></html>";

const UI_CAPABILITY: CapabilityRecord = {
  id: "quote.prepare",
  version: 1,
  kind: "action",
  sideEffect: "none",
  title: { en: "Preview a quote" },
  description: { en: "Validates a quote request." },
  input: {
    type: "object",
    required: ["email"],
    additionalProperties: false,
    properties: { email: { type: "string", format: "email" } },
  },
  output: {
    type: "object",
    required: ["ready"],
    additionalProperties: false,
    properties: { ready: { type: "boolean" } },
  },
  requires: { entitlements: ["agent.actions"], sections: [] },
  limits: { perMinutePerIp: 10, maxPayloadBytes: 10240 },
  ui: { resource: true },
};

const PLAIN_CAPABILITY: CapabilityRecord = {
  ...UI_CAPABILITY,
  id: "lead.submit",
  ui: undefined,
};

function makeCtx(catalog: CapabilityRecord[] = [UI_CAPABILITY]): McpHandlerContext {
  const manifest = buildAgentSurfaceManifest({
    generatedAt: "2026-01-01T00:00:00.000Z",
    site: "test-site",
    baseUrl: "https://test.example",
    languages: { default: "en", supported: ["en"] },
    actions: catalog.map((cap) => ({
      id: cap.id,
      url: `/api/agent/v1/actions/${cap.id}`,
      title: cap.title,
      inputSchemaRef: `#/components/schemas/${cap.id}-input`,
      entitlement: "agent.actions" as const,
      sideEffect: "none" as const,
    })),
    mcp: { url: "/api/agent/mcp", protocolVersion: SUPPORTED },
    mcpUi: { url: "/.well-known/ui/", uriPrefix: "ui://test-site/" },
  });
  return {
    manifest,
    catalog,
    ports: {
      knowledge: {
        read: async (p: string) => (p.startsWith("/.well-known/ui/") ? UI_HTML : null),
      },
      dispatch: {
        send: async () => {
          throw new Error("not used — preview capabilities never dispatch");
        },
      },
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    },
  };
}

function req(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: {
      ...params,
      _meta: { [MCP_PROTOCOL_VERSION_META_KEY]: SUPPORTED },
    },
  };
}

function resultOf(res: Awaited<ReturnType<typeof handleJsonRpcRequest>>) {
  if (!("result" in res)) throw new Error(`expected success, got ${JSON.stringify(res)}`);
  return res.result;
}

test("AC-3: resources/list returns every ui:// resource with text/html", async () => {
  const res = await handleJsonRpcRequest(req("resources/list"), makeCtx());
  const { resources } = resultOf(res) as {
    resources: { uri: string; name: string; mimeType: string }[];
  };
  const ui = resources.filter((r) => r.uri.startsWith("ui://"));
  expect(ui).toHaveLength(1);
  expect(ui[0]).toMatchObject({
    uri: "ui://test-site/quote.prepare",
    name: "quote.prepare",
    mimeType: "text/html",
  });
});

test("resources/list: capabilities without ui emit no ui:// entry", async () => {
  const res = await handleJsonRpcRequest(req("resources/list"), makeCtx([PLAIN_CAPABILITY]));
  const { resources } = resultOf(res) as { resources: { uri: string }[] };
  expect(resources.filter((r) => r.uri.startsWith("ui://"))).toHaveLength(0);
});

test("resources/read: ui:// URI returns the committed HTML artifact", async () => {
  const res = await handleJsonRpcRequest(
    req("resources/read", { uri: "ui://test-site/quote.prepare" }),
    makeCtx(),
  );
  const { contents } = resultOf(res) as {
    contents: { uri: string; mimeType: string; text: string }[];
  };
  expect(contents).toHaveLength(1);
  expect(contents[0]).toEqual({
    uri: "ui://test-site/quote.prepare",
    mimeType: "text/html",
    text: UI_HTML,
  });
});

test("resources/read: ui:// for a non-ui capability is unknown", async () => {
  const res = await handleJsonRpcRequest(
    req("resources/read", { uri: "ui://test-site/lead.submit" }),
    makeCtx(),
  );
  expect("error" in res).toBe(true);
});

test("resources/read: ui:// for a foreign site is unknown", async () => {
  const res = await handleJsonRpcRequest(
    req("resources/read", { uri: "ui://other-site/quote.prepare" }),
    makeCtx(),
  );
  expect("error" in res).toBe(true);
});

test("tools/call: ui-capable action embeds a resource content block", async () => {
  const res = await handleJsonRpcRequest(
    req("tools/call", {
      name: "action.quote.prepare",
      arguments: { email: "agent@example.com" },
    }),
    makeCtx(),
  );
  const { content } = resultOf(res) as {
    content: { type: string; text?: string; resource?: { uri: string; mimeType: string; text?: string } }[];
  };
  expect(content[0]!.type).toBe("text");
  const block = content.find((c) => c.type === "resource");
  expect(block).toBeDefined();
  expect(block!.resource).toEqual({
    uri: "ui://test-site/quote.prepare",
    mimeType: "text/html",
    text: UI_HTML,
  });
});

test("tools/call: non-ui capability embeds no resource block", async () => {
  const res = await handleJsonRpcRequest(
    req("tools/call", {
      name: "action.lead.submit",
      arguments: { email: "agent@example.com" },
    }),
    makeCtx([PLAIN_CAPABILITY]),
  );
  const { content } = resultOf(res) as { content: { type: string }[] };
  expect(content.every((c) => c.type === "text")).toBe(true);
});
