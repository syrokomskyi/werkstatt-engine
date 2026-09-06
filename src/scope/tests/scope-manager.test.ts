/*
<MODULE_CONTRACT>
<purpose>RFC-1036: tests for ScopeManager — registry lifecycle, scope resolution order,
  adopt for manual scopes, error codes, registry limit, disposal.</purpose>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
<item>RFC-1036: initial test suite for ScopeManager.</item>
</CHANGE_SUMMARY>
*/

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createScopeManager,
  ScopeError,
  resetDefaultScopeManager,
  getDefaultScopeManager,
} from "../scope.ts";
import type {
  ComponentManifestV1,
  ComponentScope,
  ScopeContext,
} from "../../component/contracts.ts";
import { SCOPE_ERROR_CODES } from "../../component/contracts.ts";

function makeManifest(
  componentId: string,
  scope: ComponentScope,
  capability?: string,
): ComponentManifestV1 {
  return {
    schema: "werkstatt/component-manifest@1",
    componentId: componentId as `${string}/${string}`,
    version: "1.0.0",
    artifactHash: "sha256:abc",
    scope,
    provides: capability
      ? [
          {
            capability: capability as `${string}/${string}`,
            version: "1.0.0",
            schemaHash: "sha256:def",
          },
        ]
      : [],
    requires: [],
    requestedGrants: [],
    effects: [],
    isolation: { tier: 0, adapterId: null },
    resources: [],
  };
}

