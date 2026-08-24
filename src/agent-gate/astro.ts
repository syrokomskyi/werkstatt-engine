/*
<MODULE_CONTRACT>
<purpose>
RFC-0290: the only astro-aware module in this package. Wires createAgentGate
into ready-to-export Astro APIRoutes: reads the QStash publish secret via
astro:env/server (the same substrate the send-message section already uses,
RFC-0181), and reads knowledge files by self-fetching the site's own static
public/ assets (works identically in dev and on Cloudflare Workers).
</purpose>
<non-goals>
  <item>Do not implement gate logic here — that is index.ts/mcp/*; this module
        only wires ports and exposes Astro's GET/POST shape.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0290: initial Astro adapter.</item>
</CHANGE_SUMMARY>
*/

import type { APIRoute } from "astro";
import { UPSTASH_QSTASH_TOKEN } from "astro:env/server";
import { buildQstashPublish } from "@warpgogol/werkstatt-shared/integration";
import type { AgentSurfaceManifest } from "@warpgogol/werkstatt-shared/share/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";
import { createAgentGate, type AgentGatePorts } from "./index.ts";
import { createFixedWindowLimiter } from "./limits.ts";

function buildPorts(manifest: AgentSurfaceManifest, request: Request): AgentGatePorts {
  return {
    knowledge: {
      async read(path: string): Promise<string | null> {
        try {
          const res = await fetch(new URL(path, request.url));
          return res.ok ? await res.text() : null;
        } catch {
          return null;
        }
      },
    },
    dispatch: {
      async send(event) {
        const publishRequest = buildQstashPublish(event, {
          token: UPSTASH_QSTASH_TOKEN ?? "",
          callbackUrl: `${manifest.baseUrl}/api/integration-route`,
        });
        const res = await fetch(publishRequest);
        if (!res.ok) throw new Error(`QStash publish responded ${res.status}`);
        return { accepted: true, eventId: event.eventId };
      },
    },
    now: () => new Date(),
    // RFC-0291: 60-second fixed window per capability per IP.
    createRateLimiter: (maxPerWindow) => createFixedWindowLimiter(60, maxPerWindow),
  };
}

/** Factory the generated apps/<site>/src/pages/api/agent/mcp.ts calls with its manifest + capabilities. */
export function createAgentMcpRoute(
  manifest: AgentSurfaceManifest,
  catalog: CapabilityRecord[],
): { GET: APIRoute; POST: APIRoute } {
  return {
    GET: async () => new Response(null, { status: 405, headers: { Allow: "POST" } }),
    POST: async ({ request }) => {
      const gate = createAgentGate(manifest, catalog, buildPorts(manifest, request));
      return gate.handleMcp(request);
    },
  };
}

/** Factory the generated apps/<site>/src/pages/api/agent/actions/[id].ts calls. */
export function createAgentActionRoute(
  manifest: AgentSurfaceManifest,
  catalog: CapabilityRecord[],
): { POST: APIRoute } {
  return {
    POST: async ({ request, params }) => {
      const gate = createAgentGate(manifest, catalog, buildPorts(manifest, request));
      return gate.handleAction(String(params.id ?? ""), request);
    },
  };
}
