import { describe, it, expect, beforeEach } from "vitest";
import {
  runConformanceScenario,
  buildCatalog,
  TEST_MODE_SENTINEL,
  type TrustedFixture,
} from "../testing/harness.ts";
import type { ConformanceScenarioV1 } from "../conformance.ts";
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

function cid(id: string): ComponentId {
  return id as ComponentId;
}

function cap(id: string): CapabilityId {
  return id as CapabilityId;
}

function makeManifest(overrides: Partial<ComponentManifestV1> = {}): ComponentManifestV1 {
  const componentId = overrides.componentId ?? cid("werkstatt/engine");
  return {
    schema: "werkstatt/component-manifest@1",
    componentId,
    version: "1.0.0",
    artifactHash: VALID_SHA as string,
    provides: [
      { capability: cap("werkstatt/kernel"), version: "1.0.0", schemaHash: VALID_SHA as string },
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

function makeTrustedFixture(overrides: Partial<TrustedFixture> = {}): TrustedFixture {
  const manifest = makeManifest();
  return {
    fixtureId: "test-fixture",
    artifactHash: VALID_SHA as string,
    trusted: true,
    manifests: [manifest],
    availableArtifacts: new Map<ComponentId, Sha256Digest>([["werkstatt/engine", VALID_SHA]]),
    admittedGrants: [],
    ...overrides,
  };
}

function makeScenario(overrides: Partial<ConformanceScenarioV1> = {}): ConformanceScenarioV1 {
  const set = makeResolvedSet();
  return {
    scenarioId: "test-scenario",
    fixtureArtifactHash: VALID_SHA as string,
    fixtureTrusted: true,
    initialSet: set,
    desiredSet: set,
    injectedEvents: [],
    expectedTrace: [],
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as Record<string, unknown>)[TEST_MODE_SENTINEL] = true;
});

describe("runConformanceScenario", () => {
  it("runs a basic activation scenario and passes", async () => {
    const set = makeResolvedSet();
    const fixture = makeTrustedFixture();
    const scenario = makeScenario({
      initialSet: set,
      desiredSet: set,
      injectedEvents: [],
      expectedTrace: [
        {
          kind: "lifecycle-state",
          componentId: cid("werkstatt/engine"),
          expectedState: "active",
          at: 0,
        },
      ],
    });

    const result = await runConformanceScenario(scenario, fixture, {
      now: () => 0,
      drainDeadline: { timeoutMs: 1000 },
    });

    expect(result.schema).toBe("werkstatt/conformance-result@1");
    expect(result.scenarioId).toBe("test-scenario");
    expect(result.testOnly).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    expect(result.violations).toHaveLength(0);
  });

  it("detects lifecycle-state mismatch", async () => {
    const set = makeResolvedSet();
    const fixture = makeTrustedFixture();
    const scenario = makeScenario({
      initialSet: set,
      desiredSet: set,
      injectedEvents: [
        { type: "fail", componentId: cid("werkstatt/engine"), at: 1, detail: "injected" },
      ],
      expectedTrace: [
        {
          kind: "lifecycle-state",
          componentId: cid("werkstatt/engine"),
          expectedState: "active",
          at: 2,
        },
      ],
    });

    const result = await runConformanceScenario(scenario, fixture, {
      now: () => 0,
      drainDeadline: { timeoutMs: 1000 },
    });

    expect(result.passed).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]!.expected).toBe("active");
    expect(result.mismatches[0]!.actual).toBe("failed");
  });

  it("detects capability-callable mismatch", async () => {
    const set = makeResolvedSet();
    const fixture = makeTrustedFixture();
    const scenario = makeScenario({
      initialSet: set,
      desiredSet: set,
      injectedEvents: [{ type: "drain", componentId: cid("werkstatt/engine"), at: 1 }],
      expectedTrace: [
        {
          kind: "capability-callable",
          componentId: cid("werkstatt/engine"),
          callable: true,
          at: 2,
        },
      ],
    });

    const result = await runConformanceScenario(scenario, fixture, {
      now: () => 0,
      drainDeadline: { timeoutMs: 100 },
    });

    expect(result.passed).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]!.expected).toBe("true");
    expect(result.mismatches[0]!.actual).toBe("false");
  });

  it("records injected failures", async () => {
    const set = makeResolvedSet();
    const fixture = makeTrustedFixture();
    const scenario = makeScenario({
      initialSet: set,
      desiredSet: set,
      injectedEvents: [
        { type: "fail", componentId: cid("werkstatt/engine"), at: 1, detail: "crash" },
      ],
      expectedTrace: [
        {
          kind: "lifecycle-state",
          componentId: cid("werkstatt/engine"),
          expectedState: "failed",
          at: 2,
        },
      ],
    });

    const result = await runConformanceScenario(scenario, fixture, {
      now: () => 0,
      drainDeadline: { timeoutMs: 1000 },
    });

    expect(result.injectedFailures).toHaveLength(1);
    expect(result.injectedFailures[0]).toContain("crash");
    expect(result.passed).toBe(true);
  });

  it("handles quarantine events", async () => {
    const set = makeResolvedSet();
    const fixture = makeTrustedFixture();
    const scenario = makeScenario({
      initialSet: set,
      desiredSet: set,
      injectedEvents: [{ type: "quarantine", componentId: cid("werkstatt/engine"), at: 1 }],
      expectedTrace: [
        {
          kind: "lifecycle-state",
          componentId: cid("werkstatt/engine"),
          expectedState: "quarantined",
          at: 2,
        },
      ],
    });

    const result = await runConformanceScenario(scenario, fixture, {
      now: () => 0,
      drainDeadline: { timeoutMs: 1000 },
    });

    expect(result.passed).toBe(true);
    expect(result.cleanupReport.quarantined).toContain("werkstatt/engine");
  });

  it("produces cleanup report with correct component lists", async () => {
    const set = makeResolvedSet();
    const fixture = makeTrustedFixture();
    const scenario = makeScenario({
      initialSet: set,
      desiredSet: set,
      injectedEvents: [],
      expectedTrace: [],
    });

    const result = await runConformanceScenario(scenario, fixture, {
      now: () => 0,
      drainDeadline: { timeoutMs: 1000 },
    });

    expect(result.cleanupReport).toBeDefined();
    expect(result.cleanupReport.disposed).toEqual([]);
    expect(result.cleanupReport.quarantined).toEqual([]);
    expect(result.cleanupReport.failed).toEqual([]);
  });

  it("terminal state is mixed when components differ", async () => {
    const manifestA = makeManifest({ componentId: cid("werkstatt/alpha") });
    const manifestB = makeManifest({
      componentId: cid("werkstatt/beta"),
      provides: [
        {
          capability: cap("werkstatt/beta-cap"),
          version: "1.0.0",
          schemaHash: VALID_SHA as string,
        },
      ],
    });

    const identityA = makeResolvedIdentity({ componentId: cid("werkstatt/alpha") });
    const identityB = makeResolvedIdentity({
      componentId: cid("werkstatt/beta"),
      artifactHash: VALID_SHA as string,
    });

    const set = makeResolvedSet({ components: [identityA, identityB] });
    const fixture = makeTrustedFixture({
      manifests: [manifestA, manifestB],
      availableArtifacts: new Map<ComponentId, Sha256Digest>([
        ["werkstatt/alpha", VALID_SHA],
        ["werkstatt/beta", VALID_SHA],
      ]),
    });
    const scenario = makeScenario({
      initialSet: set,
      desiredSet: set,
      injectedEvents: [{ type: "fail", componentId: cid("werkstatt/alpha"), at: 1 }],
      expectedTrace: [],
    });

    const result = await runConformanceScenario(scenario, fixture, {
      now: () => 0,
      drainDeadline: { timeoutMs: 1000 },
    });

    expect(result.terminalState).toBe("mixed");
  });
});

