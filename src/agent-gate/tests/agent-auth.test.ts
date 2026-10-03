/*
<MODULE_CONTRACT>
<purpose>RFC-1187: authorization-server core tests — EdDSA JWT primitives, challenge/register/token handlers, protected-route Bearer gate, elevated-tier pipeline behavior, anonymous fallback on registry outage.</purpose>
<keywords>RFC-1187, agent surface, gate, oauth, registration, jwt, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP>
  <entry key="tests">jwt roundtrip + rejections, challenge/register flows, token issuance + TTL, 401 + WWW-Authenticate, whoami/rotate, elevated limits + verifiedAgentId, redis-outage anonymous fallback.</entry>
</MODULE_MAP>
<CHANGE_SUMMARY>
  <item>RFC-1187: initial agent-auth tests.</item>
  <item>RFC-1187: phases 1-3 — contracts, Redis registry, AS core + Bearer pipeline</item>
  <item>RFC-1187: phases 5-7 — OAuth route/discovery generators, env schema, operator commands</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { generateKeyPair, signBytes } from "@warpgogol/werkstatt-shared/signing";
import {
  signAgentToken,
  verifyAgentToken,
  b64uEncode,
  AGENT_TOKEN_MAX_TTL_SECONDS,
  type AgentRegistration,
  type AgentRegistrationRegistry,
} from "@warpgogol/werkstatt-shared/agent";
import {
  runOAuthChallenge,
  runAgentRegister,
  runAgentToken,
  runWhoami,
  runRotate,
  resolveBearerAgent,
  type AgentAuthPorts,
} from "../agent-auth.ts";
import { createAgentGate, __resetLimiterCache, type AgentGatePorts } from "../index.ts";
import { createFixedWindowLimiter } from "../limits.ts";
import { buildAgentSurfaceManifest } from "@warpgogol/werkstatt-shared/agent";
import type { CapabilityRecord } from "@warpgogol/werkstatt-shared/ontology";

const ISSUER = "https://test.example";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** In-memory registry — mirrors the Redis contract including challenge single-use. */
function makeRegistry(
  seed: AgentRegistration[] = [],
  opts: { failGet?: boolean } = {},
): AgentRegistrationRegistry & { store: Map<string, AgentRegistration> } {
  const store = new Map(seed.map((r) => [r.agentId, r]));
  const challenges = new Set<string>();
  return {
    store,
    get: async (id) => {
      if (opts.failGet) throw new Error("redis down");
      return store.get(id) ?? null;
    },
    put: async (reg) => {
      store.set(reg.agentId, reg);
    },
    putChallenge: async (nonce) => {
      challenges.add(nonce);
    },
    consumeChallenge: async (nonce) => challenges.delete(nonce),
    list: async () => [...store.values()],
  };
}

function makeAuthPorts(
  keys: { privateKey: Uint8Array; publicKey: Uint8Array },
  registry: AgentRegistrationRegistry,
  verifier?: AgentAuthPorts["verifier"],
): AgentAuthPorts {
  return {
    registry,
    verifier: verifier ?? {
      verify: async () => ({ agentId: "agent-deadbeef00000000" }),
    },
    tokenPrivateKey: keys.privateKey,
    tokenPublicKey: keys.publicKey,
    issuer: ISSUER,
    resourceMetadataUrl: `${ISSUER}/.well-known/oauth-protected-resource`,
  };
}

// ---------------------------------------------------------------------------
// JWT primitives
// ---------------------------------------------------------------------------

test("signAgentToken/verifyAgentToken roundtrip: valid token verifies", async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const now = Math.floor(Date.now() / 1000);
  const token = await signAgentToken(
    { iss: ISSUER, sub: "agent-1", iat: now, exp: now + 600, scope: "agent.actions.elevated" },
    privateKey,
  );
  const result = await verifyAgentToken(token, publicKey, ISSUER);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.claims.sub).toBe("agent-1");
    expect(result.claims.scope).toBe("agent.actions.elevated");
  }
});

test("signAgentToken: rejects TTL above 3600s", async () => {
  const { privateKey } = await generateKeyPair();
  const now = Math.floor(Date.now() / 1000);
  await expect(
    signAgentToken(
      { iss: ISSUER, sub: "a", iat: now, exp: now + AGENT_TOKEN_MAX_TTL_SECONDS + 1 },
      privateKey,
    ),
  ).rejects.toThrow("AGENT-TOKEN-TTL");
});

