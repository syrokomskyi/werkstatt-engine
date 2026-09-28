/*
<MODULE_CONTRACT>
<purpose>
RFC-1165 NLWeb /ask — framework-free core. Parses the NLWeb v0.55 request,
resolves prefer/accept-language, reuses the search retrieval seam (embedding +
Vectorize via injected ports), and assembles a deterministic extractive answer
(ADR-0097): verbatim chunk excerpts with [n] citation markers — no LLM text
generation at request time. schema_object per result is fetched from the
RFC-1164 .jsonld mirror via an injected fetchMirror port.

Determinism: the response is a pure function of (request, search manifest,
index state) — no timestamps, no randomness. Identical requests on a frozen
index produce byte-identical bodies (DNA-58 runtime analogue). query_id is a
sha256 of (site, lang, query text) — deterministic, never a UUID.

Honesty: unsupported prefer values are explicit failures (reason strings),
never silent degradation (RFC-1113 discipline); the no-answer path returns
total_results: 0 with a fixed localized sentence — never a synthesized answer.
</purpose>
<non-goals>
  <item>No astro/HTTP imports — this module is vitest-loadable pure logic;
        the adapter in ./astro.ts wires env bindings, ASSETS fetch, and CORS.</item>
  <item>No index management or warmup — see agent-search-index.ts / agent-search-warm.ts.</item>
  <item>No streaming — NLWeb streaming: false only in v1 (RFC-1165).</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1165: created — parseNlwebRequest, resolveAcceptLanguage, nlwebQueryId,
    runNlwebAsk (extractive assembly + mirror fetchMirror + no-answer table),
    NLWEB_ constants, NlwebAskRequest/Response types.</item>
</CHANGE_SUMMARY>
*/

import {
  SEARCH_DEFAULT_TOP_K,
  SEARCH_EMBEDDING_MODEL,
  type AgentSurfaceManifest,
  type SearchChunk,
  type SearchManifest,
} from "@warpgogol/werkstatt-shared/agent";
import type { AgentSearchPorts } from "./search-route.ts";

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/** Pinned NLWeb specification version implemented here (external contract). */
export const NLWEB_VERSION = "0.55";

/** NLWeb modes/formats served by v1 — everything else is an honest failure. */
export const NLWEB_SUPPORTED = {
  responseFormat: "conversational_search",
  mode: "list",
} as const;

/** Minimum Vectorize score for a chunk to ground an answer (below → no-answer). */
export const NLWEB_MIN_SCORE = 0.5;

/** How many top chunks feed the extractive answer string. */
export const NLWEB_ANSWER_TOP_N = 3;

/** Per-chunk excerpt budget for the answer string and result description. */
export const NLWEB_EXCERPT_MAX = 280;

export interface NlwebAskRequest {
  query: {
    text: string;
    /** Optional; MUST equal the served site's manifest `site` value. */
    site?: string;
    lang?: string;
    topK?: number;
  };
  prefer?: {
    streaming?: boolean;
    response_format?: string;
    mode?: string;
    "accept-language"?: string;
  };
  meta?: Record<string, unknown>;
}

/** One result item — NLWeb-conformant typed grounding entry. */
export interface NlwebResultItem {
  "@type": string;
  url: string;
  name: string;
  site: string;
  score: number;
  description: string;
  schema_object?: { "@type": string; "@graph"?: unknown[] };
}

export interface NlwebAskResponse {
  _meta: {
    version: string;
    query_id: string;
    response_type: "answer" | "failure";
    /** Echoed negotiated format — RFC-1165 _meta contract. */
    response_format: "conversational_search";
    site: string;
    lang: string;
    mode: string;
  };
  total_results: number;
  results: NlwebResultItem[];
  answer: string;
  content?: NlwebResultItem[];
  /** Present only on failure — machine-readable reason. */
  reason?: string;
}

/** Result of a parsed request — either the request or an HTTP-mappable failure. */
export type NlwebParseResult =
  { ok: true; request: NlwebAskRequest } | { ok: false; status: number; reason: string };

