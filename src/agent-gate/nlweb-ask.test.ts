/* <MODULE_CONTRACT>
<purpose>
RFC-1165 NLWeb /ask — unit tests for the framework-free core (nlweb-ask.ts).
Determinism (AC-2), honest prefer failures (AC-3), no-answer contract (AC-4),
accept-language gating + fallback (AC-9), site-mismatch, schema_object mirror
sourcing — all with stubbed ports; no astro/cloudflare imports.
</purpose>
<non-goals>
  <item>No HTTP/adapter tests — createAgentNlwebRoute lives in astro.ts.</item>
</non-goals>
</MODULE_CONTRACT>
*/

import { describe, expect, it } from "vitest";
import type { AgentSurfaceManifest, SearchChunk, SearchManifest } from "@warpgogol/werkstatt-shared/agent";
import {
  NLWEB_MIN_SCORE,
  NLWEB_VERSION,
  noAnswerSentence,
  nlwebQueryId,
  parseNlwebRequest,
  resolveAcceptLanguage,
  runNlwebAsk,
  type NlwebAskPorts,
} from "./nlweb-ask.ts";

const manifest = {
  site: "warpgogol",
  baseUrl: "https://warpgogol.com",
  languages: { default: "de", supported: ["de", "uk"] },
} as AgentSurfaceManifest;

const chunks: SearchChunk[] = [
  {
    id: "de:/leistungen/:b1",
    url: "/leistungen/",
    lang: "de",
    type: "page",
    blockId: "b1",
    heading: "Leistungen",
    text: "Wir bauen digitale Fundamente für Freiburger Unternehmen.",
    title: "Leistungen",
    canonicalUrl: "https://warpgogol.com/leistungen/",
    updatedAt: "2026-09-01",
  },
  {
    id: "uk:/posluhy/:b1",
    url: "/uk/posluhy/",
    lang: "uk",
    type: "page",
    blockId: "b1",
    heading: "Послуги",
    text: "Ми будуємо цифровий фундамент для компаній Фрайбурга.",
    title: "Послуги",
    canonicalUrl: "https://warpgogol.com/uk/posluhy/",
    updatedAt: "2026-09-01",
  },
];

const searchManifest = { chunks } as SearchManifest;

const mirrorDoc = { "@graph": [{ "@type": "WebPage", name: "Leistungen" }] };

function ports(matches: Array<{ id: string; score: number }>, mirrors: Record<string, unknown> = {}): NlwebAskPorts {
  return {
    ai: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
    searchIndex: { query: async () => ({ matches }) },
    fetchMirror: async (p) => mirrors[p] ?? null,
  };
}

const goodBody = {
  query: { text: "Was baut ihr?" },
  prefer: { streaming: false, response_format: "conversational_search", mode: "list" },
};

// ---------------------------------------------------------------------------
// AC-2 — determinism
// ---------------------------------------------------------------------------