describe("ScopeManager", () => {
  describe("registry lifecycle", () => {
    it("creates a registry on getRegistry and returns the same instance for the same context", () => {
      const mgr = createScopeManager();
      const ctx: ScopeContext = { scope: "per-mission", missionId: "m001" };
      const r1 = mgr.getRegistry(ctx);
      const r2 = mgr.getRegistry(ctx);
      expect(r1).toBe(r2);
    });

    it("creates distinct registries for different contexts", () => {
      const mgr = createScopeManager();
      const r1 = mgr.getRegistry({ scope: "per-mission", missionId: "m001" });
      const r2 = mgr.getRegistry({ scope: "per-mission", missionId: "m002" });
      expect(r1).not.toBe(r2);
    });

    it("disposeRegistry removes the registry", () => {
      const mgr = createScopeManager();
      const ctx: ScopeContext = { scope: "per-mission", missionId: "m001" };
      const r = mgr.getRegistry(ctx);
      r.register(makeManifest("comp/a", "per-mission", "cap/test"));
      mgr.disposeRegistry(ctx);
      const scopes = mgr.inspect();
      expect(scopes).toHaveLength(0);
    });

    it("disposeRegistry is a no-op for non-existent registry", () => {
      const mgr = createScopeManager();
      expect(() =>
        mgr.disposeRegistry({ scope: "per-mission", missionId: "nonexistent" }),
      ).not.toThrow();
    });
  });

  describe("register and resolve", () => {
    it("register adds a component to the registry", () => {
      const mgr = createScopeManager();
      const r = mgr.getRegistry({ scope: "per-workshop" });
      r.register(makeManifest("comp/a", "per-workshop", "cap/test"));
      expect(r.list()).toHaveLength(1);
    });

    it("resolve finds a component by capability", () => {
      const mgr = createScopeManager();
      const r = mgr.getRegistry({ scope: "per-workshop" });
      r.register(makeManifest("comp/a", "per-workshop", "cap/test"));
      const found = r.resolve("cap/test" as `${string}/${string}`);
      expect(found).not.toBeNull();
      expect(found!.componentId).toBe("comp/a");
    });

    it("resolve returns null for unknown capability", () => {
      const mgr = createScopeManager();
      const r = mgr.getRegistry({ scope: "per-workshop" });
      r.register(makeManifest("comp/a", "per-workshop", "cap/test"));
      expect(r.resolve("cap/unknown" as `${string}/${string}`)).toBeNull();
    });

    it("register throws SCOPE-01 on duplicate component", () => {
      const mgr = createScopeManager();
      const r = mgr.getRegistry({ scope: "per-workshop" });
      r.register(makeManifest("comp/a", "per-workshop", "cap/test"));
      expect(() => r.register(makeManifest("comp/a", "per-workshop", "cap/test"))).toThrow(
        ScopeError,
      );
      try {
        r.register(makeManifest("comp/a", "per-workshop", "cap/test"));
      } catch (e) {
        expect((e as ScopeError).code).toBe(SCOPE_ERROR_CODES.SCOPE_01);
      }
    });

    it("register throws SCOPE-01 when manifest scope does not match registry scope", () => {
      const mgr = createScopeManager();
      const r = mgr.getRegistry({ scope: "per-workshop" });
      expect(() => r.register(makeManifest("comp/a", "per-mission", "cap/test"))).toThrow(
        ScopeError,
      );
      try {
        r.register(makeManifest("comp/a", "per-mission", "cap/test"));
      } catch (e) {
        expect((e as ScopeError).code).toBe(SCOPE_ERROR_CODES.SCOPE_01);
      }
    });

    it("register on disposed registry throws SCOPE-01", () => {
      const mgr = createScopeManager();
      const ctx: ScopeContext = { scope: "per-workshop" };
      const r = mgr.getRegistry(ctx);
      mgr.disposeRegistry(ctx);
      expect(() => r.register(makeManifest("comp/a", "per-workshop", "cap/test"))).toThrow(
        ScopeError,
      );
    });

    it("AC-2: register throws SCOPE-03 when manifest is missing scope field", () => {
      const mgr = createScopeManager();
      const r = mgr.getRegistry({ scope: "per-workshop" });
      const manifest: Record<string, unknown> = {
        ...makeManifest("comp/a", "per-workshop", "cap/test"),
      };
      delete manifest.scope;
      expect(() => r.register(manifest as unknown as ComponentManifestV1)).toThrow(ScopeError);
      try {
        r.register(manifest as unknown as ComponentManifestV1);
      } catch (e) {
        expect((e as ScopeError).code).toBe(SCOPE_ERROR_CODES.SCOPE_03);
      }
    });
  });

  describe("resolveAcrossScopes", () => {
    it("searches innermost-first: per-command before per-mission", () => {
      const mgr = createScopeManager();
      const cmdRegistry = mgr.getRegistry({
        scope: "per-command",
        invocationId: "cmd-001",
      });
      cmdRegistry.register(makeManifest("comp/cmd", "per-command", "cap/test"));

      const missionRegistry = mgr.getRegistry({
        scope: "per-mission",
        missionId: "m001",
      });
      missionRegistry.register(makeManifest("comp/mission", "per-mission", "cap/test"));

      const ctx: ScopeContext = {
        scope: "per-command",
        invocationId: "cmd-001",
        missionId: "m001",
      };
      const result = mgr.resolveAcrossScopes("cap/test" as `${string}/${string}`, ctx);
      expect(result).not.toBeNull();
      expect(result!.componentId).toBe("comp/cmd");
    });

    it("falls through to per-mission when per-command has no provider", () => {
      const mgr = createScopeManager();
      const missionRegistry = mgr.getRegistry({
        scope: "per-mission",
        missionId: "m001",
      });
      missionRegistry.register(makeManifest("comp/mission", "per-mission", "cap/test"));

      const ctx: ScopeContext = {
        scope: "per-command",
        invocationId: "cmd-001",
        missionId: "m001",
      };
      const result = mgr.resolveAcrossScopes("cap/test" as `${string}/${string}`, ctx);
      expect(result).not.toBeNull();
      expect(result!.componentId).toBe("comp/mission");
    });

    it("falls through to per-workshop when no inner scopes have providers", () => {
      const mgr = createScopeManager();
      const workshopRegistry = mgr.getRegistry({ scope: "per-workshop" });
      workshopRegistry.register(makeManifest("comp/workshop", "per-workshop", "cap/test"));

      const ctx: ScopeContext = {
        scope: "per-command",
        invocationId: "cmd-001",
        missionId: "m001",
      };
      const result = mgr.resolveAcrossScopes("cap/test" as `${string}/${string}`, ctx);
      expect(result).not.toBeNull();
      expect(result!.componentId).toBe("comp/workshop");
    });

    it("returns null when no scope has a provider", () => {
      const mgr = createScopeManager();
      const ctx: ScopeContext = {
        scope: "per-command",
        invocationId: "cmd-001",
        missionId: "m001",
      };
      expect(mgr.resolveAcrossScopes("cap/none" as `${string}/${string}`, ctx)).toBeNull();
    });

    it("resolves per-fleet when fleetId is provided", () => {
      const mgr = createScopeManager();
      const fleetRegistry = mgr.getRegistry({
        scope: "per-fleet",
        fleetId: "fleet-1",
      });
      fleetRegistry.register(makeManifest("comp/fleet", "per-fleet", "cap/test"));

      const ctx: ScopeContext = {
        scope: "per-fleet",
        fleetId: "fleet-1",
      };
      const result = mgr.resolveAcrossScopes("cap/test" as `${string}/${string}`, ctx);
      expect(result).not.toBeNull();
      expect(result!.componentId).toBe("comp/fleet");
    });

    it("AC-6: per-workshop scope cannot see per-command or per-mission providers", () => {
      const mgr = createScopeManager();
      const cmdRegistry = mgr.getRegistry({
        scope: "per-command",
        invocationId: "cmd-001",
      });
      cmdRegistry.register(makeManifest("comp/cmd", "per-command", "cap/test"));

      const missionRegistry = mgr.getRegistry({
        scope: "per-mission",
        missionId: "m001",
      });
      missionRegistry.register(makeManifest("comp/mission", "per-mission", "cap/test"));

      // Caller in per-workshop scope should NOT find per-command or per-mission providers
      const ctx: ScopeContext = { scope: "per-workshop" };
      const result = mgr.resolveAcrossScopes("cap/test" as `${string}/${string}`, ctx);
      expect(result).toBeNull();
    });

    it("AC-6: per-mission scope can see per-mission and outer but not per-command", () => {
      const mgr = createScopeManager();
      const cmdRegistry = mgr.getRegistry({
        scope: "per-command",
        invocationId: "cmd-001",
      });
      cmdRegistry.register(makeManifest("comp/cmd", "per-command", "cap/test"));

      const missionRegistry = mgr.getRegistry({
        scope: "per-mission",
        missionId: "m001",
      });
      missionRegistry.register(makeManifest("comp/mission", "per-mission", "cap/test"));

      // Caller in per-mission scope should find per-mission, not per-command
      const ctx: ScopeContext = { scope: "per-mission", missionId: "m001" };
      const result = mgr.resolveAcrossScopes("cap/test" as `${string}/${string}`, ctx);
      expect(result).not.toBeNull();
      expect(result!.componentId).toBe("comp/mission");
    });

    it("AC-5: concurrent missions with same component ID are isolated", () => {
      const mgr = createScopeManager();
      const r1 = mgr.getRegistry({ scope: "per-mission", missionId: "m001" });
      const r2 = mgr.getRegistry({ scope: "per-mission", missionId: "m002" });
      r1.register(makeManifest("comp/a", "per-mission", "cap/test"));
      r2.register(makeManifest("comp/a", "per-mission", "cap/test"));

      // Each mission resolves its own component
      const result1 = mgr.resolveAcrossScopes("cap/test" as `${string}/${string}`, {
        scope: "per-mission",
        missionId: "m001",
      });
      const result2 = mgr.resolveAcrossScopes("cap/test" as `${string}/${string}`, {
        scope: "per-mission",
        missionId: "m002",
      });
      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      // Both have same component ID but in separate registries
      expect(result1!.componentId).toBe("comp/a");
      expect(result2!.componentId).toBe("comp/a");

      // Disposing one does not affect the other
      mgr.disposeRegistry({ scope: "per-mission", missionId: "m001" });
      const result2After = mgr.resolveAcrossScopes("cap/test" as `${string}/${string}`, {
        scope: "per-mission",
        missionId: "m002",
      });
      expect(result2After).not.toBeNull();
      expect(result2After!.componentId).toBe("comp/a");
    });
  });

  describe("adopt", () => {
    it("adopts a component into per-fleet scope", () => {
      const mgr = createScopeManager();
      const fleetRegistry = mgr.getRegistry({ scope: "per-fleet", fleetId: "fleet-origin" });
      const manifest = makeManifest("comp/a", "per-fleet", "cap/test");
      fleetRegistry.register(manifest);

      mgr.adopt("comp/a", { scope: "per-fleet", fleetId: "fleet-1" });
      const scope = mgr.getScope("comp/a");
      expect(scope).toBe("per-fleet");
    });

    it("adopts a component into per-session scope", () => {
      const mgr = createScopeManager();
      const sessionRegistry = mgr.getRegistry({ scope: "per-session", sessionId: "sess-origin" });
      sessionRegistry.register(makeManifest("comp/a", "per-session", "cap/test"));

      mgr.adopt("comp/a", { scope: "per-session", sessionId: "sess-1" });
      expect(mgr.getScope("comp/a")).toBe("per-session");
    });

    it("throws SCOPE-02 when adopting into a non-manual scope", () => {
      const mgr = createScopeManager();
      const missionRegistry = mgr.getRegistry({ scope: "per-mission", missionId: "m-origin" });
      missionRegistry.register(makeManifest("comp/a", "per-mission", "cap/test"));

      expect(() => mgr.adopt("comp/a", { scope: "per-mission", missionId: "m001" })).toThrow(
        ScopeError,
      );
      try {
        mgr.adopt("comp/a", { scope: "per-mission", missionId: "m001" });
      } catch (e) {
        expect((e as ScopeError).code).toBe(SCOPE_ERROR_CODES.SCOPE_02);
      }
    });

    it("throws SCOPE-02 when manifest scope does not match target scope", () => {
      const mgr = createScopeManager();
      const workshopRegistry = mgr.getRegistry({ scope: "per-workshop" });
      workshopRegistry.register(makeManifest("comp/a", "per-workshop", "cap/test"));

      expect(() => mgr.adopt("comp/a", { scope: "per-fleet", fleetId: "fleet-1" })).toThrow(
        ScopeError,
      );
      try {
        mgr.adopt("comp/a", { scope: "per-fleet", fleetId: "fleet-1" });
      } catch (e) {
        expect((e as ScopeError).code).toBe(SCOPE_ERROR_CODES.SCOPE_02);
      }
    });

    it("throws SCOPE-01 when component is not found in any scope", () => {
      const mgr = createScopeManager();
      expect(() => mgr.adopt("comp/missing", { scope: "per-fleet", fleetId: "fleet-1" })).toThrow(
        ScopeError,
      );
      try {
        mgr.adopt("comp/missing", { scope: "per-fleet", fleetId: "fleet-1" });
      } catch (e) {
        expect((e as ScopeError).code).toBe(SCOPE_ERROR_CODES.SCOPE_01);
      }
    });
  });

  describe("getScope", () => {
    it("returns the scope of a registered component", () => {
      const mgr = createScopeManager();
      const r = mgr.getRegistry({ scope: "per-mission", missionId: "m001" });
      r.register(makeManifest("comp/a", "per-mission", "cap/test"));
      expect(mgr.getScope("comp/a")).toBe("per-mission");
    });

    it("returns null for unregistered component", () => {
      const mgr = createScopeManager();
      expect(mgr.getScope("comp/missing")).toBeNull();
    });
  });

  describe("inspect", () => {
    it("returns empty array when no registries exist", () => {
      const mgr = createScopeManager();
      expect(mgr.inspect()).toEqual([]);
    });

    it("returns all active registries with component counts", () => {
      const mgr = createScopeManager();
      const r1 = mgr.getRegistry({ scope: "per-mission", missionId: "m001" });
      r1.register(makeManifest("comp/a", "per-mission", "cap/test"));
      r1.register(makeManifest("comp/b", "per-mission", "cap/test2"));

      const r2 = mgr.getRegistry({ scope: "per-workshop" });
      r2.register(makeManifest("comp/c", "per-workshop", "cap/test3"));

      const scopes = mgr.inspect();
      expect(scopes).toHaveLength(2);
      const missionScope = scopes.find((s) => s.context.scope === "per-mission");
      expect(missionScope).toBeDefined();
      expect(missionScope!.componentCount).toBe(2);
      expect(missionScope!.componentIds).toContain("comp/a");
      expect(missionScope!.componentIds).toContain("comp/b");
    });

    it("excludes disposed registries", () => {
      const mgr = createScopeManager();
      const r = mgr.getRegistry({ scope: "per-mission", missionId: "m001" });
      r.register(makeManifest("comp/a", "per-mission", "cap/test"));
      mgr.disposeRegistry({ scope: "per-mission", missionId: "m001" });
      expect(mgr.inspect()).toEqual([]);
    });
  });

  describe("registry limit", () => {
    it("throws SCOPE-04 when registry limit is reached", () => {
      const mgr = createScopeManager({ registryLimit: 2 });
      mgr.getRegistry({ scope: "per-mission", missionId: "m001" });
      mgr.getRegistry({ scope: "per-mission", missionId: "m002" });
      expect(() => mgr.getRegistry({ scope: "per-mission", missionId: "m003" })).toThrow(
        ScopeError,
      );
      try {
        mgr.getRegistry({ scope: "per-mission", missionId: "m003" });
      } catch (e) {
        expect((e as ScopeError).code).toBe(SCOPE_ERROR_CODES.SCOPE_04);
      }
    });

    it("allows new registries after disposed ones free slots", () => {
      const mgr = createScopeManager({ registryLimit: 2 });
      mgr.getRegistry({ scope: "per-mission", missionId: "m001" });
      mgr.getRegistry({ scope: "per-mission", missionId: "m002" });
      mgr.disposeRegistry({ scope: "per-mission", missionId: "m001" });
      expect(() => mgr.getRegistry({ scope: "per-mission", missionId: "m003" })).not.toThrow();
    });
  });

  describe("default manager", () => {
    afterEach(() => {
      resetDefaultScopeManager();
    });

    it("returns a singleton instance", () => {
      const m1 = getDefaultScopeManager();
      const m2 = getDefaultScopeManager();
      expect(m1).toBe(m2);
    });

    it("resetDefaultScopeManager creates a new instance", () => {
      const m1 = getDefaultScopeManager();
      resetDefaultScopeManager();
      const m2 = getDefaultScopeManager();
      expect(m1).not.toBe(m2);
    });
  });

  describe("ScopeError", () => {
    it("has name ScopeError and includes code in message", () => {
      const err = new ScopeError("SCOPE-01", "test message");
      expect(err.name).toBe("ScopeError");
      expect(err.code).toBe("SCOPE-01");
      expect(err.message).toBe("SCOPE-01: test message");
      expect(err instanceof Error).toBe(true);
    });
  });
});
