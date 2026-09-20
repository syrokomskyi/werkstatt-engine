/*
<MODULE_CONTRACT>
<purpose>
RFC-0954: framework-free core of the agent semantic search route. Embeds the
query, queries Vectorize, joins matches to manifest chunks, and emits the
SearchResponse. RFC-1115: results carry the flattened citation shape and
tookMs is measured from real elapsed time — both testable here because this
module has no astro/cloudflare imports.
</purpose>
<non-goals>
  <item>Do not resolve env bindings or fetch the manifest — the Astro adapter
        (agent-gate/astro.ts) wires ports and HTTP.</item>
  <item>Do not parse or validate the query — parseSearchQuery stays in the adapter.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1115: extracted from astro.ts — runAgentSearch with flattened SearchResult mapping and measured tookMs.</item>
</CHANGE_SUMMARY>
*/

import {
  SEARCH_EMBEDDING_MODEL,
  SEARCH_DEFAULT_TOP_K,
  type SearchChunk,
  type SearchManifest,
  type SearchQuery,
  type SearchResult,
  type SearchResponse,
} from "@warpgogol/werkstatt-shared/agent";

/** Minimal Workers AI + Vectorize port surface the search core needs. */
export interface AgentSearchPorts {
  ai: { run(model: string, options: { text: string[] }): Promise<{ data: number[][] }> };
  searchIndex: {
    query(
      vector: number[],
      options: { topK: number; returnMetadata?: "all" | "none" },
    ): Promise<{
      matches?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>;
    }>;
  };
}

/**
 * Run one semantic search: embed the query, query the vector index, join
 * matches to manifest chunks, and emit flattened citation results.
 * `now` is injectable so tookMs is verifiable in tests.
 */
export async function runAgentSearch(
  query: SearchQuery,
  manifest: SearchManifest,
  ports: AgentSearchPorts,
  now: () => number = Date.now,
): Promise<SearchResponse> {
  const chunkById = new Map<string, SearchChunk>(manifest.chunks.map((c) => [c.id, c]));

  const startedAt = now();
  const embeddingResult = await ports.ai.run(SEARCH_EMBEDDING_MODEL, {
    text: [query.q],
  });
  const queryVector = embeddingResult.data[0];

  const vectorizeResult = await ports.searchIndex.query(queryVector, {
    topK: query.topK ?? SEARCH_DEFAULT_TOP_K,
    returnMetadata: "all",
  });

  // RFC-1115: flattened citation shape — agents cite without a follow-up fetch.
  const results: SearchResult[] = [];
  for (const match of vectorizeResult.matches ?? []) {
    const chunk = chunkById.get(match.id);
    if (!chunk) continue;
    results.push({
      title: chunk.title,
      canonicalUrl: chunk.canonicalUrl,
      updatedAt: chunk.updatedAt,
      lang: chunk.lang,
      type: chunk.type,
      score: match.score,
      text: chunk.text,
    });
  }

  return {
    query: query.q,
    results,
    tookMs: now() - startedAt,
  };
}
