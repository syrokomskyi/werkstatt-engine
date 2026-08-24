/*
<MODULE_CONTRACT>
<purpose>RFC-0221 §6: diff a bundle's consumed capabilities against the current
uni.registry, classifying each into a green / yellow / red catch-up tier.</purpose>
<non-goals>
  <item>Do not apply migrators or edit files — classification only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: initial capability diff + tiering.</item>
</CHANGE_SUMMARY>
*/

import type { HandoffCapability } from "@warpgogol/werkstatt-engine/schemas";
import type { CapabilityDiffItem, CatchupTier, RegistryView } from "./types.ts";
import type { Migrator } from "../migrators/types.ts";

const TIER_RANK: Record<CatchupTier, number> = { green: 0, yellow: 1, red: 2 };

export function worstTier(tiers: CatchupTier[]): CatchupTier {
  return tiers.reduce<CatchupTier>((acc, t) => (TIER_RANK[t] > TIER_RANK[acc] ? t : acc), "green");
}

/** Current entry ids whose intent overlaps the removed capability's intent. */
export function intentMatches(removed: HandoffCapability, registry: RegistryView): string[] {
  const wanted = new Set(removed.intent);
  if (wanted.size === 0) return [];
  const out: string[] = [];
  for (const [id, entry] of registry.byId) {
    if (id === removed.id) continue;
    if (entry.intent.some((i) => wanted.has(i))) out.push(id);
  }
  return out.sort();
}

/** Any migrator in the chain covers all bumped capabilities (RFC-0479: migrators are generic transforms). */
function hasMigratorFor(_cap: HandoffCapability, migrators: Migrator[]): boolean {
  return migrators.length > 0;
}

/**
 * RFC-0221 §6 tiers:
 *   unchanged / additive      → green
 *   renamed-or-bumped + migrator covered → yellow ; otherwise → red
 *   removed                   → red (with intent-matched replacement candidates)
 */
export function diffCapabilities(
  consumed: HandoffCapability[],
  registry: RegistryView,
  migrators: Migrator[],
): CapabilityDiffItem[] {
  return consumed.map((cap): CapabilityDiffItem => {
    const current = registry.byId.get(cap.id);

    if (!current) {
      const matches = intentMatches(cap, registry);
      return {
        id: cap.id,
        fromVersion: cap.version,
        toVersion: null,
        change: "removed",
        tier: "red",
        intentMatches: matches,
        note:
          matches.length > 0
            ? `removed — candidate replacements by intent: ${matches.join(", ")}`
            : "removed — no intent-matched replacement; manual decision required",
      };
    }

    if (current.version === cap.version) {
      return {
        id: cap.id,
        fromVersion: cap.version,
        toVersion: current.version,
        change: "unchanged",
        tier: "green",
        note: "unchanged",
      };
    }

    const covered = hasMigratorFor(cap, migrators);
    return {
      id: cap.id,
      fromVersion: cap.version,
      toVersion: current.version,
      change: "renamed-or-bumped",
      tier: covered ? "yellow" : "red",
      note: covered
        ? `version ${cap.version} → ${current.version}, covered by migrator`
        : `version ${cap.version} → ${current.version}, NO migrator — manual`,
    };
  });
}
