/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0357 release discipline commands: prepare, ready, validate, list, and rollback.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel release/index.ts remains the public API surface.</item>
    <item>Do not register artifact-store or leitstand commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
  <item>RFC-1173: declare mutatesState on all kernel commands — collectDeclarationDiagnostics emits error-severity MUTATES-STATE-DECLARED, command.manifest.validate is the blocking consumer in packages.check, sweep declares the flag on every command definition (factories hardcode false for read-only check specs)</item>
  <item>RFC-1173: fixup: flip mutatesState to true on 19 commands that declare writes/generates — the codemod's name-suffix rules misclassified leitstand.dev-deploy, leitstand.certify, coverage.report and peers as read-only; declared writes imply mutation</item>
  <item>RFC-1231: step 1 — rename supportsAllSites to acceptsAllFlag

Mechanical sweep: the field only ever gated --all argv acceptance; fan-out
follows the parsed selector. Guard renamed assertAllSitesAllowed ->
assertAllFlagAccepted, message updated. 417 declaration sites + type
surfaces (KernelCommandMetadata, ForgeCommandMetadata) in one atomic pass.</item>
  <item>RFC-1248: VITE-CLIENT-DEP-02 lazy-import gate + SCAN-02 validator reads-root existence check (RFC-1248)</item>
  <history>RFC-0655, RFC-0656, RFC-0931, RFC-1097</history>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createReleaseModule(): Promise<ModuleExport> {
  const {
    runReleasePrepare,
    runReleaseReady,
    runReleaseValidate,
    runReleaseList,
    runReleaseStateValidate,
    runDistDeterminismValidate,
    runReleaseSign,
  } = await import("./release-commands.ts");
  const { runBootSmokeCommand } = await import("./boot-smoke.ts");
  return {
    name: "release",
    version: "0.1.0",
    declarations: [],
    commands: [
      {
        name: "release.prepare",
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
        generates: [],
        description:
          "Prepare a release candidate from a validated mission (RFC-0357). Flags: --mission, [--semver].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id to release." },
          semver: { kind: "string", default: "0.1.0", description: "Release semantic version." },
        },
        writes: ["releases/{release}/**"],
        reads: ["missions/{mission}/**", "../systems-cache/{system}/system-config.yaml"],
        cacheable: false,
        execute: runReleasePrepare,
      },
      {
        name: "release.ready",
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
        generates: [],
        description:
          "Mark a prepared release as ready with discipline gates and artifact storage (RFC-0357, RFC-0724). Flags: --release.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          release: { kind: "string", required: true, description: "Release id to mark ready." },
        },
        writes: [
          "releases/{release}/release.yaml",
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/bordbuch/events.ndjson",
        ],
        reads: [
          "releases/{release}/**",
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runReleaseReady,
      },
      {
        name: "release.validate",
        mutatesState: false,
        contract: "release",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
        description: "Validate a release artifact (RFC-0357). Flags: --release.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          release: { kind: "string", required: true, description: "Release id to validate." },
        },
        reads: ["releases/{release}/**"],
        execute: runReleaseValidate,
      },
      {
        name: "release.list",
        mutatesState: false,
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
        description: "List releases, optionally filtered by site (RFC-0357). Flags: [--site].",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          site: { kind: "string", description: "Filter by Sternsystem id." },
        },
        reads: ["releases/*/release.yaml", "../systems-cache/*/system-config.yaml"],
        execute: runReleaseList,
      },
      {
        name: "release.state.validate",
        mutatesState: false,
        contract: "release",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
        description:
          "Validate release pipeline consistency between mission.yaml, close-report.json, release.yaml, bordbuch, and registry.yaml (RFC-0655). Flags: --mission, --release, --site.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          mission: { kind: "string", description: "Mission id to validate." },
          release: { kind: "string", description: "Release id to validate." },
          site: {
            kind: "string",
            description: "Site id — validates all releases for the system.",
          },
        },
        reads: [
          "missions/{mission}/mission.yaml", // scan-coverage: transient workpiece root — missions/ is gitignored, absent on clean checkouts
          "missions/{mission}/evidence/close-report.json", // scan-coverage: transient workpiece root — missions/ is gitignored, absent on clean checkouts
          "releases/{release}/release.yaml",
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/bordbuch/events.ndjson",
        ],
        execute: runReleaseStateValidate,
      },
      {
        name: "dist.determinism.validate",
        contract: "dist",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
        description:
          "Report non-deterministic files in a dist directory by comparing stable vs byte hashes (RFC-0656). Flags: --release, --mission.",
        scope: "workspace",
        acceptsAllFlag: false,
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
          "missions/{mission}/workpiece/dist/**", // scan-coverage: transient workpiece root — missions/ is gitignored, absent on clean checkouts
          "missions/{mission}/distribution/dist/**", // scan-coverage: transient workpiece root — missions/ is gitignored, absent on clean checkouts
        ],
        execute: runDistDeterminismValidate,
      },
      {
        name: "release.sign",
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
        generates: [],
        description:
          "Sign build-identity.json and produce signed-manifest.json for a release using Ed25519 (RFC-0931). Flags: --release.",
        scope: "workspace",
        acceptsAllFlag: false,
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
      },
      {
        name: "release.boot-smoke",
        modulePath: "packages/werkstatt-engine/src/release/release.module.ts",
        generates: [],
        description:
          "Boot built worker in miniflare/workerd and execute representative requests to catch runtime crashes before deploy (RFC-0961, RFC-0979). Flags: --site, [--dist], [--wrangler-config], [--languages], [--diagnose].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
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
      },
    ],
    pipelines: [],
  };
}
