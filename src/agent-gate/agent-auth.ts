/*
<MODULE_CONTRACT>
<purpose>
RFC-1187: the worker-hosted agent authorization server core — pure,
framework-free handlers for challenge issuance, key-proof registration,
client_credentials token issuance, JWKS, and the protected self-management
surface (whoami, rotate). Also owns Bearer resolution for the action
pipeline: a verified token upgrades the request to the registered tier
(elevated limits + verifiedAgentId attribution); every failure degrades to
anonymous, never to an error.
</purpose>
<non-goals>
  <item>Do not fetch, read env, or touch Redis directly — ports do that
        (AgentAuthPorts, injected by astro.ts).</item>
  <item>Do not decide whether auth is enabled — a missing `ports.auth` IS the
        disabled state; callers check it, these handlers assume it exists.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1187: initial authorization-server core — challenge/register/token/jwks/whoami/rotate + Bearer resolution.</item>
  <item>RFC-1187: phases 1-3 — contracts, Redis registry, AS core + Bearer pipeline</item>
</CHANGE_SUMMARY>
*/

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  buildAgentProblem,
  signAgentToken,
  b64uEncode,
  verifyAgentToken,
  AGENT_TOKEN_MAX_TTL_SECONDS,
  AGENT_SCOPE_ACTIONS_ELEVATED,
  AGENT_SCOPE_REGISTRATION_SELF,
  type AgentProblemDetails,
  type AgentRegistration,
  type AgentRegistrationRegistry,
  type AgentRegistrationVerifier,
  type VerifiedAgent,
} from "@warpgogol/werkstatt-shared/agent";

/** RFC-1187: everything the AS needs from the runtime — injected by astro.ts. */
export interface AgentAuthPorts {
  registry: AgentRegistrationRegistry;
  verifier: AgentRegistrationVerifier;
  /** Ed25519 seed — signs access tokens (the site passport key). */
  tokenPrivateKey: Uint8Array;
  /** Public half — verifies Bearer tokens locally (derived from the private key). */
  tokenPublicKey: Uint8Array;
  /** Site origin — JWT `iss` and the issuer field in discovery metadata. */
  issuer: string;
  /** Absolute URL of the RFC 9728 protected-resource document. */
  resourceMetadataUrl: string;
}

const CHALLENGE_TTL_SECONDS = 300;

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

function problemResponse(
  problem: AgentProblemDetails,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: { "content-type": "application/problem+json", ...extraHeaders },
  });
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** RFC 6749 §5.2 error envelope for the token endpoint (OAuth semantics, not problem+json). */
function oauthErrorResponse(
  error: "invalid_request" | "invalid_client" | "unsupported_grant_type",
  status: number,
): Response {
  return jsonResponse({ error }, status);
}

/** POST /api/agent/oauth/challenge — issue a single-use registration nonce. */
export async function runOAuthChallenge(ports: AgentAuthPorts): Promise<Response> {
  const nonce = b64uEncode(randomBytes(32));
  await ports.registry.putChallenge(nonce, CHALLENGE_TTL_SECONDS);
  return jsonResponse(
    {
      challenge: nonce,
      expires_at: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000).toISOString(),
      expires_in: CHALLENGE_TTL_SECONDS,
    },
    201,
  );
}

/**
 * POST /api/agent/v1/registration — WBA key-proof registration. The challenge
 * is consumed BEFORE verification (a failed proof still burns the nonce —
 * re-request a challenge to retry). On success the credential secret is
 * returned exactly once; only its sha256 is persisted.
 */
