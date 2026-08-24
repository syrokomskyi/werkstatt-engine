/*
<MODULE_CONTRACT>
  <purpose>Barrel exports for RFC-0566 deploy command family.</purpose>
  <keywords>deploy, barrel, exports</keywords>
  <responsibilities>
    <item>Re-export all deploy types, handlers, and utilities.</item>
    <item>Export createDeployModule factory.</item>
  </responsibilities>
  <non-goals>
    <item>Do not implement command logic — handlers live in separate files.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy barrel exports.</item>
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
