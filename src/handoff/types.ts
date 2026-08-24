/*
<MODULE_CONTRACT>
<purpose>RFC-0221/RFC-0479: shared types for the site handoff — capability diff,
version comparison verdicts, and the catch-up report. Migrator types moved to
migrators/types.ts (RFC-0479).</purpose>
<non-goals>
  <item>Do not implement any logic — types only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: initial type surface.</item>
  <item>RFC-0479: removed old Migrator, MigratorContext, MigratorStatus, ContractChangePoint types — replaced by migrators/types.ts.</item>
</CHANGE_SUMMARY>
*/

import type { HandoffCapability } from "@warpgogol/werkstatt-engine/schemas";

/** The authored set a migrator transforms (path -> file contents), kept transport-agnostic. */
export type AuthoredSet = Map<string, string>;

export type CatchupTier = "green" | "yellow" | "red";

export type CapabilityChange = "unchanged" | "additive" | "renamed-or-bumped" | "removed";

export interface CapabilityDiffItem {
  /** Unique uni.registry entry id. */
  id: string;
  /** Version consumed by the bundle. */
  fromVersion: string;
  /** Version available in the current registry, or null when removed. */
  toVersion: string | null;
  change: CapabilityChange;
  tier: CatchupTier;
  /** For removed capabilities: candidate replacements matched by intent. */
  intentMatches?: string[];
  /** Human-readable note (e.g. migrator rfc, or "no migrator — manual"). */
  note: string;
}

export type VersionVerdict = "in-sync" | "catch-up" | "refuse-downgrade";

export interface VersionComparison {
  verdict: VersionVerdict;
  sourceVersion: string;
  currentVersion: string;
  /** True when versions are equal but packagesHash differs (local ecosystem drift). */
  packagesDrift: boolean;
  message: string;
}

export interface CatchupReport {
  app: string;
  comparison: VersionComparison;
  /** Ordered migrator chain selected for application. */
  migratorChain: Array<{ id: string; description: string }>;
  capabilityDiff: CapabilityDiffItem[];
  /** Worst tier across migrators + capability diff. */
  overallTier: CatchupTier;
}

/** Minimal current-registry view handoff.absorb diffs the lock against. */
export interface RegistryView {
  /** Unique entry id -> { version, semanticId, intent }. */
  byId: Map<string, { version: string; semanticId: string; intent: string[] }>;
}

export type { HandoffCapability };