export async function runAgentRegister(
  request: Request,
  ports: AgentAuthPorts,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return problemResponse(buildAgentProblem("invalid-json"));
  }
  const signatureAgent = typeof body.signature_agent === "string" ? body.signature_agent : null;
  const keyProof =
    typeof body.key_proof === "object" && body.key_proof !== null
      ? (body.key_proof as Record<string, unknown>)
      : null;
  const challenge = typeof keyProof?.challenge === "string" ? keyProof.challenge : null;
  const signature = typeof keyProof?.signature === "string" ? keyProof.signature : null;
  const kid = typeof keyProof?.kid === "string" ? keyProof.kid : undefined;
  if (!signatureAgent || !challenge || !signature) {
    return problemResponse(
      buildAgentProblem("schema-violation", {
        detail: "Expected {signature_agent, key_proof: {challenge, signature}}.",
      }),
    );
  }

  const consumed = await ports.registry.consumeChallenge(challenge);
  if (!consumed) {
    return problemResponse(buildAgentProblem("invalid-challenge"));
  }
  const verified = await ports.verifier.verify({ signatureAgent, signature, challenge, kid });
  if (!verified) {
    return problemResponse(buildAgentProblem("invalid-proof"));
  }

  const existing = await ports.registry.get(verified.agentId);
  if (existing && !existing.revokedAt) {
    return problemResponse(
      buildAgentProblem("already-registered", {
        detail: `Agent "${verified.agentId}" is already registered — use the rotate endpoint.`,
      }),
    );
  }

  const credentialSecret = `gogol-agent-${b64uEncode(randomBytes(32))}`;
  const registration: AgentRegistration = {
    agentId: verified.agentId,
    signatureAgent,
    credentialSecretHash: sha256Hex(credentialSecret),
    scopes: [AGENT_SCOPE_ACTIONS_ELEVATED, AGENT_SCOPE_REGISTRATION_SELF],
    registeredAt: new Date().toISOString(),
    credentialVersion: (existing?.credentialVersion ?? 0) + 1,
  };
  await ports.registry.put(registration);

  return jsonResponse(
    {
      agent_id: registration.agentId,
      credential_secret: credentialSecret,
      scopes: registration.scopes,
      token_uri: `${ports.issuer}/api/agent/oauth/token`,
      credential_types_supported: ["secret"],
    },
    201,
  );
}

/** Read a token request body in either OAuth form-encoding or JSON. */
async function readTokenBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(await request.text());
    return Object.fromEntries(params.entries());
  }
  try {
    const parsed = (await request.json()) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  } catch {
    return {};
  }
}

/**
 * POST /api/agent/oauth/token — client_credentials grant. Credential check is
 * sha256(secret) vs the stored hash; a successful check issues an EdDSA JWT
 * (sub = agentId, iss = site origin, TTL ≤ 3600s, scope from registration).
 */
export async function runAgentToken(
  request: Request,
  ports: AgentAuthPorts,
): Promise<Response> {
  const body = await readTokenBody(request);
  if (body.grant_type !== "client_credentials") {
    return oauthErrorResponse("unsupported_grant_type", 400);
  }
  const clientId = body.client_id;
  const clientSecret = body.client_secret;
  if (!clientId || !clientSecret) {
    return oauthErrorResponse("invalid_request", 400);
  }
  const registration = await ports.registry.get(clientId);
  if (!registration || registration.revokedAt) {
    return oauthErrorResponse("invalid_client", 401);
  }
  if (sha256Hex(clientSecret) !== registration.credentialSecretHash) {
    return oauthErrorResponse("invalid_client", 401);
  }
  const now = Math.floor(Date.now() / 1000);
  const token = await signAgentToken(
    {
      iss: ports.issuer,
      sub: registration.agentId,
      iat: now,
      exp: now + AGENT_TOKEN_MAX_TTL_SECONDS,
      scope: registration.scopes.join(" "),
      jti: randomUUID(),
    },
    ports.tokenPrivateKey,
  );
  return jsonResponse({
    access_token: token,
    token_type: "Bearer",
    expires_in: AGENT_TOKEN_MAX_TTL_SECONDS,
  });
}

