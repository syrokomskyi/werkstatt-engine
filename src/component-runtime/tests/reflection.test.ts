import { describe, it, expect } from "vitest";
import {
  createCapabilityCatalog,
  assertNoForbiddenFields,
  toReflectedState,
  reflectRuntime,
  type CapabilityCatalogV1,
  type LiveComponentObservation,
  type LawKernelSummary,
  type RuntimeReflectionV1,
} from "../reflection.ts";
import type {
  ComponentManifestV1,
  ComponentId,
  CapabilityId,
  ResolvedComponentSetV1,
  ResolvedComponentIdentityV1,
} from "../../component/contracts.ts";
import { computeSetHash } from "../../component/identity.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";

const VALID_SHA = ("sha256:" + "a".repeat(64)) as Sha256Digest;
const _VALID_SHA_2 = ("sha256:" + "b".repeat(64)) as Sha256Digest;

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
    scope: "per-workshop",
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

function makeResolvedSet(
  overrides: Partial<Omit<ResolvedComponentSetV1, "setHash">> = {},
): ResolvedComponentSetV1 {
  const base: Omit<ResolvedComponentSetV1, "setHash"> = {
    schema: "werkstatt/resolved-component-set@1",
    profileId: "astro-typescript-turborepo",
    components: [makeResolvedIdentity()],
    dependencyGraphHash: VALID_SHA as string,
    grantSetHash: VALID_SHA as string,
    effectPolicyHash: VALID_SHA as string,
    isolationPolicyHash: VALID_SHA as string,
    ...overrides,
  };
  const setHash = computeSetHash(base);
  return { ...base, setHash };
}

