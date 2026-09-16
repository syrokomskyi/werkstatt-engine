/*
<MODULE_CONTRACT>
  <purpose>Barrel exports for RFC-0566 deploy command family.</purpose>


  <non-goals>
    <item>Do not implement command logic — handlers live in separate files.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy barrel exports.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

export type {
  PlatformArtifact,
  ArtifactManifest,
  ArtifactFile,
  DeployStatus,
  WorkshopDeployStatus,
  AtomicSwapResult,
  TwoPhaseCommitResult,
  ArtifactGcResult,
  ArtifactVerifyResult,
  ArtifactBuildResult,
} from "./types.ts";

export { runDeployArtifactBuild } from "./artifact-build.ts";
export { runDeployArtifactVerify } from "./artifact-verify.ts";
export { runDeployAtomicSwap } from "./atomic-swap.ts";
export { runDeployAtomicRollback } from "./atomic-rollback.ts";
export { runDeployArtifactGc } from "./artifact-gc.ts";
export { runDeployStatus } from "./deploy-status.ts";

export {
  PLATFORM_ARTIFACTS_DIR,
  CURRENT_SYMLINK,
  PREVIOUS_SYMLINK,
  platformArtifactsBase,
  artifactDir,
  currentSymlinkPath,
  previousSymlinkPath,
  manifestPath,
  distPath,
  hashArtifactDir,
  readManifest,
  writeManifest,
  readSymlinkTarget,
  readSymlinkBasename,
  atomicSymlinkSwap,
  listArtifactHashes,
} from "./deploy-utils.ts";

export { createDeployModule } from "./deploy.module.ts";