/** Ports the adapter injects — the search route's seam plus the mirror fetch. */
export interface NlwebAskPorts extends AgentSearchPorts {
  /**
   * Fetch a page's `.jsonld` mirror (RFC-1164) by served path — the adapter
   * resolves it via env.ASSETS.fetch; in tests a stub map suffices.
   */
  fetchMirror: (mirrorPath: string) => Promise<unknown | null>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic query_id — sha256(site\nlang\ntext) truncated to 16 hex chars
 * via Web Crypto (works in Workers and Node ≥19 without node:crypto).
 */
export async function nlwebQueryId(site: string, lang: string, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${site}\n${lang}\n${text}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * RFC 9110 quality-list parsing — "uk-UA;q=0.9,de;q=0.8" → best supported
 * language: q-sorted, exact match first, then base-subtag prefix match
 * (uk-UA → uk). Absent/unparseable/no-match → the site default language.
 */
export function resolveAcceptLanguage(
  header: string | undefined,
  supported: string[],
  defaultLang: string,
): string {
  if (!header?.trim()) return defaultLang;
  const tokens = header
    .split(",")
    .map((raw) => {
      const [tag, ...params] = raw.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag: tag.toLowerCase(), q: Number.isFinite(quality) ? quality : 1 };
    })
    .filter((t) => t.tag.length > 0)
    .sort((a, b) => b.q - a.q || a.tag.localeCompare(b.tag));
  for (const { tag } of tokens) {
    const exact = supported.find((l) => l.toLowerCase() === tag);
    if (exact) return exact;
    const base = tag.split("-")[0];
    const prefix = supported.find((l) => l.toLowerCase() === base);
    if (prefix) return prefix;
  }
  return defaultLang;
}

/** Parse + validate the NLWeb request body — failures carry the HTTP status. */
export function parseNlwebRequest(body: unknown, manifestSite: string): NlwebParseResult {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, reason: "invalid-request" };
  }
  const req = body as NlwebAskRequest;
  const text = req.query?.text?.trim();
  if (!text || text.length < 2 || text.length > 500) {
    return { ok: false, status: 400, reason: "invalid-query-text" };
  }
  if (req.query.site !== undefined && req.query.site !== manifestSite) {
    return { ok: false, status: 400, reason: "site-mismatch" };
  }
  const prefer = req.prefer ?? {};
  if (prefer.streaming === true) {
    return { ok: false, status: 400, reason: "unsupported-streaming" };
  }
  if (
    prefer.response_format !== undefined &&
    prefer.response_format !== NLWEB_SUPPORTED.responseFormat
  ) {
    return { ok: false, status: 400, reason: "unsupported-response_format" };
  }
  if (prefer.mode !== undefined && prefer.mode !== NLWEB_SUPPORTED.mode) {
    return { ok: false, status: 400, reason: "unsupported-mode" };
  }
  // accept-language tokens outside the supported set are ignored, not errors —
  // they resolve to the default language in resolveAcceptLanguage (AC-9 fallback).
  return { ok: true, request: { ...req, query: { ...req.query, text } } };
}

/** Deterministic localized no-answer sentences — fixed table, no lookup layers.
 *  Map (not an object literal): a lang token like "toString" would resolve an
 *  inherited Object.prototype method on a plain record — a non-string answer. */
const NO_ANSWER_EN = "No matching answer was found in the published content.";
const NO_ANSWER = new Map<string, string>([
  ["de", "Es wurde keine passende Antwort im veröffentlichten Inhalt gefunden."],
  ["uk", "У опублікованому вмісті відповіді не знайдено."],
  ["en", NO_ANSWER_EN],
]);

export function noAnswerSentence(lang: string): string {
  return NO_ANSWER.get(lang) ?? NO_ANSWER_EN;
}

