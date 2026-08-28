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

export function createArtifactStoreModule(): KernelModule {
  return {
    name: "artifact-store",
    version: "0.1.0",
    register(registry) {
      registry.registerCommand({
        name: "artifact.store.put",
        modulePath: "packages/werkstatt-engine/src/artifact-store/index.ts",
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
        execute: runArtifactStorePut,
      });
      registry.registerCommand({
        name: "artifact.store.get",
        modulePath: "packages/werkstatt-engine/src/artifact-store/index.ts",
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
        execute: runArtifactStoreGet,
      });
      registry.registerCommand({
        name: "artifact.store.validate",
        contract: "artifact",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/artifact-store/index.ts",
        description: "Validate a release artifact in the store (RFC-0363). Flags: --release.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          release: { kind: "string", required: true, description: "Release id to validate." },
        },
        execute: runArtifactStoreValidate,
      });
      registry.registerCommand({
        name: "artifact.store.gc",
        modulePath: "packages/werkstatt-engine/src/artifact-store/index.ts",
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
        execute: runArtifactStoreGc,
      });
    },
  };
}