describe("runNlwebAsk determinism (AC-2)", () => {
  it("returns byte-identical bodies for identical requests", async () => {
    const p = ports([{ id: "de:/leistungen/:b1", score: 0.9 }], { "leistungen.jsonld": mirrorDoc });
    const a = await runNlwebAsk(goodBody, manifest, searchManifest, p);
    const b = await runNlwebAsk(goodBody, manifest, searchManifest, p);
    expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
    expect(a.body._meta.query_id).toBe(b.body._meta.query_id);
    expect(a.body._meta.version).toBe(NLWEB_VERSION);
    expect(a.body._meta.response_type).toBe("answer");
  });

  it("nlwebQueryId is stable and site-scoped", async () => {
    const id1 = await nlwebQueryId("warpgogol", "de", "Was baut ihr?");
    const id2 = await nlwebQueryId("warpgogol", "de", "Was baut ihr?");
    const other = await nlwebQueryId("other-site", "de", "Was baut ihr?");
    expect(id1).toBe(id2);
    expect(id1).not.toBe(other);
    expect(id1).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — honest prefer failures
// ---------------------------------------------------------------------------

describe("parseNlwebRequest honest failures (AC-3)", () => {
  it.each([
    [{ prefer: { streaming: true } }, "unsupported-streaming"],
    [{ prefer: { response_format: "rss" } }, "unsupported-response_format"],
    [{ prefer: { mode: "generate" } }, "unsupported-mode"],
    [{ query: { text: "a" } }, "invalid-query-text"],
    [{ query: { text: "x".repeat(501) } }, "invalid-query-text"],
    [{ query: { text: "Was?", site: "other-site" } }, "site-mismatch"],
  ])("rejects %j with reason %s", (patch, reason) => {
    const body = { query: { text: "Was baut ihr?" }, ...patch };
    const r = parseNlwebRequest(body, "warpgogol", ["de", "uk"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.reason).toBe(reason);
    }
  });

  it("returns failure response_type on bad prefer via runNlwebAsk", async () => {
    const r = await runNlwebAsk(
      { query: { text: "Was baut ihr?" }, prefer: { streaming: true } },
      manifest,
      searchManifest,
      ports([]),
    );
    expect(r.status).toBe(400);
    expect(r.body._meta.response_type).toBe("failure");
    expect(r.body.reason).toBe("unsupported-streaming");
    expect(r.body.total_results).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — no-answer contract
// ---------------------------------------------------------------------------

describe("no-answer contract (AC-4)", () => {
  it("below-threshold retrieval returns the deterministic no-answer", async () => {
    const r = await runNlwebAsk(goodBody, manifest, searchManifest, ports([{ id: "de:/leistungen/:b1", score: NLWEB_MIN_SCORE - 0.01 }]));
    expect(r.status).toBe(200);
    expect(r.body.total_results).toBe(0);
    expect(r.body.results).toEqual([]);
    expect(r.body.answer).toBe(noAnswerSentence("de"));
    expect(r.body.content).toBeUndefined();
  });

  it("uk accept-language returns the uk no-answer sentence", async () => {
    const r = await runNlwebAsk(
      { query: { text: "Що ви будуєте?" }, prefer: { "accept-language": "uk" } },
      manifest,
      searchManifest,
      ports([]),
    );
    expect(r.body.answer).toBe(noAnswerSentence("uk"));
    expect(r.body._meta.lang).toBe("uk");
  });
});

// ---------------------------------------------------------------------------
// AC-9 — accept-language gating
// ---------------------------------------------------------------------------

describe("accept-language (AC-9)", () => {
  it("uk language selects uk chunks", async () => {
    const r = await runNlwebAsk(
      { query: { text: "Що?" }, prefer: { "accept-language": "uk" } },
      manifest,
      searchManifest,
      ports([
        { id: "de:/leistungen/:b1", score: 0.9 },
        { id: "uk:/posluhy/:b1", score: 0.8 },
      ]),
    );
    expect(r.body.results).toHaveLength(1);
    expect(r.body.results[0].url).toBe("https://warpgogol.com/uk/posluhy/");
  });

  it("falls back to default-language chunks when the resolved lang has none", async () => {
    const r = await runNlwebAsk(
      { query: { text: "Що?" }, prefer: { "accept-language": "uk" } },
      manifest,
      searchManifest,
      ports([{ id: "de:/leistungen/:b1", score: 0.9 }]),
    );
    expect(r.body.results).toHaveLength(1);
    expect(r.body.results[0].url).toBe("https://warpgogol.com/leistungen/");
  });

  it("resolveAcceptLanguage: q-sort, prefix match, default fallback", () => {
    const s = ["de", "uk"];
    expect(resolveAcceptLanguage("uk-UA;q=0.9,de;q=0.8", s, "de")).toBe("uk");
    expect(resolveAcceptLanguage("de;q=0.9,uk;q=0.8", s, "de")).toBe("de");
    expect(resolveAcceptLanguage("fr", s, "de")).toBe("de");
    expect(resolveAcceptLanguage(undefined, s, "de")).toBe("de");
    expect(resolveAcceptLanguage("", s, "de")).toBe("de");
  });
});

// ---------------------------------------------------------------------------
// schema_object grounding (RFC-1164 mirrors)
// ---------------------------------------------------------------------------

describe("schema_object mirror grounding", () => {
  it("attaches the mirror @graph when the mirror exists", async () => {
    const r = await runNlwebAsk(
      goodBody,
      manifest,
      searchManifest,
      ports([{ id: "de:/leistungen/:b1", score: 0.9 }], { "leistungen.jsonld": mirrorDoc }),
    );
    expect(r.body.results[0].schema_object?.["@type"]).toBe("WebPage");
    expect(r.body.results[0].schema_object?.["@graph"]).toEqual(mirrorDoc["@graph"]);
  });

  it("omits schema_object when the mirror is absent", async () => {
    const r = await runNlwebAsk(goodBody, manifest, searchManifest, ports([{ id: "de:/leistungen/:b1", score: 0.9 }]));
    expect(r.body.results[0].schema_object).toBeUndefined();
    expect(r.body.results[0]["@type"]).toBe("WebPage");
  });
});
