import { describe, it, expect } from "vitest";
import { resolveOverlays, inspectOverlays, OverlayConflictError } from "../overlay.ts";
import type {
  DesiredState,
  DesiredStateOverlay,
  ComponentDeclaration,
} from "../desired-state.ts";
import type { Sha256Digest } from "../../fingerprint/primitives.ts";

const VALID_SHA = "sha256:" + "a".repeat(64) as Sha256Digest;

function makeDeclaration(id: string): ComponentDeclaration {
  return {
    schema: "werkstatt/component-declaration@1",
    componentId: id as `${string}/${string}`,
    version: "1.0.0",
    artifactHash: VALID_SHA,
    scope: "per-workshop",
    provides: [],
    requires: [],
    requestedGrants: [],
    effects: [],
    isolation: { tier: 0, adapterId: null },
    resources: [],
    priority: 0,
    active: true,
  };
}

function makeBaseState(components: ComponentDeclaration[] = []): DesiredState {
  return {
    components: new Map(components.map((c) => [c.componentId, c])),
    requiredCapabilities: [],
    availableArtifacts: new Map(),
    admittedGrants: [],
    profileId: "test",
  };
}

function makeOverlay(
  id: string,
  addOrReplace: ComponentDeclaration[] = [],
  remove: string[] = [],
  priority = 100,
): DesiredStateOverlay {
  return {
    id,
    scope: "per-workshop",
    context: { scope: "per-workshop" },
    addOrReplace: new Map(addOrReplace.map((c) => [c.componentId, c])),
    remove,
    priority,
  };
}

describe("RFC-1038: resolveOverlays", () => {
  it("AC-7: overlay.apply applies overlay to base desired state", () => {
    const base = makeBaseState();
    const decl = makeDeclaration("werkstatt/overlay-comp");
    const overlay = makeOverlay("test-overlay", [decl]);

    const resolved = resolveOverlays(base, [overlay]);
    expect(resolved.components.has("werkstatt/overlay-comp")).toBe(true);
    expect(resolved.components.get("werkstatt/overlay-comp")).toBe(decl);
  });

  it("overlay with remove deletes component from base", () => {
    const decl = makeDeclaration("werkstatt/remove-me");
    const base = makeBaseState([decl]);
    const overlay = makeOverlay("test-overlay", [], ["werkstatt/remove-me"]);

    const resolved = resolveOverlays(base, [overlay]);
    expect(resolved.components.has("werkstatt/remove-me")).toBe(false);
  });

  it("AC-8: two overlays same priority same componentId → COMPOSITION-01", () => {
    const base = makeBaseState();
    const decl1 = makeDeclaration("werkstatt/conflict");
    const decl2 = makeDeclaration("werkstatt/conflict");
    const overlay1 = makeOverlay("overlay-a", [decl1], [], 100);
    const overlay2 = makeOverlay("overlay-b", [decl2], [], 100);

    expect(() => resolveOverlays(base, [overlay1, overlay2])).toThrow(OverlayConflictError);
    expect(() => resolveOverlays(base, [overlay1, overlay2])).toThrow(/COMPOSITION-01/);
  });

  it("different priorities for same componentId do not conflict", () => {
    const base = makeBaseState();
    const decl1 = makeDeclaration("werkstatt/priority-test");
    const decl2 = makeDeclaration("werkstatt/priority-test");
    const overlay1 = makeOverlay("overlay-low", [decl1], [], 50);
    const overlay2 = makeOverlay("overlay-high", [decl2], [], 100);

    const resolved = resolveOverlays(base, [overlay1, overlay2]);
    expect(resolved.components.has("werkstatt/priority-test")).toBe(true);
  });

  it("empty overlays returns base unchanged", () => {
    const base = makeBaseState([makeDeclaration("werkstatt/base")]);
    const resolved = resolveOverlays(base, []);
    expect(resolved).toBe(base);
  });
});

describe("RFC-1038: inspectOverlays", () => {
  it("returns summary of each overlay", () => {
    const overlays = [
      makeOverlay("overlay-a", [makeDeclaration("werkstatt/a")], [], 100),
      makeOverlay("overlay-b", [], ["werkstatt/b"], 50),
    ];
    const summary = inspectOverlays(overlays);
    expect(summary).toHaveLength(2);
    expect(summary[0]!.id).toBe("overlay-a");
    expect(summary[0]!.addCount).toBe(1);
    expect(summary[0]!.removeCount).toBe(0);
    expect(summary[1]!.id).toBe("overlay-b");
    expect(summary[1]!.addCount).toBe(0);
    expect(summary[1]!.removeCount).toBe(1);
  });
});
