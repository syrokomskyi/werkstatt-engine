/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0363 artifact store commands: put, get, validate, and gc for content-addressed release artifacts.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel artifact-store/index.ts remains the public API surface.</item>
    <item>Do not register release or leitstand commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Lazy loading refactor: extracted from artifact-store/index.ts to use dynamic imports inside async register().</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createArtifactStoreModule(): KernelModule {
  return {
    name: "artifact-store",
    version: "0.1.0",
    async register(registry) {
      const {
        runArtifactStorePut,
        runArtifactStoreGet,
        runArtifactStoreValidate,
        runArtifactStoreGc,
      } = await import("./artifact-store-commands.ts");
      registry.registerCommand({
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
      });
      registry.registerCommand({
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
      });
      registry.registerCommand({
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
      });
      registry.registerCommand({
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
      });
    },
  };
}
