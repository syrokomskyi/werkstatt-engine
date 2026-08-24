/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0221/RFC-0479 handoff commands: validate, migrator.registry.validate, pack, and absorb.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel index.ts remains the public API surface.</item>
    <item>Do not add commands that belong in sternsystem, mission, or release sub-modules.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Lazy loading refactor: extracted from index.ts to use dynamic imports inside async register().</item>
  <item>RFC-0479: replaced migrator.validate with migrator.registry.validate.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createHandoffModule(): KernelModule {
  return {
    name: "handoff",
    version: "0.2.0",
    async register(registry) {
      const { runHandoffAbsorb } = await import("./handoff-absorb.ts");
      const { runHandoffPack } = await import("./handoff-pack.ts");
      const { runHandoffValidate } = await import("./handoff-validate.ts");
      const { runMigratorRegistryValidate } = await import("./migrator-registry-validate.ts");
      registry.registerCommand({
        name: "handoff.validate",
        description:
          "Validate an internal site handoff bundle lock, manifest, and file hashes without absorbing it (RFC-0221).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          bundle: { kind: "string", description: "Path to the handoff bundle directory." },
        },
        reads: ["handoff/**/*"],
        execute: runHandoffValidate,
      });
      registry.registerCommand({
        name: "migrator.registry.validate",
        description:
          "Validate the RFC-0479 migrator registry (id uniqueness, ordering, test coverage).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {},
        reads: ["docs/rfcs/**/*.md"],
        execute: runMigratorRegistryValidate,
      });
      registry.registerCommand({
        name: "handoff.pack",
        description:
          "Pack a thin, version-stamped internal handoff bundle: `handoff.pack --site <app>` (RFC-0221).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          site: { kind: "string", required: true, description: "App name to pack." },
        },
        writes: ["../handoff/{site}/**"],
        cacheable: false,
        execute: runHandoffPack,
      });
      registry.registerCommand({
        name: "handoff.absorb",
        description:
          "Ingest a handoff bundle: report (version compare + capability diff), refuse downgrades, then materialize (inject authored + delegate regen). Flags: --report-only, --as <name>, --regen, --force (RFC-0221).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          bundle: { kind: "string", description: "Path to the handoff bundle directory." },
          "report-only": {
            kind: "boolean",
            description: "Only print the catch-up report; do not materialize files.",
          },
          regen: { kind: "boolean", description: "Run delegated regeneration after absorb." },
          as: { kind: "string", description: "Absorb into this target app name." },
        },
        writes: ["apps/{targetApp}/**"],
        cacheable: false,
        execute: runHandoffAbsorb,
      });
    },
  };
}