describe("createCapabilityCatalog", () => {
  it("creates a catalog with correct schema and hash binding", () => {
    const set = makeResolvedSet();
    const manifests = new Map<ComponentId, ComponentManifestV1>([
      ["werkstatt/engine", makeManifest()],
    ]);
    const observations = new Map<ComponentId, LiveComponentObservation>([
      ["werkstatt/engine", { componentId: cid("werkstatt/engine"), lifecycleState: "active" }],
    ]);

    const catalog = createCapabilityCatalog({
      activeSet: set,
      manifests,
      observations,
      observedAt: "2026-01-01T00:00:00Z",
    });

    expect(catalog.schema).toBe("werkstatt/capability-catalog@1");
    expect(catalog.observedAt).toBe("2026-01-01T00:00:00Z");
    expect(catalog.resolvedComponentSetHash).toBe(set.setHash);
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]!.capability).toBe("werkstatt/kernel");
    expect(catalog.entries[0]!.componentId).toBe("werkstatt/engine");
    expect(catalog.entries[0]!.lifecycleState).toBe("active");
    expect(catalog.entries[0]!.callable).toBe(true);
    expect(catalog.catalogHash).toBeTruthy();
  });

  it("throws REFLECTION-01 when set hash is mismatched", () => {
    const set = makeResolvedSet();
    const tampered: ResolvedComponentSetV1 = {
      ...set,
      setHash: ("sha256:" + "0".repeat(64)) as string,
    };

    const manifests = new Map<ComponentId, ComponentManifestV1>([
      ["werkstatt/engine", makeManifest()],
    ]);
    const observations = new Map<ComponentId, LiveComponentObservation>([
      ["werkstatt/engine", { componentId: cid("werkstatt/engine"), lifecycleState: "active" }],
    ]);

    expect(() =>
      createCapabilityCatalog({
        activeSet: tampered,
        manifests,
        observations,
      }),
    ).toThrow(/REFLECTION-01/);
  });

  it("maps lifecycle states to reflected states correctly", () => {
    const identity = makeResolvedIdentity();
    const _set = makeResolvedSet({ components: [identity] });
    const _manifests = new Map<ComponentId, ComponentManifestV1>([
      ["werkstatt/engine", makeManifest()],
    ]);

    const cases: Array<{
      input: import("../lifecycle.ts").ComponentLifecycleState;
      expected: import("../reflection.ts").ReflectedLifecycleState;
    }> = [
      { input: "declared", expected: "waiting" },
      { input: "waiting", expected: "waiting" },
      { input: "loading", expected: "waiting" },
      { input: "active", expected: "active" },
      { input: "draining", expected: "draining" },
      { input: "unloading", expected: "draining" },
      { input: "disposed", expected: "failed" },
      { input: "failed", expected: "failed" },
      { input: "quarantined", expected: "quarantined" },
    ];

    for (const { input, expected } of cases) {
      expect(toReflectedState(input)).toBe(expected);
    }
  });

  it("callable is false for non-active states", () => {
    const identity = makeResolvedIdentity();
    const set = makeResolvedSet({ components: [identity] });
    const manifests = new Map<ComponentId, ComponentManifestV1>([
      ["werkstatt/engine", makeManifest()],
    ]);

    const nonActiveStates: import("../lifecycle.ts").ComponentLifecycleState[] = [
      "waiting",
      "draining",
      "failed",
      "quarantined",
    ];

    for (const state of nonActiveStates) {
      const observations = new Map<ComponentId, LiveComponentObservation>([
        ["werkstatt/engine", { componentId: cid("werkstatt/engine"), lifecycleState: state }],
      ]);
      const catalog = createCapabilityCatalog({
        activeSet: set,
        manifests,
        observations,
      });
      expect(catalog.entries[0]!.callable).toBe(false);
    }
  });

  it("filters by visible capabilities when provided", () => {
    const manifest = makeManifest({
      provides: [
        { capability: "werkstatt/kernel", version: "1.0.0", schemaHash: VALID_SHA as string },
        { capability: "werkstatt/secret", version: "1.0.0", schemaHash: VALID_SHA as string },
      ],
    });
    const identity = makeResolvedIdentity();
    const set = makeResolvedSet({ components: [identity] });
    const manifests = new Map<ComponentId, ComponentManifestV1>([["werkstatt/engine", manifest]]);
    const observations = new Map<ComponentId, LiveComponentObservation>([
      ["werkstatt/engine", { componentId: cid("werkstatt/engine"), lifecycleState: "active" }],
    ]);

    const visible = new Set<CapabilityId>(["werkstatt/kernel"]);
    const catalog = createCapabilityCatalog({
      activeSet: set,
      manifests,
      observations,
      visibleCapabilities: visible,
    });

    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]!.capability).toBe("werkstatt/kernel");
  });

  it("omits components without manifests", () => {
    const identity = makeResolvedIdentity();
    const set = makeResolvedSet({ components: [identity] });
    const observations = new Map<ComponentId, LiveComponentObservation>([
      ["werkstatt/engine", { componentId: cid("werkstatt/engine"), lifecycleState: "active" }],
    ]);

    const catalog = createCapabilityCatalog({
      activeSet: set,
      manifests: new Map(),
      observations,
    });

    expect(catalog.entries).toHaveLength(0);
  });

  it("sorts entries canonically by capability, version, componentId", () => {
    const manifestA = makeManifest({
      componentId: cid("werkstatt/alpha"),
      provides: [
        { capability: "werkstatt/zeta", version: "1.0.0", schemaHash: VALID_SHA as string },
        { capability: "werkstatt/alpha", version: "1.0.0", schemaHash: VALID_SHA as string },
      ],
    });
    const manifestB = makeManifest({
      componentId: cid("werkstatt/beta"),
      provides: [
        { capability: "werkstatt/alpha", version: "1.0.0", schemaHash: VALID_SHA as string },
      ],
    });

    const set = makeResolvedSet({
      components: [
        makeResolvedIdentity({ componentId: cid("werkstatt/alpha") }),
        makeResolvedIdentity({
          componentId: cid("werkstatt/beta"),
          artifactHash: VALID_SHA as string,
        }),
      ],
    });
    const manifests = new Map<ComponentId, ComponentManifestV1>([
      ["werkstatt/alpha", manifestA],
      ["werkstatt/beta", manifestB],
    ]);
    const observations = new Map<ComponentId, LiveComponentObservation>([
      ["werkstatt/alpha", { componentId: cid("werkstatt/alpha"), lifecycleState: "active" }],
      ["werkstatt/beta", { componentId: cid("werkstatt/beta"), lifecycleState: "active" }],
    ]);

    const catalog = createCapabilityCatalog({
      activeSet: set,
      manifests,
      observations,
    });

    expect(catalog.entries).toHaveLength(3);
    expect(catalog.entries[0]!.capability).toBe("werkstatt/alpha");
    expect(catalog.entries[0]!.componentId).toBe("werkstatt/alpha");
    expect(catalog.entries[1]!.capability).toBe("werkstatt/alpha");
    expect(catalog.entries[1]!.componentId).toBe("werkstatt/beta");
    expect(catalog.entries[2]!.capability).toBe("werkstatt/zeta");
  });

  it("catalog hash is deterministic for same inputs", () => {
    const set = makeResolvedSet();
    const manifests = new Map<ComponentId, ComponentManifestV1>([
      ["werkstatt/engine", makeManifest()],
    ]);
    const observations = new Map<ComponentId, LiveComponentObservation>([
      ["werkstatt/engine", { componentId: cid("werkstatt/engine"), lifecycleState: "active" }],
    ]);

    const c1 = createCapabilityCatalog({
      activeSet: set,
      manifests,
      observations,
      observedAt: "2026-01-01T00:00:00Z",
    });
    const c2 = createCapabilityCatalog({
      activeSet: set,
      manifests,
      observations,
      observedAt: "2026-01-01T00:00:00Z",
    });

    expect(c1.catalogHash).toBe(c2.catalogHash);
  });
});