describe("runConformanceScenario: negative tests", () => {
  it("rejects untrusted fixture", async () => {
    const set = makeResolvedSet();
    const fixture = { ...makeTrustedFixture(), trusted: false } as unknown as TrustedFixture;
    const scenario = makeScenario({ initialSet: set, desiredSet: set });

    await expect(
      runConformanceScenario(scenario, fixture as TrustedFixture, {
        now: () => 0,
        drainDeadline: { timeoutMs: 1000 },
      }),
    ).rejects.toThrow(/CONFORMANCE-02/);
  });

  it("rejects fixture with unpinned artifact hash", async () => {
    const set = makeResolvedSet();
    const fixture = makeTrustedFixture({ artifactHash: "unpinned" });
    const scenario = makeScenario({
      initialSet: set,
      desiredSet: set,
      fixtureArtifactHash: "unpinned",
    });

    await expect(
      runConformanceScenario(scenario, fixture, {
        now: () => 0,
        drainDeadline: { timeoutMs: 1000 },
      }),
    ).rejects.toThrow(/CONFORMANCE-03/);
  });

  it("rejects scenario/fixture hash mismatch", async () => {
    const set = makeResolvedSet();
    const fixture = makeTrustedFixture();
    const scenario = makeScenario({
      initialSet: set,
      desiredSet: set,
      fixtureArtifactHash: ("sha256:" + "f".repeat(64)) as string,
    });

    await expect(
      runConformanceScenario(scenario, fixture, {
        now: () => 0,
        drainDeadline: { timeoutMs: 1000 },
      }),
    ).rejects.toThrow(/CONFORMANCE-04/);
  });
});