test("verifyAgentToken: expired / wrong issuer / tampered signature / wrong key", async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const other = await generateKeyPair();
  const now = Math.floor(Date.now() / 1000);
  const good = await signAgentToken(
    { iss: ISSUER, sub: "a", iat: now - 100, exp: now + 100 },
    privateKey,
  );
  expect((await verifyAgentToken(good, publicKey, ISSUER)).ok).toBe(true);

  const expired = await signAgentToken(
    { iss: ISSUER, sub: "a", iat: now - 7200, exp: now - 3600 },
    privateKey,
  );
  expect(await verifyAgentToken(expired, publicKey, ISSUER)).toEqual({
    ok: false,
    reason: "expired",
  });
  expect(await verifyAgentToken(good, publicKey, "https://other.example")).toEqual({
    ok: false,
    reason: "issuer",
  });
  expect(await verifyAgentToken(good, other.publicKey, ISSUER)).toEqual({
    ok: false,
    reason: "signature",
  });
  // alg "none" header tampering — signature check must fail before claims are read.
  const parts = good.split(".");
  const tampered = `${b64uEncode(JSON.stringify({ alg: "none", typ: "JWT" }))}.${parts[1]}.`;
  const tamperedResult = await verifyAgentToken(tampered, publicKey, ISSUER);
  expect(tamperedResult.ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Challenge + register
// ---------------------------------------------------------------------------

test("runOAuthChallenge → runAgentRegister: consumes nonce once, stores hash only", async () => {
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const ports = makeAuthPorts(keys, registry);

  const challengeRes = await runOAuthChallenge(ports);
  expect(challengeRes.status).toBe(201);
  const { challenge } = (await challengeRes.json()) as { challenge: string };

  const register = (challengeValue: string) =>
    runAgentRegister(
      new Request(`${ISSUER}/api/agent/v1/registration`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signature_agent: "https://agent.example/jwks.json",
          key_proof: { challenge: challengeValue, signature: "c2ln" },
        }),
      }),
      ports,
    );

  const ok = await register(challenge);
  expect(ok.status).toBe(201);
  const body = (await ok.json()) as {
    agent_id: string;
    credential_secret: string;
    token_uri: string;
  };
  expect(body.agent_id).toBe("agent-deadbeef00000000");
  expect(body.credential_secret.startsWith("gogol-agent-")).toBe(true);

  const stored = await registry.get(body.agent_id);
  expect(stored).not.toBeNull();
  expect(stored!.credentialSecretHash).toBe(sha256Hex(body.credential_secret));
  expect(stored!.credentialSecretHash).not.toContain(body.credential_secret);

  // Replay: the same nonce must not verify twice.
  const replay = await register(challenge);
  expect(replay.status).toBe(400);
  const replayBody = (await replay.json()) as { code: string };
  expect(replayBody.code).toBe("invalid-challenge");

  // Second registration with a fresh challenge → already-registered 409.
  const { challenge: c2 } = (await (await runOAuthChallenge(ports)).json()) as {
    challenge: string;
  };
  const conflict = await register(c2);
  expect(conflict.status).toBe(409);
});

test("runAgentRegister: bad proof fails after challenge consumption", async () => {
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const ports = makeAuthPorts(keys, registry, { verify: async () => null });
  const { challenge } = (await (await runOAuthChallenge(ports)).json()) as {
    challenge: string;
  };
  const res = await runAgentRegister(
    new Request(`${ISSUER}/api/agent/v1/registration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signature_agent: "https://agent.example/jwks.json",
        key_proof: { challenge, signature: "AAAA" },
      }),
    }),
    ports,
  );
  expect(res.status).toBe(400);
  expect(((await res.json()) as { code: string }).code).toBe("invalid-proof");
});

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

async function seedRegistration(
  ports: AgentAuthPorts,
  registry: AgentRegistrationRegistry,
): Promise<{ agentId: string; secret: string }> {
  const secret = "gogol-agent-testsecret";
  const reg: AgentRegistration = {
    agentId: "agent-test0000000001",
    signatureAgent: "https://agent.example/jwks.json",
    credentialSecretHash: sha256Hex(secret),
    scopes: ["agent.actions.elevated", "agent.registration"],
    registeredAt: "2026-01-01T00:00:00.000Z",
    credentialVersion: 1,
  };
  await registry.put(reg);
  return { agentId: reg.agentId, secret };
}

test("runAgentToken: client_credentials issues a verifiable EdDSA JWT (3600s)", async () => {
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const ports = makeAuthPorts(keys, registry);
  const { agentId, secret } = await seedRegistration(ports, registry);

  const res = await runAgentToken(
    new Request(`${ISSUER}/api/agent/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${agentId}&client_secret=${secret}`,
    }),
    ports,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
  };
  expect(body.token_type).toBe("Bearer");
  expect(body.expires_in).toBe(3600);

  const claims = await verifyAgentToken(body.access_token, keys.publicKey, ISSUER);
  expect(claims.ok).toBe(true);
  if (claims.ok) {
    expect(claims.claims.sub).toBe(agentId);
    expect(claims.claims.exp - claims.claims.iat).toBe(3600);
  }
});

test("runAgentToken: wrong secret / unknown client / wrong grant → OAuth errors", async () => {
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const ports = makeAuthPorts(keys, registry);
  const { agentId } = await seedRegistration(ports, registry);

  const post = (form: string) =>
    runAgentToken(
      new Request(`${ISSUER}/api/agent/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
      }),
      ports,
    );

  expect(
    (await post(`grant_type=client_credentials&client_id=${agentId}&client_secret=wrong`)).status,
  ).toBe(401);
  expect(
    (await post(`grant_type=client_credentials&client_id=nobody&client_secret=x`)).status,
  ).toBe(401);
  expect((await post(`grant_type=password&client_id=${agentId}&client_secret=x`)).status).toBe(400);
});