/** Word-boundary excerpt — deterministic slice, no semantic rewriting. */
function excerptOf(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= NLWEB_EXCERPT_MAX) return trimmed;
  const slice = trimmed.slice(0, NLWEB_EXCERPT_MAX);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > 0 ? lastSpace : NLWEB_EXCERPT_MAX)}…`;
}

/** Derived mirror path for a route — mirrors index.html naming (RFC-1164).
 *  Canonical twin: mirrorUrlForRoute in
 *  packages/werkstatt-site/src/domain/share/astro/jsonld-mirror.ts — engine
 *  cannot import the site plugin, so the transform is duplicated here; keep
 *  both in lockstep if the .jsonld naming convention changes. */
export function nlwebMirrorPath(route: string): string {
  const stripped = route.replace(/\/+$/, "");
  return stripped === "" ? "index.jsonld" : `${stripped.replace(/^\//, "")}.jsonld`;
}

/** Collect the first @type of a mirror doc's @graph — for the result's @type. */
function mirrorPrimaryType(doc: unknown): string | undefined {
  const graph = (doc as Record<string, unknown> | null)?.["@graph"];
  if (!Array.isArray(graph)) return undefined;
  for (const node of graph) {
    const t = (node as Record<string, unknown> | null)?.["@type"];
    if (typeof t === "string") return t;
    if (Array.isArray(t) && typeof t[0] === "string") return t[0];
  }
  return undefined;
}

/** Extractive answer assembly — verbatim excerpts + [n] citation markers. */
function assembleAnswer(chunks: Array<{ chunk: SearchChunk; score: number }>): string {
  return chunks.map(({ chunk }, i) => `[${i + 1}] ${excerptOf(chunk.text)}`).join("\n\n");
}

// ---------------------------------------------------------------------------
// Core — deterministic extractive /ask
// ---------------------------------------------------------------------------

/**
 * Run one /ask request. Returns `{ status, body }` — the adapter maps status
 * straight to the HTTP response. Every failure path is explicit (reason).
 */
export async function runNlwebAsk(
  body: unknown,
  manifest: AgentSurfaceManifest,
  searchManifest: SearchManifest,
  ports: NlwebAskPorts,
): Promise<{ status: number; body: NlwebAskResponse }> {
  const site = manifest.site;
  const defaultLang = manifest.languages.default;
  const supportedLangs = manifest.languages.supported;

  const parsed = parseNlwebRequest(body, site);
  const meta = {
    version: NLWEB_VERSION,
    query_id: "",
    response_format: NLWEB_SUPPORTED.responseFormat,
    site,
    lang: defaultLang,
    mode: NLWEB_SUPPORTED.mode,
  };
  if (!parsed.ok) {
    return {
      status: parsed.status,
      body: {
        _meta: { ...meta, response_type: "failure" },
        total_results: 0,
        results: [],
        answer: "",
        reason: parsed.reason,
      },
    };
  }

  const req = parsed.request;
  const lang = resolveAcceptLanguage(req.prefer?.["accept-language"], supportedLangs, defaultLang);
  const query_id = await nlwebQueryId(site, lang, req.query.text);
  const metaResolved = { ...meta, query_id, lang };

  // Retrieval — same seam as the search route (embedding + Vectorize).
  const embeddingResult = await ports.ai.run(SEARCH_EMBEDDING_MODEL, {
    text: [req.query.text],
  });
  const queryVector = embeddingResult.data?.[0];
  if (!queryVector) {
    return {
      status: 502,
      body: {
        _meta: { ...metaResolved, response_type: "failure" },
        total_results: 0,
        results: [],
        answer: "",
        reason: "embedding-empty",
      },
    };
  }
  const topK = req.query.topK ?? SEARCH_DEFAULT_TOP_K;
  const vectorizeResult = await ports.searchIndex.query(queryVector, {
    topK,
    returnMetadata: "all",
  });
  const chunkById = new Map<string, SearchChunk>(searchManifest.chunks.map((c) => [c.id, c]));

  // Language gate — resolved language first, default-language fallback (AC-9).
  const langMatches = (c: SearchChunk) => c.lang === lang;
  const candidates = (vectorizeResult.matches ?? [])
    .map((m) => ({ chunk: chunkById.get(m.id), score: m.score }))
    .filter((e): e is { chunk: SearchChunk; score: number } => Boolean(e.chunk));
  const grounded = candidates.filter((e) => e.score >= NLWEB_MIN_SCORE);
  const inLang = grounded.filter((e) => langMatches(e.chunk));
  const selected = (inLang.length > 0 ? inLang : grounded).slice(0, NLWEB_ANSWER_TOP_N);

  if (selected.length === 0) {
    return {
      status: 200,
      body: {
        _meta: { ...metaResolved, response_type: "answer" },
        total_results: 0,
        results: [],
        answer: noAnswerSentence(lang),
      },
    };
  }

  // schema_object mirrors — dedupe by route, tolerate missing mirrors.
  const mirrors = new Map<string, unknown | null>();
  for (const { chunk } of selected) {
    const path = nlwebMirrorPath(chunk.url);
    if (!mirrors.has(path)) mirrors.set(path, await ports.fetchMirror(path));
  }

  const results: NlwebResultItem[] = selected.map(({ chunk, score }) => {
    const doc = mirrors.get(nlwebMirrorPath(chunk.url)) as
      Record<string, unknown> | null | undefined;
    const primaryType = mirrorPrimaryType(doc) ?? "WebPage";
    const graph = Array.isArray(doc?.["@graph"]) ? (doc["@graph"] as unknown[]) : undefined;
    return {
      "@type": primaryType,
      url: chunk.canonicalUrl,
      name: chunk.title ?? chunk.heading ?? chunk.canonicalUrl,
      site,
      score,
      description: excerptOf(chunk.text),
      ...(doc
        ? { schema_object: { "@type": primaryType, ...(graph ? { "@graph": graph } : {}) } }
        : {}),
    };
  });

  return {
    status: 200,
    body: {
      _meta: { ...metaResolved, response_type: "answer" },
      total_results: results.length,
      results,
      answer: assembleAnswer(selected),
      content: results,
    },
  };
}
