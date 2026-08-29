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

export function createReleaseModule(): KernelModule {
  return {
    name: "release",
    version: "0.1.0",
    register(registry) {
      registry.registerCommand({
        name: "release.prepare",
        modulePath: "packages/werkstatt-engine/src/release/index.ts",
        generates: [],
        description:
          "Prepare a release candidate from a validated mission (RFC-0357). Flags: --mission, [--semver].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id to release." },
          semver: { kind: "string", default: "0.1.0", description: "Release semantic version." },
        },
        writes: ["releases/{release}/**"],
        execute: runReleasePrepare,
      });
      registry.registerCommand({
        name: "release.ready",
        modulePath: "packages/werkstatt-engine/src/release/index.ts",
        generates: [],
        description:
          "Mark a prepared release as ready with discipline gates and artifact storage (RFC-0357, RFC-0724). Flags: --release.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          release: { kind: "string", required: true, description: "Release id to mark ready." },
        },
        writes: [
          "releases/{release}/release.yaml",
          "systems-cache/{system}/system-state.yaml",
          "systems-cache/{system}/bordbuch/events.ndjson",
        ],
        execute: runReleaseReady,
      });
      registry.registerCommand({
        name: "release.validate",
        contract: "release",
        rules: ["CERT-LEGACY-STATE-01"],
        modulePath: "packages/werkstatt-engine/src/release/index.ts",
        description: "Validate a release artifact (RFC-0357). Flags: --release.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          release: { kind: "string", required: true, description: "Release id to validate." },
        },
        execute: runReleaseValidate,
      });
      registry.registerCommand({
        name: "release.list",
        modulePath: "packages/werkstatt-engine/src/release/index.ts",
        description: "List releases, optionally filtered by site (RFC-0357). Flags: [--site].",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          site: { kind: "string", description: "Filter by Sternsystem id." },
        },
        execute: runReleaseList,
      });
      registry.registerCommand({
        name: "release.state.validate",
        contract: "release",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/release/index.ts",
        description:
          "Validate release pipeline consistency between mission.yaml, close-report.json, release.yaml, bordbuch, and registry.yaml (RFC-0655). Flags: --mission, --release, --site.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          mission: { kind: "string", description: "Mission id to validate." },
          release: { kind: "string", description: "Release id to validate." },
          site: {
            kind: "string",
            description: "Site id — validates all releases for the system.",
          },
        },
        reads: [
          "missions/{mission}/mission.yaml",
          "missions/{mission}/evidence/close-report.json",
          "releases/{release}/release.yaml",
          "systems-cache/{system}/system-state.yaml",
          "systems-cache/{system}/bordbuch/events.ndjson",
        ],
        execute: runReleaseStateValidate,
      });
    },
  };
}
