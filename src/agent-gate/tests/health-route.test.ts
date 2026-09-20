/*
<MODULE_CONTRACT>
<purpose>RFC-1116: AC-1/AC-2 tests for runAgentHealth — AgentHealth payload shape, 200/503 semantics, degraded rules.</purpose>
<keywords>RFC-1116, agent surface, health endpoint, AgentHealth, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP>
  <entry key="tests">healthy → 200 + all fields; missing dispatch token → degraded 503; manifest/knowledge/search degraded edges.</entry>
</MODULE_MAP>
<CHANGE_SUMMARY>
  <item>RFC-1116: initial health-route tests.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect } from "vitest";
import { runAgentHealth, type AgentHealthDeps } from "../health-route.ts";
import { buildAgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";

const manifest = buildAgentSurfaceManifest({
  generatedAt: "2026-01-01T00:00:00.000Z",
  site: "test-site",
  baseUrl: "https://test.example",
  languages: { default: "de", supported: ["de"] },
  knowledge: [
    { domain: "offer", url: "/.well-known/knowledge/offer.json", schema: "gogol.agent.knowledge/offer@1" },
  ],
  search: { url: "/api/agent/search", model: "@cf/baai/bge-m3", dimensions: 1024 },
});

function makeDeps(overrides: {
  fetchResponses?: Record<string, { status: number; body?: unknown }>;
  qstashToken?: string;
  ai?: unknown;
  searchIndex?: unknown;
}): AgentHealthDeps {
  const responses = overrides.fetchResponses ?? {};
  return {
    requestUrl: "https://test.example/api/agent/health",
    fetchFn: (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname;
      const stub = responses[path];
      if (!stub) return new Response("not found", { status: 404 });
      return new Response(stub.body !== undefined ? JSON.stringify(stub.body) : "ok", {
        status: stub.status,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
    env: { AI: overrides.ai, SEARCH_INDEX: overrides.searchIndex },
    qstashToken: overrides.qstashToken,
  };
}

const ALL_OK = {
  "/.well-known/agent.json": { status: 200, body: { ok: true } },
  "/.well-known/knowledge/offer.json": { status: 200, body: { freshness: {} } },
  "/.well-known/build-identity.json": { status: 200, body: { distTreeHash: "abc123" } },
};

describe("RFC-1116 AC-1: healthy surface → 200 + full AgentHealth shape", () => {
  it("reports ok with all checks green and contentHash from build-identity", async () => {
    const res = await runAgentHealth(
      manifest,
      makeDeps({ fetchResponses: ALL_OK, qstashToken: "tok", ai: {}, searchIndex: {} }),
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.surfaceVersion).toBe("2.0.0");
    expect(res.body.contentHash).toBe("abc123");
    expect(res.body.checks).toEqual({
      manifest: "ok",
      knowledge: "ok",
      dispatch: "configured",
      search: "available",
    });
  });
});

describe("RFC-1116 AC-2: missing dispatch binding → degraded + 503", () => {
  it("reports unconfigured dispatch and degraded status", async () => {
    const res = await runAgentHealth(
      manifest,
      makeDeps({ fetchResponses: ALL_OK, qstashToken: undefined, ai: {}, searchIndex: {} }),
    );
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.dispatch).toBe("unconfigured");
  });
});

describe("RFC-1116: degraded edges", () => {
  it("manifest unreachable → degraded, checks.manifest missing", async () => {
    const res = await runAgentHealth(
      manifest,
      makeDeps({
        fetchResponses: {
          "/.well-known/knowledge/offer.json": { status: 200, body: {} },
          "/.well-known/build-identity.json": { status: 200, body: { distTreeHash: "x" } },
        },
        qstashToken: "tok",
        ai: {},
        searchIndex: {},
      }),
    );
    expect(res.status).toBe(503);
    expect(res.body.checks.manifest).toBe("missing");
  });

  it("search advertised but bindings absent → degraded", async () => {
    const res = await runAgentHealth(
      manifest,
      makeDeps({ fetchResponses: ALL_OK, qstashToken: "tok" }),
    );
    expect(res.status).toBe(503);
    expect(res.body.checks.search).toBe("unavailable");
  });

  it("search not advertised + bindings absent → still ok", async () => {
    const noSearch = buildAgentSurfaceManifest({
      generatedAt: "2026-01-01T00:00:00.000Z",
      site: "test-site",
      baseUrl: "https://test.example",
      languages: { default: "de", supported: ["de"] },
      knowledge: [
        { domain: "offer", url: "/.well-known/knowledge/offer.json", schema: "gogol.agent.knowledge/offer@1" },
      ],
    });
    const res = await runAgentHealth(
      noSearch,
      makeDeps({ fetchResponses: ALL_OK, qstashToken: "tok" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.checks.search).toBe("unavailable");
  });

  it("build-identity unreachable → contentHash empty but not degraded", async () => {
    const res = await runAgentHealth(
      manifest,
      makeDeps({
        fetchResponses: {
          "/.well-known/agent.json": { status: 200, body: {} },
          "/.well-known/knowledge/offer.json": { status: 200, body: {} },
        },
        qstashToken: "tok",
        ai: {},
        searchIndex: {},
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body.contentHash).toBe("");
  });
});