describe("assertNoForbiddenFields", () => {
  it("passes for a clean catalog", () => {
    const set = makeResolvedSet();
    const manifests = new Map<ComponentId, ComponentManifestV1>([
      ["werkstatt/engine", makeManifest()],
    ]);
    const observations = new Map<ComponentId, LiveComponentObservation>([
      ["werkstatt/engine", { componentId: cid("werkstatt/engine"), lifecycleState: "active" }],
    ]);

    const catalog = createCapabilityCatalog({
      activeSet: set,
      manifests,
      observations,
    });

    expect(() => assertNoForbiddenFields(catalog)).not.toThrow();
  });

  it("throws REFLECTION-02 for catalog containing forbidden field name", () => {
    const fakeCatalog = {
      schema: "werkstatt/capability-catalog@1",
      observedAt: "2026-01-01",
      resolvedComponentSetHash: "sha256:abc",
      entries: [],
      catalogHash: "sha256:def",
      secrets: "leaked",
    } as unknown as CapabilityCatalogV1;

    expect(() => assertNoForbiddenFields(fakeCatalog)).toThrow(/REFLECTION-02/);
  });

  it("throws for credentials field", () => {
    const fakeCatalog = {
      schema: "werkstatt/capability-catalog@1",
      observedAt: "2026-01-01",
      resolvedComponentSetHash: "sha256:abc",
      entries: [],
      catalogHash: "sha256:def",
      credentials: "leaked",
    } as unknown as CapabilityCatalogV1;

    expect(() => assertNoForbiddenFields(fakeCatalog)).toThrow(/REFLECTION-02/);
  });

  it("throws for rawGrants field", () => {
    const fakeCatalog = {
      schema: "werkstatt/capability-catalog@1",
      observedAt: "2026-01-01",
      resolvedComponentSetHash: "sha256:abc",
      entries: [],
      catalogHash: "sha256:def",
      rawGrants: [],
    } as unknown as CapabilityCatalogV1;

    expect(() => assertNoForbiddenFields(fakeCatalog)).toThrow(/REFLECTION-02/);
  });
});

