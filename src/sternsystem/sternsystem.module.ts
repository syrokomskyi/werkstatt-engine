/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0354/0480/0968 Sternsystem commands: register, list, validate, pin, extract, sync, status, passport, handover, and surface.contract.validate.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel sternsystem/index.ts remains the public API surface.</item>
    <item>Do not register mission, release, or deployment commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Lazy loading refactor: extracted from sternsystem/index.ts to use dynamic imports inside async register().</item>
  <item>RFC-0477: add sternsystem.status command registration.</item>
  <item>RFC-0966: add sternsystem.passport.generate and sternsystem.passport.verify command registrations.</item>
  <item>RFC-0968: add sternsystem.handover.prepare/complete/cancel command registrations and HANDOVER-01 rule declaration.</item>
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
      const { runSternsystemPassportGenerate } = await import("./sternsystem-passport-generate.ts");
      const { runSternsystemPassportVerify } = await import("./sternsystem-passport-verify.ts");
      const { runSurfaceContractValidate } = await import("../handoff/surface-contract.ts");
      const { runSternsystemHandoverPrepare } = await import("./sternsystem-handover-prepare.ts");
      const { runSternsystemHandoverComplete } = await import("./sternsystem-handover-complete.ts");
      const { runSternsystemHandoverCancel } = await import("./sternsystem-handover-cancel.ts");
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
          mirrors: {
            kind: "string",
            description:
              "Comma-separated mirror paths with storage type (e.g. /path:non-bare,/path:bare). Required for new registration.",
          },
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
        contract: "sternsystem",
        rules: ["HANDOVER-01"],
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
        name: "sternsystem.passport.generate",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "Build, sign, and write the site passport for a Sternsystem (RFC-0966). Reads system-config.yaml, pin, .env.example, bordbuch. Signs with SIGNING_PRIVATE_KEY. Flags: --id, [--actor].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          actor: {
            kind: "string",
            description: "Creator identity handle (e.g. human:andrii-syrokomskyi).",
          },
        },
        writes: ["systems-cache/{id}/passport.json", "systems-cache/{id}/system-state.yaml"],
        reads: [
          "systems-cache/{id}/system-config.yaml",
          "systems-cache/{id}/system.pin.json",
          "systems-cache/{id}/.env.example",
          "systems-cache/{id}/bordbuch/events.ndjson",
        ],
        cacheable: false,
        execute: runSternsystemPassportGenerate,
      });
      registry.registerCommand({
        name: "sternsystem.passport.verify",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        description:
          "Verify the signature and content-freshness of a Sternsystem's passport.json (RFC-0966). Flags: --id, [--offline].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          offline: {
            kind: "boolean",
            description: "Check structure + signature only (skip resource drift check).",
          },
        },
        reads: [
          "systems-cache/{id}/passport.json",
          "systems-cache/{id}/system-config.yaml",
          "systems-cache/{id}/system.pin.json",
          "systems-cache/{id}/.env.example",
          "systems-cache/{id}/bordbuch/events.ndjson",
        ],
        execute: runSternsystemPassportVerify,
      });
      registry.registerCommand({
        name: "surface.contract.validate",
        contract: "surface",
        rules: [],
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
      registry.registerCommand({
        name: "sternsystem.handover.prepare",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "RFC-0968: Generate a signed handover authorization to transfer a Sternsystem to a recipient identity. Flags: --id, --recipient-identity, --recipient-public-key.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          "recipient-identity": {
            kind: "string",
            required: true,
            description: "Recipient creator identity handle.",
          },
          "recipient-public-key": {
            kind: "string",
            required: true,
            description: "Recipient Ed25519 public key (hex).",
          },
        },
        writes: ["../systems-cache/{id}/handover-authorization.json"],
        cacheable: false,
        execute: runSternsystemHandoverPrepare,
      });
      registry.registerCommand({
        name: "sternsystem.handover.complete",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "RFC-0968: Complete a handover — verify authorization, regenerate passport, append bordbuch event, update ownership registry. Flags: --id.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          "source-locator": {
            kind: "string",
            description: "Git remote or bundle path to fetch authorization from (optional).",
          },
        },
        writes: [
          "../systems-cache/{id}/passport.json",
          "../systems-cache/{id}/bordbuch/events.ndjson",
        ],
        cacheable: false,
        execute: runSternsystemHandoverComplete,
      });
      registry.registerCommand({
        name: "sternsystem.handover.cancel",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "RFC-0968: Cancel a pending handover by removing the authorization file. Flags: --id.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
        },
        writes: ["../systems-cache/{id}/handover-authorization.json"],
        cacheable: false,
        execute: runSternsystemHandoverCancel,
      });
    },
  };
}