/** GET /api/agent/oauth/jwks.json — the RFC-1188 directory shares key "v1". */
export function runAgentJwks(publicKeyJwk: JsonWebKey): Response {
  return jsonResponse(
    { keys: [publicKeyJwk] },
    200,
    { "cache-control": "public, max-age=300" },
  );
}

/**
 * Resolve a Bearer token into the registered-tier identity. Every failure —
 * malformed header, bad signature, expired, revoked, registry down — resolves
 * to null (anonymous), never throws. The action pipeline treats null as
 * "keep the anonymous contract".
 */
export async function resolveBearerAgent(
  request: Request,
  ports: AgentAuthPorts,
): Promise<VerifiedAgent | null> {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  try {
    const result = await verifyAgentToken(token, ports.tokenPublicKey, ports.issuer);
    if (!result.ok) return null;
    const registration = await ports.registry.get(result.claims.sub);
    if (!registration || registration.revokedAt) return null;
    return {
      agentId: registration.agentId,
      scopes: registration.scopes,
    };
  } catch (err) {
    // Registry/Redis outage: degrade to anonymous with a warning (operator decision).
    console.warn(
      `agent-auth: Bearer resolution failed, falling back to anonymous: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Bearer gate for protected self-management routes — unlike the action
 * pipeline these routes REQUIRE identity. Returns the VerifiedAgent or a 401
 * problem whose WWW-Authenticate carries the RFC 9728 resource_metadata link.
 */
export async function requireBearerAgent(
  request: Request,
  ports: AgentAuthPorts,
): Promise<VerifiedAgent | Response> {
  const agent = await resolveBearerAgent(request, ports);
  if (agent) return agent;
  return problemResponse(
    buildAgentProblem("unauthorized", {
      detail: "A valid Bearer token is required for this endpoint.",
    }),
    {
      "WWW-Authenticate": `Bearer realm="agent", resource_metadata="${ports.resourceMetadataUrl}"`,
    },
  );
}

/** GET /api/agent/v1/registration/whoami — authenticated self-report. */
export async function runWhoami(request: Request, ports: AgentAuthPorts): Promise<Response> {
  const agent = await requireBearerAgent(request, ports);
  if (agent instanceof Response) return agent;
  const registration = await ports.registry.get(agent.agentId);
  if (!registration) {
    return problemResponse(
      buildAgentProblem("unauthorized", { detail: "Registration no longer exists." }),
      {
        "WWW-Authenticate": `Bearer realm="agent", resource_metadata="${ports.resourceMetadataUrl}"`,
      },
    );
  }
  return jsonResponse({
    agent_id: registration.agentId,
    signature_agent: registration.signatureAgent,
    scopes: registration.scopes,
    registered_at: registration.registeredAt,
    credential_version: registration.credentialVersion,
  });
}

/**
 * POST /api/agent/v1/registration/rotate — issue a new credential secret and
 * bump credentialVersion. The new secret is returned once; the old secret
 * stops working immediately (the hash is replaced). Live access tokens are
 * unaffected — they expire on their own clock (≤ 1h).
 */
export async function runRotate(request: Request, ports: AgentAuthPorts): Promise<Response> {
  const agent = await requireBearerAgent(request, ports);
  if (agent instanceof Response) return agent;
  const registration = await ports.registry.get(agent.agentId);
  if (!registration) {
    return problemResponse(
      buildAgentProblem("unauthorized", { detail: "Registration no longer exists." }),
      {
        "WWW-Authenticate": `Bearer realm="agent", resource_metadata="${ports.resourceMetadataUrl}"`,
      },
    );
  }
  const credentialSecret = `gogol-agent-${b64uEncode(randomBytes(32))}`;
  const rotated: AgentRegistration = {
    ...registration,
    credentialSecretHash: sha256Hex(credentialSecret),
    credentialVersion: registration.credentialVersion + 1,
  };
  await ports.registry.put(rotated);
  return jsonResponse({
    agent_id: rotated.agentId,
    credential_secret: credentialSecret,
    credential_version: rotated.credentialVersion,
  });
}
