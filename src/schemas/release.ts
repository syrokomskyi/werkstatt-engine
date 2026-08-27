/*
<MODULE_CONTRACT>
<purpose>RFC-0357/RFC-0851: Zod schemas for release manifest (artifact-only prepared|ready), behavior snapshot wrapper, snapshot diff, and legacy release diagnostics.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
  <item>Do not reintroduce legacy deployment states (published, dev-deployed, alt-deployed, promoted, main-deployed, rolled-back) into the artifact state schema.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0357: initial release and behavior snapshot schemas.</item>
  <item>RFC-0608: extend releaseStateSchema with alt-deployed and promoted; add buildIdentitySchema.</item>
  <item>RFC-0627: add dev-deployed state (precedes alt-deployed in the three-channel deployment chain).</item>
  <item>RFC-0628: remove dev-deployed state (workpiece-based dev deploy does not enter the release state machine).</item>
  <item>RFC-0851: replace legacy state enum with artifact-only prepared|ready; make manifest strict; replace publishedAt with readyAt; add legacyReleaseStateSchema and legacyReleaseDiagnosticSchema.</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";
import { STERNSYSTEM_ID_REGEX, MISSION_ID_REGEX, RELEASE_ID_REGEX } from "./naming-policy.ts";
import { releaseArtifactRefSchema as artifactRefSchema } from "./artifact-store.ts";

export const releaseArtifactStateSchema = z.enum(["prepared", "ready"]);

export const releaseStateSchema = releaseArtifactStateSchema;

export const legacyReleaseStateSchema = z.enum([
  "published",
  "dev-deployed",
  "alt-deployed",
  "promoted",
  "main-deployed",
  "rolled-back",
]);

export const legacyReleaseDiagnosticSchema = z
  .object({
    schema: z.literal("werkstatt/legacy-release-diagnostic@1"),
    releaseId: z.string().regex(RELEASE_ID_REGEX),
    legacyState: legacyReleaseStateSchema,
    ruleId: z.literal("CERT-LEGACY-STATE-01"),
    message: z.string().min(1),
    fixHint: z.string().min(1),
  })
  .strict();

export const releaseManifestSchema = z
  .object({
    schemaVersion: z.string().min(1),
    releaseId: z.string().regex(RELEASE_ID_REGEX),
    systemId: z.string().regex(STERNSYSTEM_ID_REGEX),
    missionId: z.string().regex(MISSION_ID_REGEX),
    semver: z.string(),
    platformVersion: z.string(),
    createdAt: z.string().datetime(),
    readyAt: z.string().datetime().nullable(),
    state: releaseArtifactStateSchema,
    commitSha: z.string(),
    platformSemanticHash: z.string(),
    siteContentHash: z.string(),
    distTreeHash: z.string(),
    distArtifactHash: z.string().nullable(),
    artifact: artifactRefSchema.nullable(),
    behaviorSnapshotHash: z.string(),
    readableSnapshotHash: z.string(),
    qualityReportHash: z.string().nullable(),
    snapshotDiffVerdict: z.enum(["pass", "fail"]),
    migratorVerdict: z.enum(["pass", "fail"]),
    versionCompareVerdict: z.enum(["in-sync", "catch-up", "refuse-downgrade"]),
    bootSmokeVerdict: z.enum(["pass", "fail"]),
  })
  .strict();

export const releaseArtifactRefSchema = z.object({
  store: z.literal("werkstatt-local"),
  algorithm: z.literal("sha256"),
  digest: z.string(),
  uri: z.string(),
  manifestHash: z.string(),
});

export const behaviorSnapshotDifferenceSchema = z.object({
  field: z.string(),
  kind: z.enum(["added", "removed", "changed"]),
  detail: z.string(),
});

export const behaviorSnapshotDiffSchema = z.object({
  schemaVersion: z.string().min(1),
  baselineHash: z.string(),
  candidateHash: z.string(),
  verdict: z.enum(["pass", "fail"]),
  differences: z.array(behaviorSnapshotDifferenceSchema),
});

export const buildIdentitySchema = z.object({
  releaseId: z.string().regex(/^(workpiece-)?[a-z0-9]+(-[a-z0-9]+)*(-r\d{6}|-m\d{6})$/),
  systemId: z.string().regex(STERNSYSTEM_ID_REGEX),
  missionId: z.string().regex(MISSION_ID_REGEX),
  semver: z.string(),
  distTreeHash: z.string(),
  behaviorSnapshotHash: z.string(),
  siteContentHash: z.string(),
  platformVersion: z.string(),
  platformSemanticHash: z.string(),
  commitSha: z.string(),
  buildTimestamp: z.string().datetime(),
  targetPlatform: z.string(),
  // --- RFC-0931 signature fields (optional, added during signing phase) ---
  signature: z.string().optional(),
  publicKeyUrl: z.string().optional(),
  signedAt: z.string().datetime().optional(),
});

export type ReleaseArtifactState = z.infer<typeof releaseArtifactStateSchema>;
export type ReleaseState = z.infer<typeof releaseStateSchema>;
export type LegacyReleaseState = z.infer<typeof legacyReleaseStateSchema>;
export type LegacyReleaseDiagnostic = z.infer<typeof legacyReleaseDiagnosticSchema>;
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
export type BuildIdentity = z.infer<typeof buildIdentitySchema>;
export type BehaviorSnapshotDifference = z.infer<typeof behaviorSnapshotDifferenceSchema>;
export type BehaviorSnapshotDiff = z.infer<typeof behaviorSnapshotDiffSchema>;