describe("negative: catalog must not leak private data", () => {
  it("catalog entries contain only allowed fields", () => {
    const set = makeResolvedSet();
    const manifests = new Map<ComponentId, ComponentManifestV1>([
      ["werkstatt/engine", makeManifest()],
    ]);
    const observations = new Map<ComponentId, LiveComponentObservation>([
      ["werkstatt/engine", { componentId: cid("werkstatt/engine"), lifecycleState: "active" }],
    ]);

    const catalog = createCapabilityCatalog({
      activeSet: set,
      manifests,
      observations,
    });

    const entry = catalog.entries[0]!;
    const keys = Object.keys(entry);
    expect(keys.sort()).toEqual([
      "callable",
      "capability",
      "componentId",
      "lifecycleState",
      "schemaHash",
      "version",
    ]);
  });

  it("catalog top-level contains only allowed fields", () => {
    const set = makeResolvedSet();
    const manifests = new Map<ComponentId, ComponentManifestV1>([
      ["werkstatt/engine", makeManifest()],
    ]);
    const observations = new Map<ComponentId, LiveComponentObservation>([
      ["werkstatt/engine", { componentId: cid("werkstatt/engine"), lifecycleState: "active" }],
    ]);

    const catalog = createCapabilityCatalog({
      activeSet: set,
      manifests,
      observations,
    });

    const keys = Object.keys(catalog);
    expect(keys.sort()).toEqual([
      "catalogHash",
      "entries",
      "observedAt",
      "resolvedComponentSetHash",
      "schema",
    ]);
  });
});

const STUB_LAW_KERNEL: LawKernelSummary = {
  activeGrants: 3,
  artifactStoreEntries: 12,
  killSwitchArmed: false,
};

function makeTwoComponentSet(): {
  set: ResolvedComponentSetV1;
  manifests: Map<ComponentId, ComponentManifestV1>;
  observations: Map<ComponentId, LiveComponentObservation>;
} {
  const manifestA = makeManifest({
    componentId: cid("werkstatt/alpha"),
    provides: [
      { capability: "werkstatt/kernel", version: "1.0.0", schemaHash: VALID_SHA as string },
    ],
    requires: [
      {
        capability: "werkstatt/storage",
        compatibility: "1.0.0",
        schemaHash: VALID_SHA as string,
        optional: false,
      },
    ],
  });
  const manifestB = makeManifest({
    componentId: cid("werkstatt/beta"),
    provides: [
      { capability: "werkstatt/storage", version: "1.0.0", schemaHash: VALID_SHA as string },
    ],
    requires: [],
  });

  const set = makeResolvedSet({
    components: [
      makeResolvedIdentity({ componentId: cid("werkstatt/alpha") }),
      makeResolvedIdentity({ componentId: cid("werkstatt/beta") }),
    ],
  });
  const manifests = new Map<ComponentId, ComponentManifestV1>([
    ["werkstatt/alpha", manifestA],
    ["werkstatt/beta", manifestB],
  ]);
  const observations = new Map<ComponentId, LiveComponentObservation>([
    ["werkstatt/alpha", { componentId: cid("werkstatt/alpha"), lifecycleState: "active" }],
    ["werkstatt/beta", { componentId: cid("werkstatt/beta"), lifecycleState: "active" }],
  ]);

  return { set, manifests, observations };
}

