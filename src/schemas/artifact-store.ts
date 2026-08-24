/*
<MODULE_CONTRACT>
<purpose>Maintains packages/ontology/src/operations/artifact-store.ts as an authored ontology authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0363: initial artifact manifest schema.</item>
</CHANGE_SUMMARY>
*/

import { z } from "zod";

export const releaseArtifactManifestSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  artifactKind: z.literal("release-dist"),
  systemId: z.string().min(1),
  releaseId: z.string().min(1),
  missionId: z.string().min(1),
  platformVersion: z.string(),
  sternsystemCommitSha: z.string().nullable(),
  createdAt: z.string().datetime(),
  siteContentHash: z.string(),
  distTreeHash: z.string(),
  distArtifactHash: z.string(),
  behaviorSnapshotHash: z.string().nullable(),
  readableSnapshotHash: z.string().nullable(),
  snapshotDiffHash: z.string().nullable(),
  byteSize: z.number().nonnegative(),
  fileCount: z.number().nonnegative(),
});

export const releaseArtifactRefSchema = z.object({
  uri: z.string().min(1),
  provider: z.enum(["local", "r2", "s3"]),
  distArtifactHash: z.string(),
  distTreeHash: z.string(),
  siteContentHash: z.string(),
  byteSize: z.number().nonnegative(),
  fileCount: z.number().nonnegative(),
});

export type ReleaseArtifactManifest = z.infer<typeof releaseArtifactManifestSchema>;
export type ReleaseArtifactRef = z.infer<typeof releaseArtifactRefSchema>;
