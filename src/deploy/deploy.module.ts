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
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../runtime/desired-state.ts";

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
        supportsAllSites: false,
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
        modulePath: "packages/werkstatt-engine/src/deploy/deploy.module.ts",
        description: "Verify an artifact's content hash and signature (RFC-0566). Flags: --hash.",
        scope: "workspace",
        supportsAllSites: false,
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
        supportsAllSites: false,
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
        supportsAllSites: false,
        mutatesState: true,
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
        modulePath: "packages/werkstatt-engine/src/deploy/deploy.module.ts",
        generates: [],
        description:
          "Garbage-collect unreferenced platform artifacts (RFC-0566). Flags: [--dry-run], [--retain N].",
        scope: "workspace",
        supportsAllSites: false,
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
        modulePath: "packages/werkstatt-engine/src/deploy/deploy.module.ts",
        description:
          "Report current and previous platform artifact hashes, git SHA, and deployment time (RFC-0566).",
        scope: "workspace",
        supportsAllSites: false,
        reads: [
          ".werkstatt/artifacts/platform/current",
          ".werkstatt/artifacts/platform/previous",
          ".werkstatt/artifacts/platform/{hash}/manifest.json",
        ],
        cacheable: false,
        execute: runDeployStatus,
      }
  ],
  pipelines: [

  ]};
}
