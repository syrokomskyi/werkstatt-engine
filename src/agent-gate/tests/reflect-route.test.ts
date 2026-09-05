import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAgentReflectRoute } from "../reflect-route.ts";
import type { ReflectionInput, LawKernelSummary } from "../../component-runtime/reflection.ts";
import type {
  ComponentManifestV1,
  ComponentId,
  ResolvedComponentSetV1,
  ResolvedComponentIdentityV1,
} from "../../component/contracts.ts";
import { computeSetHash } from "../../component/identity.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";

const VALID_SHA = ("sha256:" + "a".repeat(64)) as Sha256Digest;

function cid(id: string): ComponentId {
  return id as ComponentId;
}

function makeManifest(overrides: Partial<ComponentManifestV1> = {}): ComponentManifestV1 {
  const componentId = overrides.componentId ?? "werkstatt/engine";
  return {
    schema: "werkstatt/component-manifest@1",
    componentId,
    version: "1.0.0",
    artifactHash: VALID_SHA as string,
    provides: [
      { capability: "werkstatt/kernel", version: "1.0.0", schemaHash: VALID_SHA as string },
    ],
    requires: [],
    requestedGrants: [],
    effects: [],
    isolation: { tier: "trusted-in-process", adapterId: null },
    resources: [{ kind: "cpu", limit: "100ms", owner: componentId, lifecycle: "process" }],
    ...overrides,
  };
}

function makeResolvedIdentity(
  overrides: Partial<ResolvedComponentIdentityV1> = {},
): ResolvedComponentIdentityV1 {
  return {
    componentId: cid("werkstatt/engine"),
    version: "1.0.0",
    artifactHash: VALID_SHA as string,
    ...overrides,
  };
}

function makeResolvedSet(): ResolvedComponentSetV1 {
  const base: Omit<ResolvedComponentSetV1, "setHash"> = {
    schema: "werkstatt/resolved-component-set@1",
    profileId: "astro-typescript-turborepo",
    components: [makeResolvedIdentity()],
    dependencyGraphHash: VALID_SHA as string,
    grantSetHash: VALID_SHA as string,
    effectPolicyHash: VALID_SHA as string,
    isolationPolicyHash: VALID_SHA as string,
  };
  const setHash = computeSetHash(base);
  return { ...base, setHash };
}

const STUB_LAW_KERNEL: LawKernelSummary = {
  activeGrants: 0,
  artifactStoreEntries: 0,
  killSwitchArmed: false,
};

function makeReflectionInput(): ReflectionInput {
  return {
    activeSet: makeResolvedSet(),
    manifests: new Map<ComponentId, ComponentManifestV1>([["werkstatt/engine", makeManifest()]]),
    observations: new Map([
      ["werkstatt/engine", { componentId: cid("werkstatt/engine"), lifecycleState: "active" }],
    ]),
    observedAt: "2026-01-01T00:00:00Z",
  };
}

function mockAPIRouteContext(clientAddress: string) {
  return {
    clientAddress,
    request: new Request("https://example.com/api/agent/reflect"),
    params: {},
    site: undefined,
    props: {},
    redirect: vi.fn(),
    url: new URL("https://example.com/api/agent/reflect"),
    locals: {},
    cookies: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      has: vi.fn(),
    },
  } as unknown as Parameters<ReturnType<typeof createAgentReflectRoute>["GET"]>[0];
}

describe("createAgentReflectRoute", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 200 with RuntimeReflectionV1 JSON for authorized request (AC-6)", async () => {
    const route = createAgentReflectRoute({
      reflectionInput: makeReflectionInput(),
      lawKernelSummary: STUB_LAW_KERNEL,
    });

    const ctx = mockAPIRouteContext("192.168.1.1");
    const response = await route.GET(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    const body = await response.json();
    expect(body.reflectedAt).toBe("2026-01-01T00:00:00Z");
    expect(body.components).toHaveLength(1);
    expect(body.components[0].componentId).toBe("werkstatt/engine");
  });

  it("returns 429 with Retry-After when rate limit exceeded (AC-6)", async () => {
    const route = createAgentReflectRoute({
      reflectionInput: makeReflectionInput(),
      lawKernelSummary: STUB_LAW_KERNEL,
    });

    const ctx = mockAPIRouteContext("10.0.0.1");

    for (let i = 0; i < 10; i++) {
      await route.GET(ctx);
    }

    const response = await route.GET(ctx);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
    const body = await response.json();
    expect(body.error).toBe("rate_limited");
  });

  it("returns 204 for OPTIONS request", async () => {
    const route = createAgentReflectRoute({
      reflectionInput: makeReflectionInput(),
      lawKernelSummary: STUB_LAW_KERNEL,
    });

    const response = await route.OPTIONS({} as never);

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
  });

  it("rate limiting is per-IP (different IPs have separate buckets)", async () => {
    const route = createAgentReflectRoute({
      reflectionInput: makeReflectionInput(),
      lawKernelSummary: STUB_LAW_KERNEL,
    });

    const ctx1 = mockAPIRouteContext("10.0.0.1");
    for (let i = 0; i < 10; i++) {
      await route.GET(ctx1);
    }

    const ctx2 = mockAPIRouteContext("10.0.0.2");
    const response = await route.GET(ctx2);

    expect(response.status).toBe(200);
  });

  it("returns CORS headers on GET response", async () => {
    const route = createAgentReflectRoute({
      reflectionInput: makeReflectionInput(),
      lawKernelSummary: STUB_LAW_KERNEL,
    });

    const ctx = mockAPIRouteContext("192.168.1.2");
    const response = await route.GET(ctx);

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
