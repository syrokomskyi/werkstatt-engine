/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0354/0480 Sternsystem commands: register, list, validate, pin, extract, sync, status, and surface.contract.validate.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel sternsystem/index.ts remains the public API surface.</item>
    <item>Do not register mission, release, or deployment commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Lazy loading refactor: extracted from sternsystem/index.ts to use dynamic imports inside async register().</item>
  <item>RFC-0477: add sternsystem.status command registration.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createSternsystemModule(): KernelModule {
  return {
    name: "sternsystem",
    version: "0.1.0",
    async register(registry) {
      const { runSternsystemRegister } = await import("./sternsystem-register.ts");
      const { runSternsystemList } = await import("./sternsystem-list.ts");
      const { runSternsystemValidate } = await import("./sternsystem-validate.ts");
      const { runSternsystemPin } = await import("./sternsystem-pin.ts");
      const { runSternsystemExtract } = await import("./sternsystem-extract.ts");
      const { runSternsystemSync } = await import("./sternsystem-sync.ts");
      const { runSternsystemStatus } = await import("./sternsystem-status.ts");
      const { runSurfaceContractValidate } = await import("../handoff/surface-contract.ts");
      registry.registerCommand({
        name: "sternsystem.register",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "Register a new Sternsystem: create system-config.yaml, system-state.yaml, pin, content stubs, open first mission, and trigger materialization (RFC-0354, RFC-0532, RFC-0790). Flags: --id, --cosmicStar, --repo, [--platform], [--mirror], [--owner], [--amend], [--amend-id].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          cosmicStar: {
            kind: "string",
            description:
              "Reserved page cosmic star (required for new registration, ignored with --amend).",
          },
          repo: {
            kind: "string",
            description:
              "Sternsystem repository URL (required for new registration, ignored with --amend).",
          },
          platform: { kind: "string", description: "Pinned platform version." },
          mirror: { kind: "string", description: "External mirror repository URL (optional)." },
          owner: {
            kind: "string",
            description:
              "VC subject id (did:web:<domain>#<key-version>) for site owner (RFC-0561).",
          },
          amend: {
            kind: "boolean",
            description: "Amend an existing Sternsystem instead of creating a new one.",
          },
          "amend-id": {
            kind: "string",
            description: "Amend batch number (optional, used with --amend).",
          },
        },
        writes: [
          "systems-cache/{id}/system-config.yaml",
          "systems-cache/{id}/system-state.yaml",
          "systems-cache/{id}/system.pin.json",
          "systems-cache/{id}/src/content/system.md",
        ],
        reads: ["systems-cache/*/system-config.yaml", "onboarding/{id}/.input/00-brief.md"],
        cacheable: false,
        execute: runSternsystemRegister,
      });
      registry.registerCommand({
        name: "sternsystem.list",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        description:
          "List all registered Sternsystems with their id, cosmicStar, pinned platform, status (RFC-0354).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {},
        reads: ["systems-cache/*/system-config.yaml", "systems-cache/*/system.pin.json"],
        execute: runSternsystemList,
      });
      registry.registerCommand({
        name: "sternsystem.validate",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        description:
          "Validate registry invariants, bundle contract, and pin file for one or all Sternsystems (RFC-0354). Flags: --id.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          id: { kind: "string", description: "Optional Sternsystem id to validate." },
        },
        reads: ["systems-cache/*/system-config.yaml", "systems-cache/*/system.pin.json"],
        execute: runSternsystemValidate,
        gate: {
          severity: "error",
          phase: "workspace",
          blocks: ["mission.materialize"],
        },
      });
      registry.registerCommand({
        name: "sternsystem.pin",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "Write or update system.pin.json for a Sternsystem (RFC-0354). Flags: --id, [--platform].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          platform: { kind: "string", description: "Pinned platform version." },
        },
        writes: ["systems-cache/{id}/system.pin.json", "systems-cache/{id}/system-config.yaml"],
        reads: ["systems-cache/{id}/system-config.yaml", "systems-cache/{id}/system.pin.json"],
        cacheable: false,
        execute: runSternsystemPin,
      });
      registry.registerCommand({
        name: "sternsystem.extract",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "Extract an apps/<site>/ site into a Sternsystem git repo (RFC-0356). Flags: --site, [--repo].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          site: { kind: "string", required: true, description: "Site id to extract." },
          repo: { kind: "string", description: "Sternsystem repository URL." },
        },
        writes: ["systems-cache/{site}/**", "systems-cache/{site}/system-config.yaml"],
        reads: ["systems-cache/*/system-config.yaml", "missions/*/workpiece/**"],
        cacheable: false,
        execute: runSternsystemExtract,
      });
      registry.registerCommand({
        name: "sternsystem.sync",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "Push a Sternsystem's local bare repo to an external mirror (RFC-0472, RFC-0480). Push-only — pull and both are removed. Flags: --id, [--all].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          direction: {
            kind: "string",
            description: "Sync direction: push (default, only allowed value).",
          },
          all: {
            kind: "boolean",
            description: "Sync all branches + tags instead of current branch only.",
          },
        },
        writes: ["systems-cache/{id}/bordbuch/events.ndjson"],
        reads: ["systems-cache/{id}/system-config.yaml"],
        cacheable: false,
        execute: runSternsystemSync,
      });
      registry.registerCommand({
        name: "sternsystem.status",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        description:
          "Read-only synchronization state inspection for a Sternsystem (RFC-0477). Flags: --id, [--all].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        flags: {
          id: { kind: "string", description: "Sternsystem id (required unless --all is set)." },
          all: { kind: "boolean", description: "Show status for all registered systems." },
        },
        reads: [
          "systems-cache/*/system-config.yaml",
          "systems-cache/{id}/bordbuch/events.ndjson",
          "missions/*/mission.yaml",
        ],
        execute: runSternsystemStatus,
      });
      registry.registerCommand({
        name: "surface.contract.validate",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        description:
          "Validate generated C-surfaces (URL schema, JSON-LD types, sitemap shape) against declarative contract (RFC-0480). Flags: --app.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        flags: {
          app: {
            kind: "string",
            description: "Sternsystem id to validate (defaults to workspace root).",
          },
        },
        reads: [
          "systems-cache/{id}/src/surface.generated.json",
          "systems-cache/{id}/src/content/**",
          "systems-cache/{id}/dist/sitemap.xml",
        ],
        execute: runSurfaceContractValidate,
        gate: {
          severity: "error",
          phase: "postbuild",
          surfaces: ["url-schema", "jsonld-types", "sitemap-shape"],
          blocks: ["release.prepare"],
        },
      });
    },
  };
}
