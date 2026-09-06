/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-handoff/src/artifact-store/index.ts as an authored site-kernel-handoff authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0363: initial artifact store module.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";
import {
  runArtifactStorePut,
  runArtifactStoreGet,
  runArtifactStoreValidate,
  runArtifactStoreGc,
} from "./artifact-store-commands.ts";

export {
  runArtifactStorePut,
  type ArtifactStorePutData,
  storeArtifactCore,
  type StoreArtifactCoreResult,
  runArtifactStoreGet,
  type ArtifactStoreGetData,
  runArtifactStoreValidate,
  type ArtifactStoreValidateData,
  runArtifactStoreGc,
  type ArtifactStoreGcData,
  artifactStorePreflight,
  type ArtifactPreflightResult,
  artifactStoreRehydrate,
} from "./artifact-store-commands.ts";