describe("runConformanceScenario: test-only guard", () => {
  it("rejects invocation outside test mode", async () => {
    (globalThis as Record<string, unknown>)[TEST_MODE_SENTINEL] = false;
    const set = makeResolvedSet();
    const fixture = makeTrustedFixture();
    const scenario = makeScenario({ initialSet: set, desiredSet: set });

    await expect(
      runConformanceScenario(scenario, fixture, {
        now: () => 0,
        drainDeadline: { timeoutMs: 1000 },
      }),
    ).rejects.toThrow(/CONFORMANCE-01/);
  });
});

describe("buildCatalog", () => {
  it("builds a catalog from active set, manifests, and observations", () => {
    const set = makeResolvedSet();
    const manifests = new Map<ComponentId, ComponentManifestV1>([
      ["werkstatt/engine", makeManifest()],
    ]);
    const observations = new Map<ComponentId, import("../reflection.ts").LiveComponentObservation>([
      ["werkstatt/engine", { componentId: cid("werkstatt/engine"), lifecycleState: "active" }],
    ]);

    const catalog = buildCatalog(set, manifests, observations);

    expect(catalog.schema).toBe("werkstatt/capability-catalog@1");
    expect(catalog.resolvedComponentSetHash).toBe(set.setHash);
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]!.callable).toBe(true);
  });
});

describe("conformance result contract", () => {
  it("result is always marked testOnly", async () => {
    const set = makeResolvedSet();
    const fixture = makeTrustedFixture();
    const scenario = makeScenario({ initialSet: set, desiredSet: set });

    const result = await runConformanceScenario(scenario, fixture, {
      now: () => 0,
      drainDeadline: { timeoutMs: 1000 },
    });

    expect(result.testOnly).toBe(true);
  });

  it("result contains no admission or promotion decision", async () => {
    const set = makeResolvedSet();
    const fixture = makeTrustedFixture();
    const scenario = makeScenario({ initialSet: set, desiredSet: set });

    const result = await runConformanceScenario(scenario, fixture, {
      now: () => 0,
      drainDeadline: { timeoutMs: 1000 },
    });

    const keys = Object.keys(result);
    expect(keys).not.toContain("admission");
    expect(keys).not.toContain("promotion");
    expect(keys).not.toContain("certified");
    expect(keys).not.toContain("authority");
  });
});
