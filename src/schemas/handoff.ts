/*
<MODULE_CONTRACT>
<purpose>
RFC-0221: Zod schemas for the internal site handoff bundle — the version-stamped
lock that makes ingest version-aware, and the authored/derived manifest partition.
</purpose>
<non-goals>
  <item>Do not perform file IO, hashing, or version comparison — pure shape only.</item>
  <item>Do not define migrator logic — that lives in @warpgogol/site-kernel-handoff.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0221: initial schemas for the site handoff bundle.</item>
  <item>RFC-0479: migratorCursor changed from SemVer string to string[] (migrator-id list).</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";

const semverRe = /^\d+\.\d+\.\d+$/;
const sha256Re = /^sha256:[0-9a-f]{64}$/;

/** A single consumed capability, snapshotted from uni.registry.yaml at pack time. */
export const handoffCapabilitySchema = z.object({
  /** Unique uni.registry entry id (e.g. "breadcrumbs-component") — the diff key. */
  id: z.string().min(1),
  /** Role/semanticId — NOT unique across layers; used for intent grouping and display. */
  semanticId: z.string().min(1),
  /** Capability version consumed (uni.registry entry version). */
  version: z.string().min(1),
  /** Carried so red-tier removals can be remapped by intent rather than by name. */
  intent: z.array(z.string()).default([]),
});

/** Ecosystem stamp: which studio monorepo state the bundle was packed against. */
export const handoffEcosystemSchema = z.object({
  /** Root package.json version at pack time, e.g. "4.5.0". */
  version: z.string().regex(semverRe, "ecosystem.version must be x.y.z"),
  /** git SHA of the studio monorepo at pack time. */
  commit: z.string().min(7),
  /** Highest `implemented` RFC id at pack time, e.g. "RFC-0220". */
  rfcHead: z.string().regex(/^RFC-\d{4}$/),
  /** Semantic fingerprint of the packages/ tree at pack time (RFC-0364). */
  platformSemanticHash: z.string().regex(sha256Re),
  /** Legacy byte hash of packages/ — read-only during migration, removed in RFC-0364 step 7. */
  packagesHash: z.string().regex(sha256Re).optional(),
});

/** Passport-derived build provenance carried with the bundle. */
export const handoffBuildSchema = z.object({
  /** sha256 of system.yaml at last build. */
  systemHash: z.string().regex(sha256Re),
  commitSha: z.string().min(7),
});

/** handoff-lock.json — the artifact that makes ingest version-aware (RFC-0221 §2). */
export const handoffLockSchema = z.object({
  /** Lock format version, independent of the ecosystem version. */
  schemaVersion: z.string().regex(semverRe),
  app: z.string().min(1),
  packedAt: z.string().datetime(),
  ecosystem: handoffEcosystemSchema,
  /** Ecosystem version this site is "synced to" — equals ecosystem.version at pack. */
  migratorCursor: z.array(z.string()),
  /** The CONSUMED subset of uni.registry.yaml (not the whole registry). */
  capabilities: z.array(handoffCapabilitySchema).default([]),
  build: handoffBuildSchema,
});

/** One path entry in the bundle manifest: is it source of truth, or regenerated? */
export const handoffManifestEntrySchema = z.object({
  /** Bundle-relative POSIX path. */
  path: z.string().min(1),
  /** authored = round-trips, source of truth. derived = disposable, regenerated. */
  kind: z.enum(["authored", "derived"]),
  /** sha256 of the file contents at pack time (integrity + derived-edit detection). */
  hash: z.string().regex(sha256Re),
});

/** handoff-manifest.json — authored/derived partition + integrity (RFC-0221 §5). */
export const handoffManifestSchema = z.object({
  schemaVersion: z.string().regex(semverRe),
  app: z.string().min(1),
  entries: z.array(handoffManifestEntrySchema).default([]),
});

export type HandoffCapability = z.infer<typeof handoffCapabilitySchema>;
export type HandoffEcosystem = z.infer<typeof handoffEcosystemSchema>;
export type HandoffBuild = z.infer<typeof handoffBuildSchema>;
export type HandoffLock = z.infer<typeof handoffLockSchema>;
export type HandoffManifestEntry = z.infer<typeof handoffManifestEntrySchema>;
export type HandoffManifest = z.infer<typeof handoffManifestSchema>;
