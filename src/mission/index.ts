/*
<MODULE_CONTRACT>
<purpose>RFC-0355: Mission module barrel — re-exports handler functions and types. Command registration lives in mission.module.ts (ADR-0041).</purpose>
<non-goals>
  <item>Do not register commands or declare flag schemas here — use mission.module.ts (ADR-0041).</item>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>ADR-0041: removed duplicate command registrations; mission.module.ts is the single source of truth for flag schemas. This file is now a pure re-export barrel.</item>
  <item>RFC-1256: a11y.contrast.lint + mission.deploy-preflight — early deploy-blocker detection</item>
  <item>RFC-1260</item>
  <item>RFC-1263</item>
  <item>RFC-1264</item>
  <history>RFC-0355</history>
</CHANGE_SUMMARY>
*/

export { runMissionOpen, type MissionOpenData } from "./mission-open.ts";
export { runMissionStatus, type MissionStatusData } from "./mission-status.ts";
export { runMissionClose, type MissionCloseData } from "./mission-close.ts";
export { runMissionAbort, type MissionAbortData } from "./mission-abort.ts";
export { runMissionList, type MissionListData } from "./mission-list.ts";
export {
  runMissionMaterialize,
  type MissionMaterializeData,
  runMissionMaterializeInternal,
  type MissionMaterializeInternalOptions,
} from "./mission-materialize.ts";
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
  VALIDATOR_MAPPINGS,
  selectValidators,
  type ValidatorMapping,
} from "./mission-git-commit.ts";
export { runMissionCleanup, type MissionCleanupData } from "./mission-cleanup.ts";
export {
  runMissionContentEdit,
  type ContentEditResult,
  type ContentEditGate,
} from "./mission-content-edit.ts";
export { missionHasGreenCoverage } from "./lifecycle-precondition.ts";
export {
  evaluateContentEditEligibility,
  type EligibilityResult,
  type ContentEditOpRef,
} from "./content-edit-eligibility.ts";
export {
  runValidatePostbuild,
  type ValidatePostbuildData,
  type ValidatePostbuildStepResult,
} from "./validate-postbuild.ts";
export { resolveActorFromEnv, resolveActor, type ActorIdentity } from "./actor-identity.ts";
export { createSignedCommit, type SignedCommitResult } from "./signed-commit.ts";
export {
  resolveMissionEvidenceDir,
  resolveMissionDir,
  readMissionManifest,
  writeMissionManifest,
} from "./mission-io.ts";
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
export { runMissionResume, type MissionResumeData } from "./mission-resume.ts";
export { runMissionJournalShow, type MissionJournalShowData } from "./mission-journal-show.ts";
export {
  runMissionPreflight,
  type MissionPreflightInput,
  type PreflightCheckResult,
  type MissionPreflightData,
} from "./mission-preflight.ts";
export {
  runMissionDeployPreflight,
  DEPLOY_PREFLIGHT_CHECKS,
  type DeployPreflightStepResult,
  type MissionDeployPreflightData,
} from "./mission-deploy-preflight.ts";
export {
  type ValidationState,
  type ValidatorState,
  resolveValidationStatePath,
  readValidationState,
  writeValidationState,
  buildValidatorStatesFromSteps,
} from "./validation-state.ts";
export {
  runValidationStateInspect,
  type ValidationStateInspectData,
} from "./validation-state-inspect.ts";
