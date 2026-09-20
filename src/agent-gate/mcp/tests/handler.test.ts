/*
<MODULE_CONTRACT>
<purpose>
RFC-1113 AC-2: JSON-RPC-level tests for the 2026-07-28 stateless MCP era —
server/discover answers unconditionally, initialize returns
UnsupportedProtocolVersionError, and every other method is gated on
_meta["io.modelcontextprotocol/protocolVersion"] ∈ SUPPORTED_MCP_PROTOCOL_VERSIONS.
Transport-level concerns (HTTP 400 mapping, MCP-Protocol-Version header
consistency) are covered in ../../tests/gate.test.ts.
</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1113: replace load-verification shim with version-negotiation tests.</item>
  <item>RFC-1113: align agent discovery surface with RFC 9727 and MCP 2026-07-28 stateless era</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { handleJsonRpcRequest, type McpHandlerContext } from "../handler.ts";
import {
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  MCP_PROTOCOL_VERSION_META_KEY,
  JSON_RPC_ERROR,
  type JsonRpcRequest,
} from "../protocol.ts";
import { buildAgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";

const SUPPORTED = SUPPORTED_MCP_PROTOCOL_VERSIONS[0]!;

function makeCtx(): McpHandlerContext {
  const manifest = buildAgentSurfaceManifest({
    generatedAt: "2026-01-01T00:00:00.000Z",
    site: "test-bundle",
    baseUrl: "https://test.example",
    languages: { default: "de", supported: ["de"] },
  });
  return {
    manifest,
    catalog: [],
    ports: {
      knowledge: { read: async () => null },
      dispatch: {
        send: async () => {
          throw new Error("not used");
        },
      },
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    },
  };
}

function req(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) };
}

function withVersion(params: Record<string, unknown> = {}, version: string = SUPPORTED) {
  return { ...params, _meta: { [MCP_PROTOCOL_VERSION_META_KEY]: version } };
}

function errorOf(res: Awaited<ReturnType<typeof handleJsonRpcRequest>>) {
  if (!("error" in res)) throw new Error("expected a JsonRpcError");
  return res.error;
}

function resultOf(res: Awaited<ReturnType<typeof handleJsonRpcRequest>>) {
  if (!("result" in res)) throw new Error("expected a JsonRpcSuccess");
  return res.result;
}

test("server/discover: answers unconditionally with the supported version list", async () => {
  const res = await handleJsonRpcRequest(req("server/discover"), makeCtx());
  const result = resultOf(res) as {
    resultType: string;
    supportedVersions: string[];
    capabilities: unknown;
    _meta: Record<string, { name: string; version: string }>;
  };
  expect(result.resultType).toBe("complete");
  expect(result.supportedVersions).toEqual([...SUPPORTED_MCP_PROTOCOL_VERSIONS]);
  expect(result.capabilities).toEqual({ tools: {}, resources: {} });
  expect(result._meta["io.modelcontextprotocol/serverInfo"]!.name).toContain("agent surface");
});

test("initialize: returns UnsupportedProtocolVersionError naming supported + requested", async () => {
  const res = await handleJsonRpcRequest(
    req("initialize", { protocolVersion: "2025-06-18" }),
    makeCtx(),
  );
  const error = errorOf(res);
  expect(error.code).toBe(JSON_RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION);
  const data = error.data as { supported: string[]; requested: string };
  expect(data.supported).toEqual([...SUPPORTED_MCP_PROTOCOL_VERSIONS]);
  expect(data.requested).toBe("2025-06-18");
});

test("version gate: missing _meta version → UnsupportedProtocolVersionError", async () => {
  const res = await handleJsonRpcRequest(req("ping"), makeCtx());
  const error = errorOf(res);
  expect(error.code).toBe(JSON_RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION);
  const data = error.data as { supported: string[]; requested: unknown };
  expect(data.supported).toEqual([...SUPPORTED_MCP_PROTOCOL_VERSIONS]);
  expect(data.requested).toBeNull();
});

test("version gate: unsupported _meta version → UnsupportedProtocolVersionError", async () => {
  const res = await handleJsonRpcRequest(
    req("tools/list", withVersion({}, "1999-01-01")),
    makeCtx(),
  );
  const error = errorOf(res);
  expect(error.code).toBe(JSON_RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION);
  expect((error.data as { requested: string }).requested).toBe("1999-01-01");
});

test("version gate: supported _meta version → request proceeds", async () => {
  const res = await handleJsonRpcRequest(req("ping", withVersion()), makeCtx());
  expect(resultOf(res)).toEqual({});
});

test("version gate: runs before method dispatch — unknown method with bad version gets -32022", async () => {
  const res = await handleJsonRpcRequest(req("prompts/list"), makeCtx());
  expect(errorOf(res).code).toBe(JSON_RPC_ERROR.UNSUPPORTED_PROTOCOL_VERSION);
});

test("version gate: unknown method with valid version still gets -32601", async () => {
  const res = await handleJsonRpcRequest(req("prompts/list", withVersion()), makeCtx());
  expect(errorOf(res).code).toBe(JSON_RPC_ERROR.METHOD_NOT_FOUND);
});
