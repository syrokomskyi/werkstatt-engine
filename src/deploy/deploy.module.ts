/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0566 deploy commands: artifact.build, artifact.verify, atomic.swap, atomic.rollback, artifact.gc, status.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel deploy/index.ts remains the public API surface.</item>
    <item>Do not register leitstand or artifact-store commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0566: initial deploy module registering 6 commands.</item>
  <item>RFC-1173: declare mutatesState on all kernel commands — collectDeclarationDiagnostics emits error-severity MUTATES-STATE-DECLARED, command.manifest.validate is the blocking consumer in packages.check, sweep declares the flag on every command definition (factories hardcode false for read-only check specs)</item>
  <item>RFC-1231: step 1 — rename supportsAllSites to acceptsAllFlag

Mechanical sweep: the field only ever gated --all argv acceptance; fan-out
follows the parsed selector. Guard renamed assertAllSitesAllowed ->
assertAllFlagAccepted, message updated. 417 declaration sites + type
surfaces (KernelCommandMetadata, ForgeCommandMetadata) in one atomic pass.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createDeployModule(): Promise<ModuleExport> {
  const {
    runDeployArtifactBuild,
    runDeployArtifactVerify,
    runDeployAtomicSwap,
    runDeployAtomicRollback,
    runDeployArtifactGc,
    runDeployStatus,
  } = await import("./index.ts");
  return {
    name: "deploy",
    version: "0.1.0",
    declarations: [],
    commands: [
      {
        name: "deploy.artifact.build",
        modulePath: "packages/werkstatt-engine/src/deploy/deploy.module.ts",
        generates: [],
        description:
          "Build an immutable platform artifact from the local git clone (RFC-0566). Flags: [--skip-build], [--skip-sign].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          "skip-build": {
            kind: "boolean",
            description: "Skip turbo run build (use existing dist/ trees).",
          },
          "skip-sign": {
            kind: "boolean",
            description: "Skip Ed25519 manifest signing.",
          },
        },
        writes: [".werkstatt/artifacts/platform/**"],
        reads: ["packages/*/dist/**", "packages/*/package.json"],
        cacheable: false,
        execute: runDeployArtifactBuild,
      },
      {
        name: "deploy.artifact.verify",
        mutatesState: false,
        modulePath: "packages/werkstatt-engine/src/deploy/deploy.module.ts",
        description: "Verify an artifact's content hash and signature (RFC-0566). Flags: --hash.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          hash: { kind: "string", required: true, description: "Artifact SHA-256 hash." },
        },
        reads: [".werkstatt/artifacts/platform/{hash}/**"],
        cacheable: false,
        execute: runDeployArtifactVerify,
      },
      {
        name: "deploy.atomic.swap",
        modulePath: "packages/werkstatt-engine/src/deploy/deploy.module.ts",
        generates: [],
        description: "Atomic symlink swap to deploy a new artifact (RFC-0566). Flags: --hash.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          hash: { kind: "string", required: true, description: "Artifact SHA-256 hash to deploy." },
        },
        writes: [".werkstatt/artifacts/platform/current", ".werkstatt/artifacts/platform/previous"],
        reads: [".werkstatt/artifacts/platform/{hash}/**"],
        cacheable: false,
        execute: runDeployAtomicSwap,
      },
      {
        name: "deploy.atomic.rollback",
        modulePath: "packages/werkstatt-engine/src/deploy/deploy.module.ts",
        generates: [],
        description:
          "Atomic rollback to the previous artifact via symlink swap (RFC-0566). No flags.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {},
        writes: [".werkstatt/artifacts/platform/current"],
        reads: [
          ".werkstatt/artifacts/platform/previous",
          ".werkstatt/artifacts/platform/{hash}/**",
        ],
        cacheable: false,
        execute: runDeployAtomicRollback,
      },
      {
        name: "deploy.artifact.gc",
        coverage: "operator",
        coverageNote: "deploy artifact housekeeping",
        modulePath: "packages/werkstatt-engine/src/deploy/deploy.module.ts",
        generates: [],
        description:
          "Garbage-collect unreferenced platform artifacts (RFC-0566). Flags: [--dry-run], [--retain N].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          "dry-run": { kind: "boolean", description: "Report candidates without deleting." },
          retain: { kind: "string", description: "Retention count (default: 5)." },
        },
        writes: [".werkstatt/artifacts/platform/**"],
        reads: [".werkstatt/artifacts/platform/**"],
        cacheable: false,
        execute: runDeployArtifactGc,
      },
      {
        name: "deploy.status",
        mutatesState: false,
        execOnReadOnly: true,
        modulePath: "packages/werkstatt-engine/src/deploy/deploy.module.ts",
        description:
          "Report current and previous platform artifact hashes, git SHA, and deployment time (RFC-0566).",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {},
        reads: [
          ".werkstatt/artifacts/platform/current",
          ".werkstatt/artifacts/platform/previous",
          ".werkstatt/artifacts/platform/{hash}/manifest.json",
        ],
        cacheable: false,
        execute: runDeployStatus,
      },
    ],
    pipelines: [],
  };
}
