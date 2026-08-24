/*
<MODULE_CONTRACT>
<purpose>RFC-0221 §6: tests for capability diff tiering — green/yellow/red and intent remap,
keyed by the unique uni.registry entry id (semanticId is not unique across layers).</purpose>
<keywords>RFC-0221, capability diff, tier, intent, id key, test</keywords>
</MODULE_CONTRACT>
<MODULE_MAP><entry key="tests">unchanged/bumped(+migrator)/removed(+intent) tiers; id-keyed.</entry></MODULE_MAP>
<CHANGE_SUMMARY>
  <item>RFC-0221: initial capability-diff tests.</item>
  <item>RFC-0221: re-key on unique entry id after the e2e run exposed semanticId collisions.</item>
</CHANGE_SUMMARY>
*/

import { test, expect } from "vitest";
import { diffCapabilities, worstTier } from "../handoff/capability-diff.ts";
import type { HandoffCapability } from "@warpgogol/werkstatt-engine/schemas";
import type { Migrator } from "../migrators/types.ts";
import type { RegistryView } from "../handoff/types.ts";

function registry(
  entries: Record<string, { version: string; semanticId?: string; intent: string[] }>,
): RegistryView {
  const byId = new Map(
    Object.entries(entries).map(([id, e]) => [
      id,
      { version: e.version, semanticId: e.semanticId ?? id, intent: e.intent },
    ]),
  );
  return { byId };
}

const cap = (id: string, version: string, intent: string[] = []): HandoffCapability => ({
  id,
  semanticId: id,
  version,
  intent,
});

test("unchanged capability is green", () => {
  const diff = diffCapabilities(
    [cap("hero-component", "1.0.0")],
    registry({ "hero-component": { version: "1.0.0", intent: [] } }),
    [],
  );
  expect(diff[0].change).toBe("unchanged");
  expect(diff[0].tier).toBe("green");
});

test("two entries sharing a semanticId but distinct ids do not collide", () => {
  const consumed: HandoffCapability[] = [
    { id: "breadcrumbs-component", semanticId: "breadcrumbs", version: "1.1.0", intent: [] },
    { id: "breadcrumbs-section", semanticId: "breadcrumbs", version: "1.0.0", intent: [] },
  ];
  const reg = registry({
    "breadcrumbs-component": { version: "1.1.0", semanticId: "breadcrumbs", intent: [] },
    "breadcrumbs-section": { version: "1.0.0", semanticId: "breadcrumbs", intent: [] },
  });
  const diff = diffCapabilities(consumed, reg, []);
  expect(diff.map((d) => d.tier)).toEqual(["green", "green"]);
});

test("version bump without migrator is red; with migrator is yellow", () => {
  const consumed = [cap("hero-component", "1.0.0")];
  const reg = registry({ "hero-component": { version: "1.1.0", intent: [] } });

  expect(diffCapabilities(consumed, reg, [])[0].tier).toBe("red");

  const migrator: Migrator = {
    id: "rfc-9999",
    fromVersion: "4.5.0",
    toVersion: "4.6.0",
    description: "bump hero",
    transform: async () => ({ rootPath: "", dataPaths: [] }),
  };
  expect(diffCapabilities(consumed, reg, [migrator])[0].tier).toBe("yellow");
});

test("a migrator in the chain lifts a bump to yellow (RFC-0479: generic transforms)", () => {
  const consumed = [cap("hero-component", "1.0.0")];
  const reg = registry({ "hero-component": { version: "1.1.0", intent: [] } });
  const migrator: Migrator = {
    id: "rfc-9998",
    fromVersion: "4.5.0",
    toVersion: "4.6.0",
    description: "covers a different capability",
    transform: async () => ({ rootPath: "", dataPaths: [] }),
  };
  expect(diffCapabilities(consumed, reg, [migrator])[0].tier).toBe("yellow");
});

test("removed capability is red and proposes intent-matched replacements", () => {
  const consumed = [cap("old-brand", "1.0.0", ["establish-identity"])];
  const reg = registry({
    "brand-label-component": {
      version: "1.1.0",
      intent: ["establish-identity", "guide-navigation"],
    },
    "breadcrumbs-component": { version: "1.1.0", intent: ["guide-navigation"] },
  });
  const diff = diffCapabilities(consumed, reg, []);
  expect(diff[0].change).toBe("removed");
  expect(diff[0].tier).toBe("red");
  expect(diff[0].intentMatches).toEqual(["brand-label-component"]);
});

test("worstTier rolls up to the highest severity", () => {
  expect(worstTier(["green", "green"])).toBe("green");
  expect(worstTier(["green", "yellow"])).toBe("yellow");
  expect(worstTier(["yellow", "red", "green"])).toBe("red");
  expect(worstTier([])).toBe("green");
});
