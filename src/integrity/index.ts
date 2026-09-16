/*
<MODULE_CONTRACT>
<purpose>Centralizes integrity management functionalities, enabling robust operations for verifying and signing artifacts within the site kernel.</purpose>
<non-goals>
  <item>Do not handle raw content parsing or validation beyond integrity checks.</item>
  <item>Do not orchestrate transport or configuration for external dependencies.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

export type {
  IntegrityStatus,
  IntegrityPolicy,
  ManifestFileRecord,
  DirectoryManifest,
  MoveRecord,
  RegistryEntity,
  EntitiesById,
  PathsCurrent,
  DeletedLogItem,
  OutputsFile,
  BuildProvenance,
  SignablePayload,
  SignedManifest,
  GitFileHistory,
  ChangedPaths,
  MoveCandidate,
  VerifyIssue,
  VerifyStats,
  VerifyReport,
} from "./types.ts";

export { runInit } from "./run-init.ts";
export { runUpdate } from "./run-update.ts";
export { runVerify } from "./run-verify.ts";
export { runRecordBuild } from "./run-record-build.ts";
export { runBackfillRevisions } from "./run-backfill-revisions.ts";

export {
  generateSigningKeyPairPemAsync,
  signJsonPayloadAsync,
  signLatestBuildArtifacts,
  signBuildIdentity,
  writeReleasePublicKey,
  verifyBuildIdentitySignature,
  loadSignedManifest,
  loadPublicKeyPem,
  verifyManifestSignature,
  verifyJsonSignatureAsync,
  compareManifestWithLocalArtifacts,
  requireEnv,
  optionalEnv,
} from "./signing.ts";

export { buildLatestDir, signedManifestPath } from "./paths.ts";
export { ensureDir, writeText } from "./fs.ts";

export {
  runIntegrityInit,
  runIntegrityUpdate,
  runIntegrityVerify,
  runIntegrityBuildRecord,
  runIntegritySign,
  runIntegrityVerifyRelease,
  runIntegrityGenerateSigningKeypair,
  runIntegrityBackfillRevisions,
} from "./integrity-commands.ts";

export { STANDARD_INTEGRITY_PIPELINE } from "./module.ts";

export { getRevisionByPath, type RevisionByPathResult } from "./compass-audit-helpers.ts";
