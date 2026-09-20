/*
<MODULE_CONTRACT>
<purpose>RFC-1115: AC-1/AC-2 tests for runAgentSearch — flattened citation SearchResult shape and measured tookMs.</purpose>
<keywords>RFC-1115, agent surface, semantic search, SearchResult, tookMs, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP>
  <entry key="tests">flat result shape, unmatched ids skipped, tookMs from injected clock, empty matches.</entry>
</MODULE_MAP>
<CHANGE_SUMMARY>
  <item>RFC-1115: initial search-route tests.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect } from "vitest";
import { runAgentSearch, type AgentSearchPorts } from "../search-route.ts";
import type { SearchChunk, SearchManifest } from "@warpgogol/werkstatt-shared/agent";

const chunk: SearchChunk = {
  id: "de:/about:page",
  url: "/about",
  lang: "de",
  type: "page",
  blockId: null,
  heading: "Über uns",
  text: "About the company",
  title: "Über uns",
  canonicalUrl: "https://example.example/about",
  updatedAt: "2026-08-20",
};

const manifest: SearchManifest = {
  schema: "2",
  site: "s",
  model: "@cf/baai/bge-m3",
  dimensions: 1024,
  generatedAt: "2026-09-19T00:00:00Z",
  contentHash: "sha256:test",
  chunks: [chunk],
};

function makePorts(matches: Array<{ id: string; score: number }>): AgentSearchPorts {
  return {
    ai: {
      async run() {
        return { data: [[0.1, 0.2, 0.3]] };
      },
    },
    searchIndex: {
      async query() {
        return { matches };
      },
    },
  };
}

describe("RFC-1115 AC-1: flattened citation SearchResult", () => {
  it("emits title/canonicalUrl/updatedAt/lang/type/score/text — no nested chunk", async () => {
    const res = await runAgentSearch(
      { q: "about", topK: 5 },
      manifest,
      makePorts([{ id: chunk.id, score: 0.87 }]),
    );
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toEqual({
      title: "Über uns",
      canonicalUrl: "https://example.example/about",
      updatedAt: "2026-08-20",
      lang: "de",
      type: "page",
      score: 0.87,
      text: "About the company",
    });
    expect("chunk" in res.results[0]).toBe(false);
  });

  it("skips matches whose chunk id is absent from the manifest", async () => {
    const res = await runAgentSearch(
      { q: "about", topK: 5 },
      manifest,
      makePorts([
        { id: "missing", score: 0.99 },
        { id: chunk.id, score: 0.5 },
      ]),
    );
    expect(res.results).toHaveLength(1);
    expect(res.results[0].score).toBe(0.5);
  });

  it("returns empty results when the index has no matches", async () => {
    const res = await runAgentSearch({ q: "about", topK: 5 }, manifest, makePorts([]));
    expect(res.results).toEqual([]);
    expect(res.query).toBe("about");
  });
});

describe("RFC-1115 AC-2: tookMs is measured, not hardcoded", () => {
  it("tookMs equals elapsed time from the injected clock", async () => {
    let tick = 1000;
    const res = await runAgentSearch(
      { q: "about", topK: 5 },
      manifest,
      makePorts([{ id: chunk.id, score: 0.9 }]),
      () => (tick += 25),
    );
    // two now() calls: start + end → 25ms elapsed
    expect(res.tookMs).toBe(25);
  });

  it("tookMs is a non-negative number with the real clock", async () => {
    const res = await runAgentSearch({ q: "about", topK: 5 }, manifest, makePorts([]));
    expect(typeof res.tookMs).toBe("number");
    expect(res.tookMs).toBeGreaterThanOrEqual(0);
  });
});
