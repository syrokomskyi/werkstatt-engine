import { describe, it, expect } from "vitest";
import {
  LifecycleMachine,
  isValidTransition,
  transition,
  isTerminal,
  canAcceptNewCalls,
  canCancel,
} from "../lifecycle.ts";
import type { ComponentLifecycleState } from "../lifecycle.ts";
import type { ResolvedComponentIdentityV1 } from "../../component/contracts.ts";

const VALID_SHA = "sha256:" + "a".repeat(64);

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

describe("lifecycle state machine", () => {
  it("allows valid forward transitions", () => {
    const lm = new LifecycleMachine(makeIdentity());
    expect(lm.state).toBe("declared");

    expect(lm.transitionTo("waiting").ok).toBe(true);
    expect(lm.state).toBe("waiting");

    expect(lm.transitionTo("loading").ok).toBe(true);
    expect(lm.state).toBe("loading");

    expect(lm.transitionTo("active").ok).toBe(true);
    expect(lm.state).toBe("active");

    expect(lm.transitionTo("draining").ok).toBe(true);
    expect(lm.state).toBe("draining");

    expect(lm.transitionTo("unloading").ok).toBe(true);
    expect(lm.state).toBe("unloading");

    expect(lm.transitionTo("disposed").ok).toBe(true);
    expect(lm.state).toBe("disposed");
    expect(lm.isTerminal).toBe(true);
  });

  it("rejects invalid transitions", () => {
    const lm = new LifecycleMachine(makeIdentity());
    const result = lm.transitionTo("active");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rule).toBe("LIFECYCLE-02");
    }
    expect(lm.state).toBe("declared");
  });

  it("rejects self-transitions", () => {
    const result = transition("active", "active");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rule).toBe("LIFECYCLE-01");
    }
  });

  it("allows failed transition from any non-terminal state", () => {
    const states: ComponentLifecycleState[] = [
      "declared",
      "waiting",
      "loading",
      "active",
      "draining",
      "unloading",
    ];
    for (const s of states) {
      expect(isValidTransition(s, "failed")).toBe(true);
    }
  });

  it("allows quarantined from failed", () => {
    expect(isValidTransition("failed", "quarantined")).toBe(true);
  });

  it("terminal states have no outgoing transitions", () => {
    expect(isValidTransition("disposed", "active")).toBe(false);
    expect(isValidTransition("quarantined", "active")).toBe(false);
    expect(isValidTransition("disposed", "failed")).toBe(false);
    expect(isValidTransition("quarantined", "failed")).toBe(false);
  });

  it("canAcceptNewCalls only in active state", () => {
    expect(canAcceptNewCalls("active")).toBe(true);
    expect(canAcceptNewCalls("declared")).toBe(false);
    expect(canAcceptNewCalls("draining")).toBe(false);
    expect(canAcceptNewCalls("disposed")).toBe(false);
  });

  it("canCancel in active or draining", () => {
    expect(canCancel("active")).toBe(true);
    expect(canCancel("draining")).toBe(true);
    expect(canCancel("loading")).toBe(false);
    expect(canCancel("disposed")).toBe(false);
  });

  it("isTerminal for disposed and quarantined", () => {
    expect(isTerminal("disposed")).toBe(true);
    expect(isTerminal("quarantined")).toBe(true);
    expect(isTerminal("active")).toBe(false);
    expect(isTerminal("failed")).toBe(false);
  });

  it("transitionTo does not mutate state on failure", () => {
    const lm = new LifecycleMachine(makeIdentity(), "active");
    const result = lm.transitionTo("loading");
    expect(result.ok).toBe(false);
    expect(lm.state).toBe("active");
  });
});