describe("reflectRuntime", () => {
  it("returns RuntimeReflectionV1 with correct component states (AC-1)", () => {
    const { set, manifests, observations } = makeTwoComponentSet();

    const reflection = reflectRuntime(
      { activeSet: set, manifests, observations, observedAt: "2026-01-01T00:00:00Z" },
      STUB_LAW_KERNEL,
    );

    expect(reflection.reflectedAt).toBe("2026-01-01T00:00:00Z");
    expect(reflection.components).toHaveLength(2);
    expect(reflection.components[0]!.componentId).toBe("werkstatt/alpha");
    expect(reflection.components[0]!.fiberState).toBe("active");
    expect(reflection.components[1]!.componentId).toBe("werkstatt/beta");
    expect(reflection.components[1]!.fiberState).toBe("active");
    expect(reflection.lawKernel).toEqual(STUB_LAW_KERNEL);
  });

  it("skips disposed components and increments skippedDisposed (AC-1, failure mode)", () => {
    const { set, manifests } = makeTwoComponentSet();
    const observations = new Map<ComponentId, LiveComponentObservation>([
      ["werkstatt/alpha", { componentId: cid("werkstatt/alpha"), lifecycleState: "active" }],
      ["werkstatt/beta", { componentId: cid("werkstatt/beta"), lifecycleState: "disposed" }],
    ]);

    const reflection = reflectRuntime({ activeSet: set, manifests, observations }, STUB_LAW_KERNEL);

    expect(reflection.components).toHaveLength(1);
    expect(reflection.components[0]!.componentId).toBe("werkstatt/alpha");
    expect(reflection.summary.skippedDisposed).toBe(1);
    expect(reflection.summary.total).toBe(1);
  });

  it("skips components without manifests without error", () => {
    const { set, observations } = makeTwoComponentSet();

    const reflection = reflectRuntime(
      { activeSet: set, manifests: new Map(), observations },
      STUB_LAW_KERNEL,
    );

    expect(reflection.components).toHaveLength(0);
    expect(reflection.summary.total).toBe(0);
  });

  it("builds dependency edges from requires/provides mapping", () => {
    const { set, manifests, observations } = makeTwoComponentSet();

    const reflection = reflectRuntime({ activeSet: set, manifests, observations }, STUB_LAW_KERNEL);

    expect(reflection.dependencyEdges).toHaveLength(1);
    expect(reflection.dependencyEdges[0]!.from).toBe("werkstatt/alpha");
    expect(reflection.dependencyEdges[0]!.to).toBe("werkstatt/beta");
    expect(reflection.dependencyEdges[0]!.capability).toBe("werkstatt/storage");
  });

  it("resolves requirements with resolvedBy and resolution status", () => {
    const { set, manifests, observations } = makeTwoComponentSet();

    const reflection = reflectRuntime({ activeSet: set, manifests, observations }, STUB_LAW_KERNEL);

    const alpha = reflection.components.find((c) => c.componentId === "werkstatt/alpha")!;
    expect(alpha.requires).toHaveLength(1);
    expect(alpha.requires[0]!.resolution).toBe("resolved");
    expect(alpha.requires[0]!.resolvedBy).toBe("werkstatt/beta");
  });

  it("marks unresolved non-optional requires as missing", () => {
    const manifestA = makeManifest({
      componentId: cid("werkstatt/alpha"),
      provides: [],
      requires: [
        {
          capability: "werkstatt/missing",
          compatibility: "1.0.0",
          schemaHash: VALID_SHA as string,
          optional: false,
        },
      ],
    });
    const set = makeResolvedSet({
      components: [makeResolvedIdentity({ componentId: cid("werkstatt/alpha") })],
    });
    const manifests = new Map<ComponentId, ComponentManifestV1>([["werkstatt/alpha", manifestA]]);
    const observations = new Map<ComponentId, LiveComponentObservation>([
      ["werkstatt/alpha", { componentId: cid("werkstatt/alpha"), lifecycleState: "active" }],
    ]);

    const reflection = reflectRuntime({ activeSet: set, manifests, observations }, STUB_LAW_KERNEL);

    const alpha = reflection.components[0]!;
    expect(alpha.requires[0]!.resolution).toBe("missing");
    expect(alpha.requires[0]!.resolvedBy).toBeUndefined();
  });

  it("marks unresolved optional requires as waiting", () => {
    const manifestA = makeManifest({
      componentId: cid("werkstatt/alpha"),
      provides: [],
      requires: [
        {
          capability: "werkstatt/optional",
          compatibility: "1.0.0",
          schemaHash: VALID_SHA as string,
          optional: true,
        },
      ],
    });
    const set = makeResolvedSet({
      components: [makeResolvedIdentity({ componentId: cid("werkstatt/alpha") })],
    });
    const manifests = new Map<ComponentId, ComponentManifestV1>([["werkstatt/alpha", manifestA]]);
    const observations = new Map<ComponentId, LiveComponentObservation>([
      ["werkstatt/alpha", { componentId: cid("werkstatt/alpha"), lifecycleState: "active" }],
    ]);

    const reflection = reflectRuntime({ activeSet: set, manifests, observations }, STUB_LAW_KERNEL);

    const alpha = reflection.components[0]!;
    expect(alpha.requires[0]!.resolution).toBe("waiting");
  });

  it("summary counts states correctly", () => {
    const manifestA = makeManifest({ componentId: cid("werkstatt/alpha") });
    const manifestB = makeManifest({ componentId: cid("werkstatt/beta") });
    const manifestC = makeManifest({ componentId: cid("werkstatt/gamma") });

    const set = makeResolvedSet({
      components: [
        makeResolvedIdentity({ componentId: cid("werkstatt/alpha") }),
        makeResolvedIdentity({ componentId: cid("werkstatt/beta") }),
        makeResolvedIdentity({ componentId: cid("werkstatt/gamma") }),
      ],
    });
    const manifests = new Map<ComponentId, ComponentManifestV1>([
      ["werkstatt/alpha", manifestA],
      ["werkstatt/beta", manifestB],
      ["werkstatt/gamma", manifestC],
    ]);
    const observations = new Map<ComponentId, LiveComponentObservation>([
      ["werkstatt/alpha", { componentId: cid("werkstatt/alpha"), lifecycleState: "active" }],
      ["werkstatt/beta", { componentId: cid("werkstatt/beta"), lifecycleState: "waiting" }],
      ["werkstatt/gamma", { componentId: cid("werkstatt/gamma"), lifecycleState: "failed" }],
    ]);

    const reflection = reflectRuntime({ activeSet: set, manifests, observations }, STUB_LAW_KERNEL);

    expect(reflection.summary.total).toBe(3);
    expect(reflection.summary.active).toBe(1);
    expect(reflection.summary.waiting).toBe(1);
    expect(reflection.summary.failed).toBe(1);
    expect(reflection.summary.skippedDisposed).toBe(0);
  });

  it("does not leak forbidden fields in reflection output (AC-7)", () => {
    const { set, manifests, observations } = makeTwoComponentSet();

    const reflection = reflectRuntime({ activeSet: set, manifests, observations }, STUB_LAW_KERNEL);

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
      expect(json, `Reflection must not contain forbidden field: ${field}`).not.toContain(field);
    }
  });

  it("returns RuntimeReflectionV1 with correct top-level shape", () => {
    const { set, manifests, observations } = makeTwoComponentSet();

    const reflection = reflectRuntime({ activeSet: set, manifests, observations }, STUB_LAW_KERNEL);

    const keys = Object.keys(reflection).sort();
    expect(keys).toEqual(["components", "dependencyEdges", "lawKernel", "reflectedAt", "summary"]);
  });
});

describe("reflectRuntime: capability catalog reuse (AC-2)", () => {
  it("createCapabilityCatalog and reflectRuntime share the same activeSet hash", () => {
    const { set, manifests, observations } = makeTwoComponentSet();

    const catalog = createCapabilityCatalog({ activeSet: set, manifests, observations });
    const reflection = reflectRuntime({ activeSet: set, manifests, observations }, STUB_LAW_KERNEL);

    expect(catalog.resolvedComponentSetHash).toBe(set.setHash);
    expect(reflection.components.length).toBeGreaterThan(0);
  });
});
