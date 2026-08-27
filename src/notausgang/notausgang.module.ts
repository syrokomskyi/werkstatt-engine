/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0359/0380 Notausgang emergency export commands: export and validate, producing self-contained site packages with nulled integrations.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel notausgang/index.ts remains the public API surface.</item>
    <item>Do not register leitstand or release commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Lazy loading refactor: extracted from notausgang/index.ts to use dynamic imports inside async register().</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createNotausgangModule(): KernelModule {
  return {
    name: "notausgang",
    version: "0.1.0",
    async register(registry) {
      const { runNotausgangExport, runNotausgangValidate } =
        await import("./notausgang-commands.ts");
      registry.registerCommand({
        name: "notausgang.export",
        modulePath: "packages/werkstatt-engine/src/notausgang/notausgang.module.ts",
        generates: [],
        description:
          "Export a full site package with dist artifacts, history, and nulled integrations (RFC-0359, RFC-0380). Writes YAML manifests and uses @warpgogol/fingerprint for hashing. Flags: --system, --release, --output, [--keep-integration, --reason].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          system: { kind: "string", required: true, description: "Sternsystem id." },
          release: { kind: "string", required: true, description: "Release id to export." },
          output: { kind: "string", required: true, description: "Export output directory." },
          "keep-integration": {
            kind: "string[]",
            description: "Integration names to keep rather than null.",
          },
          reason: {
            kind: "string[]",
            description: "Reasons paired with kept integrations.",
          },
        },
        writes: ["{--output}/**"],
        reads: [
          "releases/{release}/**",
          "systems-cache/{system}/**",
          "systems-cache/{system}/system-config.yaml",
        ],
        cacheable: false,
        execute: runNotausgangExport,
      });
      registry.registerCommand({
        name: "notausgang.validate",
        modulePath: "packages/werkstatt-engine/src/notausgang/notausgang.module.ts",
        description:
          "Deep integrity verification of a Notausgang export package (RFC-0359, RFC-0380). Re-computes hashes, validates manifest schema, Bordbuch NDJSON, pin content, behavior snapshots, and scans for secrets. Flags: --path.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          path: { kind: "string", required: true, description: "Export package path." },
        },
        reads: ["{--path}/**"],
        execute: runNotausgangValidate,
      });
    },
  };
}