// ---------------------------------------------------------------------------
// Protected routes — whoami / rotate
// ---------------------------------------------------------------------------

async function issueToken(keys: { privateKey: Uint8Array }, agentId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signAgentToken({ iss: ISSUER, sub: agentId, iat: now, exp: now + 600 }, keys.privateKey);
}

function authed(token: string, url: string, method = "GET") {
  return new Request(url, { method, headers: { authorization: `Bearer ${token}` } });
}

test("runWhoami: 401 + WWW-Authenticate resource_metadata without Bearer", async () => {
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const ports = makeAuthPorts(keys, registry);
  const res = await runWhoami(new Request(`${ISSUER}/api/agent/v1/registration/whoami`), ports);
  expect(res.status).toBe(401);
  const wwwAuth = res.headers.get("WWW-Authenticate");
  expect(wwwAuth).toContain("Bearer");
  expect(wwwAuth).toContain(`resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`);
});

test("runWhoami: valid Bearer returns the registration record", async () => {
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const ports = makeAuthPorts(keys, registry);
  const { agentId } = await seedRegistration(ports, registry);
  const token = await issueToken(keys, agentId);
  const res = await runWhoami(authed(token, `${ISSUER}/api/agent/v1/registration/whoami`), ports);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { agent_id: string; scopes: string[] };
  expect(body.agent_id).toBe(agentId);
  expect(body.scopes).toContain("agent.actions.elevated");
});

