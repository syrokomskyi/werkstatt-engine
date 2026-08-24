/*
<MODULE_CONTRACT>
<purpose>RFC-0221 §4 + §6: build the catch-up report from a lock and the recipient's
current ecosystem — the pure core of handoff.absorb, independent of filesystem writes.</purpose>
<non-goals>
  <item>Do not read files or apply migrators — inputs are already resolved.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: initial pure report builder.</item>
</CHANGE_SUMMARY>
*/

import type { HandoffLock } from "@warpgogol/werkstatt-engine/schemas";
import { diffCapabilities, worstTier } from "./capability-diff.ts";
import { migratorsToApply } from "../migrators/registry.ts";
import type { CatchupReport, CatchupTier, RegistryView } from "./types.ts";
import { compareEcosystem } from "./version-compare.ts";

export interface BuildReportInput {
  lock: HandoffLock;
  currentVersion: string;
  currentPackagesHash: string;
  /** RFC-0364: semantic fingerprint of the recipient's packages/ tree. */
  currentPlatformSemanticHash?: string;
  registry: RegistryView;
}

function migratorTier(): CatchupTier {
  return "yellow";
}

export function buildCatchupReport(input: BuildReportInput): CatchupReport {
  const { lock, currentVersion, currentPackagesHash, currentPlatformSemanticHash, registry } =
    input;

  const comparison = compareEcosystem({
    sourceVersion: lock.ecosystem.version,
    currentVersion,
    sourcePackagesHash: lock.ecosystem.packagesHash ?? "",
    currentPackagesHash,
    sourcePlatformSemanticHash: lock.ecosystem.platformSemanticHash,
    currentPlatformSemanticHash,
  });

  // A downgrade is refused before any migration is considered.
  if (comparison.verdict === "refuse-downgrade") {
    return {
      app: lock.app,
      comparison,
      migratorChain: [],
      capabilityDiff: [],
      overallTier: "red",
    };
  }

  const chain = migratorsToApply(lock.migratorCursor);
  const migratorChain = chain.map((m) => ({ id: m.id, description: m.description }));
  const capabilityDiff = diffCapabilities(lock.capabilities, registry, chain);

  const overallTier = worstTier([
    ...capabilityDiff.map((d) => d.tier),
    ...migratorChain.map(() => migratorTier()),
  ]);

  return { app: lock.app, comparison, migratorChain, capabilityDiff, overallTier };
}
