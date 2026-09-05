import { describe, it, expect } from "vitest";
import { computeReconciliationPlan, reconcile, type ReconcileOptions } from "../reconciliation.ts";
import { resolve } from "../resolver.ts";
import type {
  ComponentManifestV1,
  ResolvedComponentSetV1,
  ResolvedComponentIdentityV1,
  ComponentId,
} from "../../component/contracts.ts";
import { computeSetHash } from "../../component/identity.ts";
import { ComponentFiber } from "../fiber.ts";
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
    effects: [
      {
        effectClass: "revertible",
        description: "test",
        recoveryCommand: null,
        commitMetadata: null,
      },
    ],
    isolation: { tier: "trusted-in-process", adapterId: null },
    resources: [{ kind: "cpu", limit: "100ms", owner: componentId, lifecycle: "process" }],
    ...overrides,
  };
}

function makeResolvedSet(
  components: ResolvedComponentIdentityV1[],
  profileId = "astro-typescript-turborepo",
): ResolvedComponentSetV1 {
  const base = {
    schema: "werkstatt/resolved-component-set@1" as const,
    profileId,
    components,
    dependencyGraphHash: VALID_SHA as string,
    grantSetHash: VALID_SHA as string,
    effectPolicyHash: VALID_SHA as string,
    isolationPolicyHash: VALID_SHA as string,
  };
  return { ...base, setHash: computeSetHash(base) };
}

function makeIdentity(id: string, version = "1.0.0"): ResolvedComponentIdentityV1 {
  return { componentId: cid(id), version, artifactHash: VALID_SHA as string };
}

describe("computeReconciliationPlan", () => {
  it("returns no-op when set hashes match", () => {
    const set = makeResolvedSet([makeIdentity("werkstatt/engine")]);
    const result = computeReconciliationPlan(set, set);
    expect("status" in result && result.status).toBe("no-op");
  });

  it("plans full load when current set is null", () => {
    const desired = makeResolvedSet([
      makeIdentity("werkstatt/engine"),
      makeIdentity("werkstatt/fingerprint"),
    ]);
    const result = computeReconciliationPlan(null, desired);
    expect(!("status" in result)).toBe(true);
    if (!("status" in result)) {
      expect(result.stopNewCalls).toHaveLength(0);
      expect(result.drain).toHaveLength(0);
      expect(result.unload).toHaveLength(0);
      expect(result.load).toHaveLength(2);
      expect(result.activate).toHaveLength(2);
      expect(result.currentSetHash).toBe("sha256:" + "0".repeat(64));
      expect(result.desiredSetHash).toBe(desired.setHash);
    }
  });

  it("plans unload for removed components", () => {
    const current = makeResolvedSet([makeIdentity("werkstatt/a"), makeIdentity("werkstatt/b")]);
    const desired = makeResolvedSet([makeIdentity("werkstatt/a")]);
    const result = computeReconciliationPlan(current, desired);
    if (!("status" in result)) {
      expect(result.unload).toEqual(["werkstatt/b"]);
      expect(result.load).toHaveLength(0);
    }
  });

  it("plans upgrade for changed version", () => {
    const current = makeResolvedSet([makeIdentity("werkstatt/engine", "1.0.0")]);
    const desired = makeResolvedSet([makeIdentity("werkstatt/engine", "2.0.0")]);
    const result = computeReconciliationPlan(current, desired);
    if (!("status" in result)) {
      expect(result.unload).toContain("werkstatt/engine");
      expect(result.load).toContain("werkstatt/engine");
      expect(result.activate).toContain("werkstatt/engine");
    }
  });

  it("plans are stable (same input → same planHash)", () => {
    const current = makeResolvedSet([makeIdentity("werkstatt/a"), makeIdentity("werkstatt/b")]);
    const desired = makeResolvedSet([makeIdentity("werkstatt/c")]);
    const plan1 = computeReconciliationPlan(current, desired);
    const plan2 = computeReconciliationPlan(current, desired);
    if (!("status" in plan1) && !("status" in plan2)) {
      expect(plan1.planHash).toBe(plan2.planHash);
    }
  });
});

describe("reconcile", () => {
  function makeReconcileOptions(overrides: Partial<ReconcileOptions> = {}): ReconcileOptions {
    const manifest = makeManifest();
    return {
      currentSet: null,
      resolutionInput: {
        profileId: "astro-typescript-turborepo",
        desired: [manifest],
        availableArtifacts: { artifacts: new Map([[cid("werkstatt/engine"), VALID_SHA]]) },
        admittedGrants: { admitted: [] },
        effectPolicyHash: VALID_SHA as string,
        isolationPolicyHash: VALID_SHA as string,
      },
      createFiber: (id: ResolvedComponentIdentityV1) => new ComponentFiber(id),
      drainDeadline: { timeoutMs: 1000 },
      transactionId: "recon-tx-1",
      ...overrides,
    };
  }

  it("commits a new set when current is null", async () => {
    const outcome = await reconcile(makeReconcileOptions());
    expect(outcome.status).toBe("committed");
    if (outcome.status === "committed") {
      expect(outcome.desiredSet.components).toHaveLength(1);
      expect(outcome.transaction.isCommitted).toBe(true);
    }
  });

  it("returns no-op when sets match", async () => {
    const manifest = makeManifest();
    const input = {
      profileId: "astro-typescript-turborepo",
      desired: [manifest],
      availableArtifacts: { artifacts: new Map([[cid("werkstatt/engine"), VALID_SHA]]) },
      admittedGrants: { admitted: [] },
      effectPolicyHash: VALID_SHA as string,
      isolationPolicyHash: VALID_SHA as string,
    };
    const resolution = resolve(input);
    if (resolution.status !== "resolved") throw new Error("expected resolved");

    const options = makeReconcileOptions({
      currentSet: resolution.set,
      resolutionInput: input,
    });
    const outcome = await reconcile(options);
    expect(outcome.status).toBe("no-op");
  });

  it("returns blocked on resolution failure", async () => {
    const options = makeReconcileOptions({
      resolutionInput: {
        profileId: "astro-typescript-turborebo",
        desired: [makeManifest()],
        availableArtifacts: { artifacts: new Map() },
        admittedGrants: { admitted: [] },
        effectPolicyHash: VALID_SHA as string,
        isolationPolicyHash: VALID_SHA as string,
      },
    });
    const outcome = await reconcile(options);
    expect(outcome.status).toBe("blocked");
  });
});
