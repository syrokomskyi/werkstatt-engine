/*
<MODULE_CONTRACT>
<purpose>RFC-0355: Mission module barrel — re-exports handler functions and types. Command registration lives in mission.module.ts (ADR-0041).</purpose>
<non-goals>
  <item>Do not register commands or declare flag schemas here — use mission.module.ts (ADR-0041).</item>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0355: initial mission command module.</item>
  <item>ADR-0041: removed duplicate command registrations; mission.module.ts is the single source of truth for flag schemas. This file is now a pure re-export barrel.</item>
</CHANGE_SUMMARY>
*/

export { runMissionOpen, type MissionOpenData } from "./mission-open.ts";
export { runMissionStatus, type MissionStatusData } from "./mission-status.ts";
export { runMissionClose, type MissionCloseData } from "./mission-close.ts";
export { runMissionAbort, type MissionAbortData } from "./mission-abort.ts";
export { runMissionList, type MissionListData } from "./mission-list.ts";
export { runMissionMaterialize, type MissionMaterializeData } from "./mission-materialize.ts";
export {
  runMissionValidate,
  type MissionValidateData,
  runMissionBuild,
  type MissionBuildData,
  runMissionDiff,
  type MissionDiffData,
  runMissionReconcile,
  type MissionReconcileData,
} from "./mission-materialization-commands.ts";
export { runMissionPreview, type MissionPreviewData } from "./mission-preview.ts";
export {
  runMissionGitCommit,
  type MissionGitCommitData,
  isWorkpieceDirty,
  type WorkpieceDirtyResult,
  investigateUntrackedFiles,
  type UntrackedFileReport,
  cacheCloneCommit,
} from "./mission-git-commit.ts";
export { runMissionCleanup, type MissionCleanupData } from "./mission-cleanup.ts";
export {
  runValidatePostbuild,
  type ValidatePostbuildData,
  type ValidatePostbuildStepResult,
} from "./validate-postbuild.ts";
export { resolveActorFromEnv, resolveActor, type ActorIdentity } from "./actor-identity.ts";
export { createSignedCommit, type SignedCommitResult } from "./signed-commit.ts";
export { resolveMissionEvidenceDir, resolveMissionDir } from "./mission-io.ts";
export {
  persistEnvFilesToCacheClone,
  restoreEnvFilesFromCacheClone,
  collectEnvFiles,
  type EnvPersistResult,
} from "./env-persist.ts";
export {
  OPERATOR_CONFIG_FILES,
  persistOperatorConfigFiles,
  restoreOperatorConfigFiles,
  type OperatorConfigPersistResult,
} from "./operator-config-files.ts";
export { runMaterializeConfigValidate } from "./materialize-config-validate.ts";
export {
  runWorkpieceConfigPresenceCheck,
  type WorkpieceConfigPresenceResult,
} from "./workpiece-config-presence-check.ts";
