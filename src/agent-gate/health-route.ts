/*
<MODULE_CONTRACT>
<purpose>
RFC-1116: core logic for GET /api/agent/health — assembles the AgentHealth
payload by self-fetching the deployed agent.json, one knowledge ref, and
build-identity.json, plus reporting binding presence (dispatch token, search
bindings). Framework-free: no astro imports, vitest-loadable — the Astro
adapter in astro.ts only resolves env and wraps the response in CORS headers.
</purpose>
<non-goals>
  <item>Do not resolve astro:env or cloudflare:workers here — the adapter
        injects env + token via AgentHealthDeps.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1116: initial implementation — runAgentHealth core extracted for testability.</item>
</CHANGE_SUMMARY>
*/

import { AGENT_SURFACE_VERSION } from "@warpgogol/werkstatt-shared/agent";
import type { AgentHealth, AgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";
import { BUILD_IDENTITY_PATH } from "../leitstand/cache-purge.ts";

/** Runtime bindings the health probe reports on — presence only, never values. */
export interface AgentHealthDeps {
  /** The incoming request URL — self-fetch resolves same-origin paths against it. */
  requestUrl: string;
  fetchFn: typeof fetch;
  env: {
    AI?: unknown;
    SEARCH_INDEX?: unknown;
    ASSETS?: { fetch(request: Request): Promise<Response> };
  };
  /** UPSTASH_QSTASH_TOKEN value or undefined — presence is all that is reported. */
  qstashToken: string | undefined;
}

/** Self-fetch a same-origin path — ASSETS binding on Workers, plain fetch in dev. */
async function selfFetch(deps: AgentHealthDeps, path: string): Promise<Response | null> {
  try {
    const url = new URL(path, deps.requestUrl);
    return deps.env.ASSETS
      ? await deps.env.ASSETS.fetch(new Request(url))
      : await deps.fetchFn(url);
  } catch {
    return null;
  }
}

/**
 * Assemble the AgentHealth payload. `degraded` when the manifest or a declared
 * knowledge ref is unreachable, the dispatch token is absent, or the surface
 * advertises search while its bindings are missing. Returns the HTTP status
 * alongside the body so the adapter stays a thin wrapper.
 */
export async function runAgentHealth(
  manifest: AgentSurfaceManifest,
  deps: AgentHealthDeps,
): Promise<{ status: number; body: AgentHealth }> {
  const manifestRes = await selfFetch(deps, "/.well-known/agent.json");
  const manifestOk = manifestRes?.ok === true;

  const knowledgeRef = manifest.knowledge[0]?.url;
  const knowledgeOk = knowledgeRef
    ? (await selfFetch(deps, knowledgeRef))?.ok === true
    : true; // vacuous — surface declares no knowledge refs

  const identityRes = await selfFetch(deps, BUILD_IDENTITY_PATH);
  let contentHash = "";
  if (identityRes?.ok) {
    try {
      const identity = (await identityRes.json()) as { distTreeHash?: string };
      contentHash = identity.distTreeHash ?? "";
    } catch {
      contentHash = "";
    }
  }

  const dispatchConfigured = Boolean(deps.qstashToken);
  const searchAvailable = Boolean(deps.env.AI && deps.env.SEARCH_INDEX);
  const searchAdvertised = manifest.interfaces.search !== null;

  const degraded =
    !manifestOk || !knowledgeOk || !dispatchConfigured || (searchAdvertised && !searchAvailable);

  return {
    status: degraded ? 503 : 200,
    body: {
      status: degraded ? "degraded" : "ok",
      surfaceVersion: AGENT_SURFACE_VERSION,
      contentHash,
      checks: {
        manifest: manifestOk ? "ok" : "missing",
        knowledge: knowledgeOk ? "ok" : "missing",
        dispatch: dispatchConfigured ? "configured" : "unconfigured",
        search: searchAvailable ? "available" : "unavailable",
      },
    },
  };
}
