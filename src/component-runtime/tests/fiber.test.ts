import { describe, it, expect } from "vitest";
import { ComponentFiber } from "../fiber.ts";
import type { ResolvedComponentIdentityV1 } from "../../component/contracts.ts";
import { RevertibleEffectHandler } from "../effects.ts";

const VALID_SHA = "sha256:" + "a".repeat(64);

function makeIdentity(overrides: Partial<ResolvedComponentIdentityV1> = {}): ResolvedComponentIdentityV1 {
  return {
    componentId: "werkstatt/engine",
    version: "1.0.0",
    artifactHash: VALID_SHA,
    ...overrides,
  };
}

describe("ComponentFiber", () => {
  it("starts in declared state", () => {
    const fiber = new ComponentFiber(makeIdentity());
    expect(fiber.state).toBe("declared");
    expect(fiber.canAcceptNewCalls).toBe(false);
  });

  it("transitions to active and accepts calls", async () => {
    const fiber = new ComponentFiber(makeIdentity());
    fiber.transitionTo("waiting");
    fiber.transitionTo("loading");
    fiber.transitionTo("active");
    expect(fiber.canAcceptNewCalls).toBe(true);

    const result = await fiber.run({
      id: "op-1",
      execute: async () => 42,
    });
    expect(result).toBe(42);
    expect(fiber.activeOperationCount).toBe(0);
  });

  it("rejects new calls when not active", async () => {
    const fiber = new ComponentFiber(makeIdentity());
    await expect(
      fiber.run({ id: "op-1", execute: async () => 1 }),
    ).rejects.toThrow(/cannot accept new calls/);
  });

  it("drains in-flight operations", async () => {
    const fiber = new ComponentFiber(makeIdentity());
    fiber.transitionTo("waiting");
    fiber.transitionTo("loading");
    fiber.transitionTo("active");

    let resolveOp: (v: number) => void;
    const opPromise = new Promise<number>((resolve) => { resolveOp = resolve; });

    const runPromise = fiber.run({
      id: "op-1",
      execute: async () => opPromise,
    });

    const drainResult = await fiber.drain({ timeoutMs: 100 });
    expect(drainResult.timedOut).toBe(true);
    expect(drainResult.remainingOperations).toBe(1);

    resolveOp!(99);
    await runPromise;

    const drainResult2 = await fiber.drain({ timeoutMs: 100 });
    expect(drainResult2.drained).toBe(true);
    expect(drainResult2.remainingOperations).toBe(0);
  });

  it("dispose transitions to disposed when clean", async () => {
    const fiber = new ComponentFiber(makeIdentity());
    fiber.transitionTo("waiting");
    fiber.transitionTo("loading");
    fiber.transitionTo("active");

    const report = await fiber.dispose();
    expect(report.allSucceeded).toBe(true);
    expect(report.quarantined).toBe(false);
    expect(fiber.state).toBe("disposed");
    expect(fiber.isTerminal).toBe(true);
  });

  it("dispose unwinds effects in LIFO order", async () => {
    const order: string[] = [];
    const fiber = new ComponentFiber(makeIdentity());
    fiber.transitionTo("waiting");
    fiber.transitionTo("loading");
    fiber.transitionTo("active");

    fiber.registerEffect("eff-1", new RevertibleEffectHandler(async () => { order.push("eff-1"); }));
    fiber.registerEffect("eff-2", new RevertibleEffectHandler(async () => { order.push("eff-2"); }));

    await fiber.dispose();
    expect(order).toEqual(["eff-2", "eff-1"]);
  });

  it("dispose quarantines when effect unwind fails", async () => {
    const fiber = new ComponentFiber(makeIdentity());
    fiber.transitionTo("waiting");
    fiber.transitionTo("loading");
    fiber.transitionTo("active");

    fiber.registerEffect("eff-1", new RevertibleEffectHandler(async () => { throw new Error("fail"); }));

    const report = await fiber.dispose();
    expect(report.quarantined).toBe(true);
    expect(report.allSucceeded).toBe(false);
    expect(fiber.state).toBe("quarantined");
  });

  it("dispose is idempotent", async () => {
    const fiber = new ComponentFiber(makeIdentity());
    fiber.transitionTo("waiting");
    fiber.transitionTo("loading");
    fiber.transitionTo("active");

    await fiber.dispose();
    const report2 = await fiber.dispose();
    expect(report2.allSucceeded).toBe(true);
    expect(report2.entries).toHaveLength(0);
  });

  it("cancelAllOperations aborts in-flight operations", async () => {
    const fiber = new ComponentFiber(makeIdentity());
    fiber.transitionTo("waiting");
    fiber.transitionTo("loading");
    fiber.transitionTo("active");

    const runPromise = fiber.run({
      id: "op-1",
      execute: async (signal) => {
        return new Promise<number>((_, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      },
    });

    fiber.cancelAllOperations();
    await expect(runPromise).rejects.toThrow();
  });

  it("addChild and dispose cascades to children", async () => {
    const parent = new ComponentFiber(makeIdentity({ componentId: "werkstatt/parent" }));
    const child = new ComponentFiber(makeIdentity({ componentId: "werkstatt/child" }));
    parent.addChild(child);

    parent.transitionTo("waiting");
    parent.transitionTo("loading");
    parent.transitionTo("active");
    child.transitionTo("waiting");
    child.transitionTo("loading");
    child.transitionTo("active");

    await parent.dispose();
    expect(parent.state).toBe("disposed");
    expect(child.state).toBe("disposed");
  });
});
