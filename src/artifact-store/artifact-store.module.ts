/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0363 artifact store commands: put, get, validate, and gc for content-addressed release artifacts.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel artifact-store/index.ts remains the public API surface.</item>
    <item>Do not register release or leitstand commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "../runtime/desired-state.ts";

export async function createArtifactStoreModule(): Promise<ModuleExport> {
  const {
        runArtifactStorePut,
        runArtifactStoreGet,
        runArtifactStoreValidate,
        runArtifactStoreGc,
      } = await import("./artifact-store-commands.ts");
  return {
    name: "artifact-store",
    version: "0.1.0",
      declarations: [],
  commands: [
    {
        name: "artifact.store.put",
        modulePath: "packages/werkstatt-engine/src/artifact-store/artifact-store.module.ts",
        generates: [],
        description:
          "Store a release dist artifact in the content-addressed artifact store (RFC-0363). Flags: --release, --dist, [--site].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          release: { kind: "string", required: true, description: "Release id to store." },
          dist: { kind: "string", required: true, description: "Distribution directory to store." },
          site: { kind: "string", description: "Optional site id for artifact metadata." },
        },
        writes: [".werkstatt/artifacts/releases/{release}/**"],
        reads: ["releases/{release}/**"],
        cacheable: false,
        execute: runArtifactStorePut,
      },
    {
        name: "artifact.store.get",
        modulePath: "packages/werkstatt-engine/src/artifact-store/artifact-store.module.ts",
        generates: [],
        description:
          "Rehydrate a release dist artifact from the store (RFC-0363). Flags: --release, --output.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          release: { kind: "string", required: true, description: "Release id to rehydrate." },
          output: { kind: "string", required: true, description: "Output directory to write." },
        },
        writes: ["{--output}/**"],
        reads: [".werkstatt/artifacts/releases/{release}/**"],
        cacheable: false,
        execute: runArtifactStoreGet,
      },
    {
        name: "artifact.store.validate",
        contract: "artifact",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/artifact-store/artifact-store.module.ts",
        description: "Validate a release artifact in the store (RFC-0363). Flags: --release.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          release: { kind: "string", required: true, description: "Release id to validate." },
        },
        reads: [".werkstatt/artifacts/releases/{release}/**"],
        execute: runArtifactStoreValidate,
      },
    {
        name: "artifact.store.gc",
        modulePath: "packages/werkstatt-engine/src/artifact-store/artifact-store.module.ts",
        generates: [],
        description:
          "Garbage-collect unreferenced release artifacts per retention policy (RFC-0363). Flags: [--system], [--dry-run].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          system: { kind: "string", description: "Only collect artifacts for this system." },
        },
        writes: [".werkstatt/artifacts/releases/**"],
        reads: [".werkstatt/artifacts/releases/**", "releases/*/release.yaml"],
        cacheable: false,
        execute: runArtifactStoreGc,
      }
  ],
  pipelines: [

  ]};
}
