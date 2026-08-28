/*
<MODULE_CONTRACT>
<purpose>RFC-0354: Sternsystem barrel — re-exports sternsystem command handlers, types, and IO helpers.
Powers the @warpgogol/werkstatt-engine/sternsystem subpath export.</purpose>
<non-goals>
  <item>Does not register commands — command registration lives in sternsystem.module.ts (loaded via sternsystem-module subpath).</item>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0354: initial sternsystem command module.</item>
  <item>RFC-0968: remove dead createSternsystemModule — command registration lives in sternsystem.module.ts.</item>
</CHANGE_SUMMARY>
*/

export { runSternsystemRegister, type SternsystemRegisterData } from "./sternsystem-register.ts";
export { runSternsystemList, type SternsystemListData } from "./sternsystem-list.ts";
export { runSternsystemValidate, type SternsystemValidateData } from "./sternsystem-validate.ts";
export { runSternsystemPin, type SternsystemPinData } from "./sternsystem-pin.ts";
export { runSternsystemExtract, type SternsystemExtractData } from "./sternsystem-extract.ts";
export { runSternsystemSync, type SternsystemSyncData } from "./sternsystem-sync.ts";
export { runSternsystemStatus, type SternsystemStatusData } from "./sternsystem-status.ts";
export { runSternsystemDiscover, type SternsystemDiscoverData } from "./sternsystem-discover.ts";
export {
  runSternsystemPassportGenerate,
  type SternsystemPassportGenerateData,
} from "./sternsystem-passport-generate.ts";
export {
  runSternsystemPassportVerify,
  type SternsystemPassportVerifyData,
} from "./sternsystem-passport-verify.ts";
export {
  runSternsystemHandoverPrepare,
  type SternsystemHandoverPrepareData,
} from "./sternsystem-handover-prepare.ts";
export {
  runSternsystemHandoverComplete,
  type SternsystemHandoverCompleteData,
} from "./sternsystem-handover-complete.ts";
export {
  runSternsystemHandoverCancel,
  type SternsystemHandoverCancelData,
} from "./sternsystem-handover-cancel.ts";
export {
  buildPassportPayload,
  signPassport,
  verifyPassport,
  derivePublicKey,
  computePassportHash,
  type SitePassportV1,
  type SignedSitePassport,
} from "./passport.ts";
export {
  computeAuthorizationHash,
  signAuthorization,
  verifyAuthorization,
  resolveAuthorizationPath,
  readAuthorization,
  writeAuthorization,
  removeAuthorization,
  isAuthorizationExpired,
  type HandoverAuthorizationV1,
  type SignedHandoverAuthorization,
  type HandoverCompleteResult,
  type HandoverEventMetadata,
} from "./handover.ts";

// RFC-0790: Convention-based discovery IO helpers
export {
  resolveCacheClonePath,
  resolveWorkpiecePath,
  readSystemConfig,
  readSystemConfigFromWorkpiece,
  writeSystemConfig,
  readSystemState,
  readSystemStateFromWorkpiece,
  writeSystemState,
  writeSystemStateToWorkpiece,
  readSystemConfigSmart,
  readSystemStateSmart,
  writeSystemStateSmart,
  writeSystemConfigSmart,
  discoverSystems,
  type DiscoveryResult,
  readServicesRegistry,
  findServiceEntry,
  hasAppsCollision,
  type MirrorProtocol,
  inferMirrorProtocol,
  isGitAccessible,
  resolveMirrorPath,
  type MirrorResolution,
  resolveMirrors,
  readPassport,
  writePassport,
  resolvePassportPath,
} from "./registry-io.ts";
