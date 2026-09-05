/*
<MODULE_CONTRACT>
<purpose>
RFC-1030: Astro API route factory for live runtime reflection. Exposes
RuntimeReflectionV1 as JSON via GET /api/agent/reflect. Per-IP rate limited
(10 req/min, in-memory per-isolate soft limit). ACCESS_PIN middleware is
respected at the Astro middleware layer — this route only returns data.
</purpose>
<non-goals>
  <item>Do not implement gate logic — that is index.ts/mcp/*; this module
        only wires the reflection API into an Astro APIRoute.</item>
  <item>Do not implement rate limiting logic — reuses createFixedWindowLimiter from limits.ts.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1030: initial reflect route factory.</item>
</CHANGE_SUMMARY>
*/

import type { APIRoute } from "astro";
import { createFixedWindowLimiter } from "./limits.ts";
import {
  reflectRuntime,
  assertNoForbiddenFields,
  type LawKernelSummary,
  type ReflectionInput,
  type RuntimeReflectionV1,
} from "../component-runtime/reflection.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const REFLECT_RATE_LIMITER = createFixedWindowLimiter(60, 10);

function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export interface CreateAgentReflectRouteOptions {
  reflectionInput: ReflectionInput;
  lawKernelSummary: LawKernelSummary;
}

export function createAgentReflectRoute(
  options: CreateAgentReflectRouteOptions,
): { GET: APIRoute; OPTIONS: APIRoute } {
  return {
    GET: async ({ clientAddress }) => {
      const limit = REFLECT_RATE_LIMITER.check(clientAddress || "unknown");
      if (!limit.allowed) {
        return withCors(
          new Response(JSON.stringify({ error: "rate_limited" }), {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(limit.retryAfterSeconds),
            },
          }),
        );
      }

      try {
        const reflection = reflectRuntime(options.reflectionInput, options.lawKernelSummary);
        assertNoForbiddenFieldsReflection(reflection);
        return withCors(
          new Response(JSON.stringify(reflection), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "internal error";
        return withCors(
          new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    },
    OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  };
}

function assertNoForbiddenFieldsReflection(reflection: RuntimeReflectionV1): void {
  const json = JSON.stringify(reflection);
  const forbidden = [
    "secrets",
    "credentials",
    "privateState",
    "rawGrants",
    "prompts",
    "executableBytes",
    "leaseTokens",
    "authorityMaterial",
    "artifactBytes",
    "sourceCode",
  ];
  for (const field of forbidden) {
    if (json.includes(field)) {
      throw new Error(`REFLECTION-02: reflection contains forbidden field name: ${field}`);
    }
  }
}