test("runRotate: issues new secret, bumps version, old secret dies", async () => {
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const ports = makeAuthPorts(keys, registry);
  const { agentId, secret } = await seedRegistration(ports, registry);
  const token = await issueToken(keys, agentId);

  const res = await runRotate(
    authed(token, `${ISSUER}/api/agent/v1/registration/rotate`, "POST"),
    ports,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { credential_secret: string; credential_version: number };
  expect(body.credential_version).toBe(2);
  expect(body.credential_secret).not.toBe(secret);

  const stored = await registry.get(agentId);
  expect(stored!.credentialSecretHash).toBe(sha256Hex(body.credential_secret));
});

test("resolveBearerAgent: revoked registration resolves to anonymous", async () => {
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const ports = makeAuthPorts(keys, registry);
  const { agentId } = await seedRegistration(ports, registry);
  const reg = await registry.get(agentId);
  await registry.put({ ...reg!, revokedAt: "2026-02-01T00:00:00.000Z" });
  const token = await issueToken(keys, agentId);
  const resolved = await resolveBearerAgent(
    authed(token, `${ISSUER}/api/agent/v1/actions/lead.submit`),
    ports,
  );
  expect(resolved).toBeNull();
});

test("resolveBearerAgent: registry outage degrades to anonymous, never throws", async () => {
  const keys = await generateKeyPair();
  const registry = makeRegistry([], { failGet: true });
  const ports = makeAuthPorts(keys, registry);
  const token = await issueToken(keys, "agent-anything000000");
  const resolved = await resolveBearerAgent(
    authed(token, `${ISSUER}/api/agent/v1/actions/lead.submit`),
    ports,
  );
  expect(resolved).toBeNull();
});

// ---------------------------------------------------------------------------
// Elevated tier in the action pipeline
// ---------------------------------------------------------------------------

const WRITE_CAP: CapabilityRecord = {
  id: "lead.submit",
  version: 2,
  kind: "action",
  sideEffect: "write",
  title: { de: "Senden", en: "Submit" },
  description: { de: "Sendet.", en: "Delivers." },
  input: {
    type: "object",
    required: ["message"],
    additionalProperties: false,
    properties: { message: { type: "string", minLength: 10, maxLength: 4000 } },
  },
  output: {
    type: "object",
    required: ["receiptId"],
    additionalProperties: false,
    properties: { receiptId: { type: "string" } },
  },
  integration: { eventKind: "lead", source: "agent" },
  requires: { entitlements: [], sections: [] },
  limits: { perMinutePerIp: 1, perMinutePerAgent: 10, maxPayloadBytes: 16384 },
};

function makeGateManifest() {
  return buildAgentSurfaceManifest({
    generatedAt: "2026-01-01T00:00:00.000Z",
    site: "test-bundle",
    baseUrl: ISSUER,
    languages: { default: "de", supported: ["de"] },
    knowledge: [],
    actions: [
      {
        id: "lead.submit",
        url: "/api/agent/v1/actions/lead.submit",
        title: WRITE_CAP.title,
        inputSchemaRef: "#/components/schemas/lead.submit-input",
        entitlement: "agent.actions",
      },
    ],
  });
}

function actionRequest(token?: string): Request {
  return new Request(`${ISSUER}/api/agent/v1/actions/lead.submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message: "hello there, this is a test" }),
  });
}

test("pipeline: verified Bearer stamps verifiedAgentId into _agentIdentity", async () => {
  __resetLimiterCache();
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const auth = makeAuthPorts(keys, registry);
  const { agentId } = await seedRegistration(auth, registry);

  const seen: Array<Record<string, unknown>> = [];
  const ports: AgentGatePorts = {
    knowledge: { read: async () => null },
    dispatch: {
      send: async (event) => {
        seen.push(event.payload);
        return {
          receiptId: event.eventId,
          status: "accepted" as const,
          duplicate: false,
          submittedAt: "2026-07-05T00:00:00.000Z",
        };
      },
    },
    now: () => new Date("2026-07-05T00:00:00.000Z"),
    createRateLimiter: (max) => createFixedWindowLimiter(60, max),
    auth,
  };
  const gate = createAgentGate(makeGateManifest(), [WRITE_CAP], ports);

  const token = await issueToken(keys, agentId);
  const res = await gate.handleAction("lead.submit", actionRequest(token));
  expect(res.status).toBe(200);
  const identity = seen[0]?._agentIdentity as Record<string, string> | undefined;
  expect(identity?.verifiedAgentId).toBe(agentId);
});

test("pipeline: anonymous caller is rate-limited at the anonymous cap; elevated agent is not", async () => {
  __resetLimiterCache();
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const auth = makeAuthPorts(keys, registry);
  const { agentId } = await seedRegistration(auth, registry);

  const ports: AgentGatePorts = {
    knowledge: { read: async () => null },
    dispatch: {
      send: async (event) => ({
        receiptId: event.eventId,
        status: "accepted" as const,
        duplicate: false,
        submittedAt: "2026-07-05T00:00:00.000Z",
      }),
    },
    now: () => new Date("2026-07-05T00:00:00.000Z"),
    createRateLimiter: (max) => createFixedWindowLimiter(60, max),
    auth,
  };
  const gate = createAgentGate(makeGateManifest(), [WRITE_CAP], ports);

  // Anonymous: perMinutePerIp = 1 → second call in the window is 429.
  await gate.handleAction("lead.submit", actionRequest());
  const second = await gate.handleAction("lead.submit", actionRequest());
  expect(second.status).toBe(429);

  // Elevated: perMinutePerAgent = 10 → several calls pass under the agent bucket.
  const token = await issueToken(keys, agentId);
  for (let i = 0; i < 3; i++) {
    const res = await gate.handleAction("lead.submit", actionRequest(token));
    expect(res.status).toBe(200);
  }
});

test("pipeline: invalid Bearer falls through to anonymous handling", async () => {
  __resetLimiterCache();
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const auth = makeAuthPorts(keys, registry);
  const ports: AgentGatePorts = {
    knowledge: { read: async () => null },
    dispatch: {
      send: async (event) => ({
        receiptId: event.eventId,
        status: "accepted" as const,
        duplicate: false,
        submittedAt: "2026-07-05T00:00:00.000Z",
      }),
    },
    now: () => new Date("2026-07-05T00:00:00.000Z"),
    createRateLimiter: (max) => createFixedWindowLimiter(60, max),
    auth,
  };
  const gate = createAgentGate(makeGateManifest(), [WRITE_CAP], ports);
  const res = await gate.handleAction("lead.submit", actionRequest("not-a-jwt"));
  expect(res.status).toBe(200);
});

// Sanity: the proof-signature primitive the verifier consumes — signature over
// challenge bytes verifies under the registrant's Ed25519 key (mirrors astro.ts).
test("key proof: Ed25519 signature over challenge bytes verifies", async () => {
  const agent = await generateKeyPair();
  const challenge = b64uEncode(randomBytes(32));
  const signature = await signBytes(agent.privateKey, new TextEncoder().encode(challenge));
  const { verifyBytes } = await import("@warpgogol/werkstatt-shared/signing");
  expect(await verifyBytes(agent.publicKey, new TextEncoder().encode(challenge), signature)).toBe(
    true,
  );
});
