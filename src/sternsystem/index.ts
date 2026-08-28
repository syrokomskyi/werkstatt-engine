/*
<MODULE_CONTRACT>
<purpose>RFC-0354: Sternsystem command module — registers all four sternsystem.* commands.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0354: initial sternsystem command module.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";
import { runSternsystemRegister } from "./sternsystem-register.ts";
import { runSternsystemList } from "./sternsystem-list.ts";
import { runSternsystemValidate } from "./sternsystem-validate.ts";
import { runSternsystemPin } from "./sternsystem-pin.ts";
import { runSternsystemExtract } from "./sternsystem-extract.ts";
import { runSternsystemSync } from "./sternsystem-sync.ts";
import { runSternsystemStatus } from "./sternsystem-status.ts";
import { runSternsystemDiscover } from "./sternsystem-discover.ts";

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
  buildPassportPayload,
  signPassport,
  verifyPassport,
  derivePublicKey,
  computePassportHash,
  type SitePassportV1,
  type SignedSitePassport,
} from "./passport.ts";

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

export function createSternsystemModule(): KernelModule {
  return {
    name: "sternsystem",
    version: "0.1.0",
    register(registry) {
      registry.registerCommand({
        name: "sternsystem.register",
        modulePath: "packages/werkstatt-engine/src/sternsystem/index.ts",
        generates: [],
        description:
          "Register a new Sternsystem — creates cache clone directory and system-config.yaml (RFC-0790). Flags: --id, --cosmicStar, --mirrors, [--platform], [--owner], [--amend], [--amend-id].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          cosmicStar: { kind: "string", required: true, description: "Reserved page cosmic star." },
          mirrors: {
            kind: "string",
            required: true,
            description: "Comma-separated mirror paths (first=cache, second=bare, rest=external).",
          },
          platform: { kind: "string", description: "Pinned platform version." },
          owner: {
            kind: "string",
            description:
              "VC subject id (did:web:<domain>#<key-version>) for site owner (RFC-0561).",
          },
        },
        writes: ["../systems-cache/{id}/system-config.yaml"],
        execute: runSternsystemRegister,
      });
      registry.registerCommand({
        name: "sternsystem.list",
        modulePath: "packages/werkstatt-engine/src/sternsystem/index.ts",
        description:
          "List all registered Sternsystems with their id, cosmicStar, pinned platform, status (RFC-0354).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {},
        execute: runSternsystemList,
      });
      registry.registerCommand({
        name: "sternsystem.validate",
        contract: "sternsystem",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/sternsystem/index.ts",
        description:
          "Validate registry invariants, bundle contract, and pin file for one or all Sternsystems (RFC-0354). Flags: --id.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          id: { kind: "string", description: "Optional Sternsystem id to validate." },
        },
        execute: runSternsystemValidate,
      });
      registry.registerCommand({
        name: "sternsystem.pin",
        modulePath: "packages/werkstatt-engine/src/sternsystem/index.ts",
        generates: [],
        description:
          "Write or update system.pin.json for a Sternsystem (RFC-0354). Flags: --id, [--platform].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          platform: { kind: "string", description: "Pinned platform version." },
        },
        writes: [
          "../systems-cache/{id}/system.pin.json",
          "../systems-cache/{id}/system-config.yaml",
        ],
        execute: runSternsystemPin,
      });
      registry.registerCommand({
        name: "sternsystem.extract",
        modulePath: "packages/werkstatt-engine/src/sternsystem/index.ts",
        generates: [],
        description:
          "Extract an apps/<site>/ site into a Sternsystem git repo (RFC-0356, RFC-0574). Flags: --site, [--mirrors].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          site: { kind: "string", required: true, description: "Site id to extract." },
          mirrors: {
            kind: "string",
            description: "Comma-separated mirror paths (first=cache, second=bare, rest=external).",
          },
        },
        writes: ["../systems-cache/{site}/**", "../systems-cache/{site}/system-config.yaml"],
        execute: runSternsystemExtract,
      });
      registry.registerCommand({
        name: "sternsystem.sync",
        modulePath: "packages/werkstatt-engine/src/sternsystem/index.ts",
        generates: [],
        description:
          "Synchronize a Sternsystem's local bare repo with an external mirror (RFC-0472). Flags: --id, [--direction push|pull|both], [--all].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          direction: {
            kind: "string",
            description: "Sync direction: push (default), pull, or both.",
          },
          all: {
            kind: "boolean",
            description: "Sync all branches + tags instead of current branch only.",
          },
        },
        writes: ["../systems-cache/{id}/bordbuch/events.ndjson"],
        execute: runSternsystemSync,
      });
      registry.registerCommand({
        name: "sternsystem.status",
        modulePath: "packages/werkstatt-engine/src/sternsystem/index.ts",
        description:
          "Read-only synchronization state inspection for a Sternsystem (RFC-0477). Flags: --id, [--all].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        flags: {
          id: { kind: "string", description: "Sternsystem id (required unless --all is set)." },
          all: { kind: "boolean", description: "Show status for all registered systems." },
        },
        reads: [
          "../systems-cache/{id}/system-config.yaml",
          "../systems-cache/{id}/bordbuch/events.ndjson",
          "missions/*/mission.yaml",
        ],
        execute: runSternsystemStatus,
      });
      registry.registerCommand({
        name: "sternsystem.discover",
        modulePath: "packages/werkstatt-engine/src/sternsystem/index.ts",
        description:
          "Scan ../systems-cache/ for system-config.yaml files and list all discovered systems (RFC-0790).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        flags: {},
        reads: ["../systems-cache/*/system-config.yaml"],
        execute: runSternsystemDiscover,
      });
    },
  };
}
