/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/release/index.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0357: initial release module.</item>
  <item>RFC-0655: add release.state.validate command for release pipeline consistency checks.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";
import {
  runReleasePrepare,
  runReleaseReady,
  runReleaseValidate,
  runReleaseList,
  runReleaseStateValidate,
} from "./release-commands.ts";

export {
  runReleasePrepare,
  type ReleasePrepareData,
  runReleaseReady,
  type ReleaseReadyData,
  runReleaseValidate,
  type ReleaseValidateData,
  runReleaseList,
  type ReleaseListData,
  runReleaseStateValidate,
  type ReleaseStateValidateData,
  type ReleaseStateCheck,
} from "./release-commands.ts";
export {
  runBootSmokeCommand,
  type BootSmokeCommandData,
  runBootSmoke,
  type BootSmokeResult,
  type BootSmokeRequestSpec,
  type BootSmokeRequestResult,
  planBootSmokeRequests,
  detectBootSmokeLanguages,
  resolveWranglerConfig,
  resolveLanguages,
  type WranglerResolution,
  simulateBindings,
} from "./boot-smoke.ts";

