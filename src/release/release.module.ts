/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0357 release discipline commands: prepare, ready, validate, list, and rollback.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel release/index.ts remains the public API surface.</item>
    <item>Do not register artifact-store or leitstand commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Lazy loading refactor: extracted from release/index.ts to use dynamic imports inside async register().</item>
  <item>RFC-0655: add release.state.validate command for release pipeline consistency checks.</item>
  <item>RFC-0656: add dist.determinism.validate command for non-deterministic build artifact detection.</item>
  <item>RFC-0931: add release.sign command for Ed25519 signing of build-identity.json and signed-manifest.json.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createReleaseModule(): KernelModule {
  return {
    name: "release",
    version: "0.1.0",
    async register(registry) {
      const {
        runReleasePrepare,
        runReleaseReady,
        runReleaseValidate,
        runReleaseList,
        runReleaseStateValidate,
        runDistDeterminismValidate,
        runReleaseSign,
      } = await import("./release-commands.ts");
      registry.registerCommand({
        name: "release.prepare",
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
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
        reads: ["missions/{mission}/**", "systems-cache/{system}/system-config.yaml"],
        cacheable: false,
        execute: runReleasePrepare,
      });
      registry.registerCommand({
        name: "release.ready",
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
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
        reads: [
          "releases/{release}/**",
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runReleaseReady,
      });
      registry.registerCommand({
        name: "release.validate",
        contract: "release",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
        description: "Validate a release artifact (RFC-0357). Flags: --release.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          release: { kind: "string", required: true, description: "Release id to validate." },
        },
        reads: ["releases/{release}/**"],
        execute: runReleaseValidate,
      });
      registry.registerCommand({
        name: "release.list",
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
        description: "List releases, optionally filtered by site (RFC-0357). Flags: [--site].",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          site: { kind: "string", description: "Filter by Sternsystem id." },
        },
        reads: ["releases/*/release.yaml", "systems-cache/*/system-config.yaml"],
        execute: runReleaseList,
      });
      registry.registerCommand({
        name: "release.state.validate",
        contract: "release",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
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
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
          "systems-cache/{system}/bordbuch/events.ndjson",
        ],
        execute: runReleaseStateValidate,
      });
      registry.registerCommand({
        name: "dist.determinism.validate",
        contract: "dist",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
        description:
          "Report non-deterministic files in a dist directory by comparing stable vs byte hashes (RFC-0656). Flags: --release, --mission.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        flags: {
          release: { kind: "string", description: "Release id whose dist to validate." },
          mission: {
            kind: "string",
            description: "Mission id whose workpiece/dist or distribution/dist to validate.",
          },
        },
        reads: [
          "releases/{release}/dist/**",
          "missions/{mission}/workpiece/dist/**",
          "missions/{mission}/distribution/dist/**",
        ],
        execute: runDistDeterminismValidate,
      });
      registry.registerCommand({
        name: "release.sign",
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
        generates: [],
        description:
          "Sign build-identity.json and produce signed-manifest.json for a release using Ed25519 (RFC-0931). Flags: --release.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          release: { kind: "string", required: true, description: "Release id to sign." },
        },
        writes: [
          "releases/{release}/dist/client/.well-known/build-identity.json",
          "releases/{release}/dist/client/.well-known/release-pubkey.json",
          "releases/{release}/.integrity/build/latest/signed-manifest.json",
        ],
        reads: ["releases/{release}/dist/**", "releases/{release}/.integrity/**"],
        cacheable: false,
        execute: runReleaseSign,
      });
      const { runBootSmokeCommand } = await import("./boot-smoke.ts");
      registry.registerCommand({
        name: "release.boot-smoke",
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
        generates: [],
        description:
          "Boot built worker in miniflare/workerd and execute representative requests to catch runtime crashes before deploy (RFC-0961, RFC-0979). Flags: --site, [--dist], [--wrangler-config], [--languages], [--diagnose].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        flags: {
          site: { kind: "string", required: true, description: "Sternsystem id." },
          dist: {
            kind: "string",
            description: "Path to dist directory (defaults to workpiece or release dist).",
          },
          "wrangler-config": {
            kind: "string",
            description:
              "Path to wrangler config. Defaults to dist/server/wrangler.json, falling back to dist/../wrangler.jsonc.",
          },
          languages: {
            kind: "string",
            description:
              "Comma-separated language codes. If omitted, auto-detected from dist/client/ per RFC-0978.",
          },
          diagnose: {
            kind: "boolean",
            default: false,
            description: "Print resolved binding map and planned requests for debugging.",
          },
        },
        writes: ["boot-smoke.json"],
        reads: ["dist/**"],
        execute: runBootSmokeCommand,
      });
    },
  };
}
