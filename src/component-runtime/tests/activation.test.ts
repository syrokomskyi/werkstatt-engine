import { describe, it, expect } from "vitest";
import { createActivationTransaction } from "../activation.ts";
import { ComponentFiber } from "../fiber.ts";
import type {
  ResolvedComponentIdentityV1,
  ResolvedComponentSetV1,
} from "../../component/contracts.ts";
import { computeSetHash } from "../../component/identity.ts";

const VALID_SHA = "sha256:" + "a".repeat(64);
const VALID_SHA_2 = "sha256:" + "b".repeat(64);

function makeIdentity(
  overrides: Partial<ResolvedComponentIdentityV1> = {},
): ResolvedComponentIdentityV1 {
  return {
    componentId: "werkstatt/engine",
    version: "1.0.0",
    artifactHash: VALID_SHA,
    ...overrides,
  };
}

function makeSet(
  components: ResolvedComponentIdentityV1[],
  overrides: Partial<Omit<ResolvedComponentSetV1, "setHash">> = {},
): ResolvedComponentSetV1 {
  const base = {
    schema: "werkstatt/resolved-component-set@1" as const,
    profileId: "astro-typescript-turborepo",
    components,
    dependencyGraphHash: VALID_SHA,
    grantSetHash: VALID_SHA,
    effectPolicyHash: VALID_SHA,
    isolationPolicyHash: VALID_SHA,
    ...overrides,
  };
  return { ...base, setHash: computeSetHash(base) };
}

function makeFiber(identity: ResolvedComponentIdentityV1): ComponentFiber {
  return new ComponentFiber(identity);
}

describe("ActivationTransaction", () => {
  it("prepares and commits new set without prior set", async () => {
    const set = makeSet([makeIdentity()]);
    const tx = createActivationTransaction("tx-1", null, set, makeFiber, { timeoutMs: 1000 });

    await tx.prepare();
    expect(tx.state).toBe("preparing");

    await tx.commit();
    expect(tx.isCommitted).toBe(true);
    expect(tx.fibers).toHaveLength(1);
    expect(tx.fibers[0]!.state).toBe("active");
  });

  it("prepares, commits, and drains prior set on commit", async () => {
    const priorSet = makeSet([makeIdentity({ componentId: "werkstatt/old" })]);
    const newSet = makeSet([makeIdentity({ componentId: "werkstatt/new" })]);
    const tx = createActivationTransaction("tx-2", priorSet, newSet, makeFiber, {
      timeoutMs: 1000,
    });

    await tx.prepare();
    await tx.commit();
    expect(tx.isCommitted).toBe(true);
    expect(tx.result.drainResults).toHaveLength(1);
    expect(tx.result.drainResults[0]!.drained).toBe(true);
  });

  it("abort restores to aborted state", async () => {
    const set = makeSet([makeIdentity()]);
    const tx = createActivationTransaction("tx-3", null, set, makeFiber, { timeoutMs: 1000 });

    await tx.prepare();
    await tx.abort("test abort");
    expect(tx.isAborted).toBe(true);
    expect(tx.result.error).toBe("test abort");
  });

  it("prepare throws on invalid state for double prepare", async () => {
    const set = makeSet([makeIdentity()]);
    const tx = createActivationTransaction("tx-4", null, set, makeFiber, { timeoutMs: 1000 });
    await tx.prepare();
    await expect(tx.prepare()).rejects.toThrow(/requires idle state/);
  });

  it("commit throws when not in preparing state", async () => {
    const set = makeSet([makeIdentity()]);
    const tx = createActivationTransaction("tx-5", null, set, makeFiber, { timeoutMs: 1000 });
    await expect(tx.commit()).rejects.toThrow(/requires preparing state/);
  });

  it("drain timeout on prior set causes abort", async () => {
    const priorSet = makeSet([makeIdentity({ componentId: "werkstatt/old" })]);
    const newSet = makeSet([makeIdentity({ componentId: "werkstatt/new" })]);

    const slowFiber = (id: ResolvedComponentIdentityV1): ComponentFiber => {
      const fiber = new ComponentFiber(id);
      if (id.componentId === "werkstatt/old") {
        fiber.transitionTo("waiting");
        fiber.transitionTo("loading");
        fiber.transitionTo("active");
        fiber
          .run({
            id: "slow-op",
            execute: async () => new Promise(() => {}),
          })
          .catch(() => {});
      }
      return fiber;
    };

    const tx = createActivationTransaction("tx-6", priorSet, newSet, slowFiber, { timeoutMs: 50 });
    await tx.prepare();
    await expect(tx.commit()).rejects.toThrow(/drain timeout/);
    expect(tx.isAborted).toBe(true);
  });

  it("activation result contains correct hashes", async () => {
    const set = makeSet([makeIdentity()]);
    const tx = createActivationTransaction("tx-7", null, set, makeFiber, { timeoutMs: 1000 });
    await tx.prepare();
    await tx.commit();

    expect(tx.result.priorSetHash).toBe("sha256:" + "0".repeat(64));
    expect(tx.result.proposedSetHash).toBe(set.setHash);
  });

  it("multiple components activate in dependency order", async () => {
    const c1 = makeIdentity({ componentId: "werkstatt/alpha", version: "1.0.0" });
    const c2 = makeIdentity({
      componentId: "werkstatt/beta",
      version: "1.0.0",
      artifactHash: VALID_SHA_2,
    });
    const set = makeSet([c2, c1]);
    const tx = createActivationTransaction("tx-8", null, set, makeFiber, { timeoutMs: 1000 });

    await tx.prepare();
    await tx.commit();
    expect(tx.fibers).toHaveLength(2);
    expect(tx.fibers[0]!.component.componentId).toBe("werkstatt/alpha");
    expect(tx.fibers[1]!.component.componentId).toBe("werkstatt/beta");
  });
});
