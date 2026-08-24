/*
<MODULE_CONTRACT>
<purpose>RFC-0221 §4.1: the version-compare matrix — the core safety gate of handoff.absorb.</purpose>
<non-goals>
  <item>Do not read the filesystem or git — inputs are already-resolved facts.</item>
  <item>Do not apply migrators — that is the absorb pipeline's job.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: initial matrix.</item>
</CHANGE_SUMMARY>
*/

import { compareSemver } from "./semver.ts";
import type { VersionComparison } from "./types.ts";

export interface CompareEcosystemInput {
  sourceVersion: string;
  currentVersion: string;
  /** packagesHash from the lock (legacy byte hash). */
  sourcePackagesHash: string;
  /** packagesHash of the recipient's current packages/ tree (legacy byte hash). */
  currentPackagesHash: string;
  /** RFC-0364: platformSemanticHash from the lock (preferred drift signal). */
  sourcePlatformSemanticHash?: string;
  /** RFC-0364: platformSemanticHash of the recipient's current packages/ tree. */
  currentPlatformSemanticHash?: string;
}

/**
 * RFC-0221 §4.1 normative matrix:
 *   V_src == V_cur  → in-sync (packagesDrift flagged if hashes differ)
 *   V_src <  V_cur  → catch-up
 *   V_src >  V_cur  → refuse-downgrade ("git pull first"; never downgrade a site)
 */
export function compareEcosystem(input: CompareEcosystemInput): VersionComparison {
  const {
    sourceVersion,
    currentVersion,
    sourcePackagesHash,
    currentPackagesHash,
    sourcePlatformSemanticHash,
    currentPlatformSemanticHash,
  } = input;
  const order = compareSemver(sourceVersion, currentVersion);

  if (order > 0) {
    return {
      verdict: "refuse-downgrade",
      sourceVersion,
      currentVersion,
      packagesDrift: false,
      message:
        `your ecosystem (${currentVersion}) is older than this bundle (${sourceVersion}) — ` +
        `run \`git pull\` and retry. A site is never downgraded.`,
    };
  }

  if (order < 0) {
    return {
      verdict: "catch-up",
      sourceVersion,
      currentVersion,
      packagesDrift: false,
      message: `catch-up: migrating site from ${sourceVersion} to ${currentVersion}.`,
    };
  }

  // RFC-0364: prefer platformSemanticHash when both sides have it; fall back to packagesHash.
  const sourceHash = sourcePlatformSemanticHash ?? sourcePackagesHash;
  const currentHash = currentPlatformSemanticHash ?? currentPackagesHash;
  const packagesDrift = sourceHash !== currentHash;
  return {
    verdict: "in-sync",
    sourceVersion,
    currentVersion,
    packagesDrift,
    message: packagesDrift
      ? `in sync at ${currentVersion}, but your packages/ differ from the bundle's release ` +
        `snapshot (uncommitted ecosystem drift) — proceeding with a warning.`
      : `in sync at ${currentVersion}; no migration needed.`,
  };
}
