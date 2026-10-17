/*
<MODULE_CONTRACT>
<purpose>
Unit tests for agent auth covering its documented public contract and regression-sensitive edge cases.
</purpose>
<non-goals>
  <item>Not a contract source of truth — the module under test owns the authoritative behavior; fixtures are minimal scaffolding only.</item>
</non-goals>
</MODULE_CONTRACT>
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
    keyVersion: "v1",
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
    "v1",
  );
  const result = await verifyAgentToken(token, publicKey, ISSUER);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.claims.sub).toBe("agent-1");
    expect(result.claims.scope).toBe("agent.actions.elevated");
  }
});

test("signAgentToken: header carries alg/typ/kid — AC-2 contract", async () => {
  const { privateKey } = await generateKeyPair();
  const now = Math.floor(Date.now() / 1000);
  const token = await signAgentToken(
    { iss: ISSUER, sub: "a", iat: now, exp: now + 60 },
    privateKey,
    "v7",
  );
  const [headerB64] = token.split(".");
  const header = JSON.parse(
    new TextDecoder().decode(Buffer.from(headerB64, "base64url")),
  ) as Record<string, string>;
  expect(header).toEqual({ alg: "EdDSA", typ: "JWT", kid: "v7" });
});

test("verifyAgentToken: kid-less or wrong-typ header rejected before signature", async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const now = Math.floor(Date.now() / 1000);
  const good = await signAgentToken(
    { iss: ISSUER, sub: "a", iat: now, exp: now + 60 },
    privateKey,
    "v1",
  );
  const [, payloadB64] = good.split(".");
  const noKid = `${b64uEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT" }))}.${payloadB64}.AAAA`;
  expect(await verifyAgentToken(noKid, publicKey, ISSUER)).toEqual({
    ok: false,
    reason: "header",
  });
  const wrongTyp = `${b64uEncode(JSON.stringify({ alg: "EdDSA", typ: "JWT+at", kid: "v1" }))}.${payloadB64}.AAAA`;
  expect(await verifyAgentToken(wrongTyp, publicKey, ISSUER)).toEqual({
    ok: false,
    reason: "header",
  });
});

test("signAgentToken: rejects TTL above 3600s", async () => {
  const { privateKey } = await generateKeyPair();
  const now = Math.floor(Date.now() / 1000);
  await expect(
    signAgentToken(
      { iss: ISSUER, sub: "a", iat: now, exp: now + AGENT_TOKEN_MAX_TTL_SECONDS + 1 },
      privateKey,
      "v1",
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
    "v1",
  );
  expect((await verifyAgentToken(good, publicKey, ISSUER)).ok).toBe(true);

  const expired = await signAgentToken(
    { iss: ISSUER, sub: "a", iat: now - 7200, exp: now - 3600 },
    privateKey,
    "v1",
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
  return signAgentToken(
    { iss: ISSUER, sub: agentId, iat: now, exp: now + 600 },
    keys.privateKey,
    "v1",
  );
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
  // RFC-1187: the realm is the site origin — never the generic "agent".
  expect(wwwAuth).toContain(`realm="${ISSUER}"`);
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

// ---------------------------------------------------------------------------
// Auth-endpoint body cap (64 KiB streamed)
// ---------------------------------------------------------------------------

test("runAgentRegister: body over 64 KiB → 413 payload-too-large", async () => {
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const ports = makeAuthPorts(keys, registry);
  const res = await runAgentRegister(
    new Request(`${ISSUER}/api/agent/v1/registration`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(70 * 1024),
      },
      body: "x".repeat(70 * 1024),
    }),
    ports,
  );
  expect(res.status).toBe(413);
  expect(((await res.json()) as { code: string }).code).toBe("payload-too-large");
});

test("runAgentToken: over-cap form body → 413, not a parse error", async () => {
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const ports = makeAuthPorts(keys, registry);
  const res = await runAgentToken(
    new Request(`${ISSUER}/api/agent/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(70 * 1024),
      },
      body: `grant_type=client_credentials&pad=${"x".repeat(70 * 1024)}`,
    }),
    ports,
  );
  expect(res.status).toBe(413);
});

// ---------------------------------------------------------------------------
// Bearer on MCP transport — same elevated-tier contract as the HTTP route
// ---------------------------------------------------------------------------

function mcpCall(token?: string): Request {
  return new Request(`${ISSUER}/api/agent/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "action.lead.submit",
        arguments: { message: "hello there, this is a test" },
        _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
      },
    }),
  });
}

function makeMcpPorts(auth: AgentAuthPorts, seen: Array<Record<string, unknown>>): AgentGatePorts {
  return {
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
}

test("MCP tools/call: verified Bearer stamps verifiedAgentId + elevated bucket", async () => {
  __resetLimiterCache();
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const auth = makeAuthPorts(keys, registry);
  const { agentId } = await seedRegistration(auth, registry);
  const seen: Array<Record<string, unknown>> = [];
  const gate = createAgentGate(makeGateManifest(), [WRITE_CAP], makeMcpPorts(auth, seen));

  const token = await issueToken(keys, agentId);
  // Elevated bucket (per-agent max 10): three calls pass; verifiedAgentId stamped.
  for (let i = 0; i < 3; i++) {
    const res = await gate.handleMcp(mcpCall(token));
    expect(res.status).toBe(200);
    const rpc = (await res.json()) as { error?: unknown };
    expect(rpc.error).toBeUndefined();
  }
  const identity = seen[0]?._agentIdentity as Record<string, string> | undefined;
  expect(identity?.verifiedAgentId).toBe(agentId);
});

test("MCP tools/call: anonymous caller is per-IP limited; Bearer bypasses it", async () => {
  __resetLimiterCache();
  const keys = await generateKeyPair();
  const registry = makeRegistry();
  const auth = makeAuthPorts(keys, registry);
  const { agentId } = await seedRegistration(auth, registry);
  const gate = createAgentGate(makeGateManifest(), [WRITE_CAP], makeMcpPorts(auth, []));

  // Anonymous: perMinutePerIp = 1 → second call is a JSON-RPC rate-limit error (HTTP 200).
  const first = await gate.handleMcp(mcpCall());
  expect(((await first.json()) as { error?: unknown }).error).toBeUndefined();
  const second = await gate.handleMcp(mcpCall());
  expect(((await second.json()) as { error?: unknown }).error).toBeDefined();

  // Verified Bearer: the per-agent bucket is untouched by the IP bucket.
  const token = await issueToken(keys, agentId);
  const elevated = await gate.handleMcp(mcpCall(token));
  expect(((await elevated.json()) as { error?: unknown }).error).toBeUndefined();
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
