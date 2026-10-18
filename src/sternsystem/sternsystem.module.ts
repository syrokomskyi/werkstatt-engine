/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0354/0480/0968 Sternsystem commands: register, list, validate, pin, extract, sync, status, passport, handover, and surface.contract.validate.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel sternsystem/index.ts remains the public API surface.</item>
    <item>Do not register mission, release, or deployment commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1307: steps 3-4 — deterministic intake seed planner and sternsystem.register --intake --biome</item>
  <item>RFC-1307: add register --domain for intakes without a confirmed domain</item>
  <item>RFC-1327: run-twice idempotency — declarations, command.idempotency.validate, rerun tests, reconcile/ship/abort convergence fixes</item>
  <item>RFC-1327: review r1 — lock-safe reconcile gate, residue sweep, honest idempotency classes</item>
  <item>RFC-1325: provisional workers.dev as first-class site host

Single host predicate module in werkstatt-shared; provisional registration derives dev/alt/main workers.dev channels from the account subdomain; first dev deploy auto-protects provisional hosts; provisional main responses carry noindex; dns-aid skips provisional sites; site.domain.adopt cuts over to a custom domain.</item>
  <history>RFC-0477, RFC-0966, RFC-0968, RFC-1097, RFC-1141, RFC-1173, RFC-1231, RFC-1248, RFC-1284, RFC-1297</history>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createSternsystemModule(): Promise<ModuleExport> {
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
  return {
    name: "sternsystem",
    version: "0.1.0",
    declarations: [],
    commands: [
      {
        name: "sternsystem.register",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "Register a new Sternsystem from a validated werkstatt:intake/v1 bundle: create system-config.yaml, system-state.yaml (with onboarding provenance), pin, seed system.md + primary-locale business-profile PBP documents + publishable assets deterministically, open first mission, and trigger materialization (RFC-0354, RFC-0790, RFC-1307). Flags: --id, --cosmicStar, --intake, --biome, --mirrors, [--platform], [--owner], [--amend], [--amend-id].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        idempotency: "not-idempotent",
        idempotencyNote:
          "Registering an already-registered id fails by design; provisioning runs once per site.",
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
          intake: {
            kind: "string",
            description:
              "werkstatt:intake/v1 bundle directory (required for new registration, rejected with --amend). Must pass onboarding.intake.validate (RFC-1307).",
          },
          biome: {
            kind: "string",
            description:
              "Client biome id from biome.from-intake (required for new registration, rejected with --amend); checked via biome.contract.validate --biome (RFC-1307).",
          },
          domain: {
            kind: "string",
            description:
              "Site host seeded into identity.domain when the intake carries no confirmed domain (e.g. a provisional <worker>.<account>.workers.dev host); rejected with --amend.", // site-host: flag help-text, not host classification
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
          "../systems-cache/{id}/system-config.yaml",
          "../systems-cache/{id}/system-state.yaml",
          "../systems-cache/{id}/system.pin.json",
          "../systems-cache/{id}/src/content/system.md",
          "../systems-cache/{id}/src/content/business-profile/**",
        ],
        reads: [
          "../systems-cache/*/system-config.yaml",
          "onboarding/{id}/.input/intake/**",
          "packages/werkstatt-site/src/domain/ontology/biomes/*.yaml",
        ],
        cacheable: false,
        execute: runSternsystemRegister,
      },
      {
        name: "sternsystem.list",
        mutatesState: false,
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        description:
          "List all registered Sternsystems with their id, cosmicStar, pinned platform, status (RFC-0354).",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {},
        reads: ["../systems-cache/*/system-config.yaml", "../systems-cache/*/system.pin.json"],
        execute: runSternsystemList,
      },
      {
        name: "sternsystem.validate",
        mutatesState: false,
        execOnReadOnly: true,
        contract: "sternsystem",
        rules: ["HANDOVER-01", "JRN-01", "ACCESS-01", "ACCESS-02", "LIVE-01", "LIVE-02"],
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        description:
          "Validate registry invariants, bundle contract, pin file, access-protection drift (ACCESS-01/02), and recorded-vs-live release drift (LIVE-01/02) for one or all Sternsystems (RFC-0354, RFC-1284, RFC-1297). Flags: --id.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          id: { kind: "string", description: "Optional Sternsystem id to validate." },
        },
        reads: [
          "../systems-cache/*/system-config.yaml",
          "../systems-cache/*/system.pin.json",
          "../systems-cache/*/system-state.yaml",
        ],
        execute: runSternsystemValidate,
        gate: {
          severity: "error",
          phase: "workspace",
          blocks: ["mission.materialize"],
        },
      },
      {
        name: "sternsystem.pin",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "Write or update system.pin.json for a Sternsystem (RFC-0354). Flags: --id, [--platform].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          platform: { kind: "string", description: "Pinned platform version." },
        },
        writes: [
          "../systems-cache/{id}/system.pin.json",
          "../systems-cache/{id}/system-config.yaml",
        ],
        reads: [
          "../systems-cache/{id}/system-config.yaml",
          "../systems-cache/{id}/system.pin.json",
        ],
        cacheable: false,
        execute: runSternsystemPin,
      },
      {
        name: "sternsystem.extract",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "Extract an apps/<site>/ site into a Sternsystem git repo (RFC-0356). Flags: --site, [--repo].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          site: { kind: "string", required: true, description: "Site id to extract." },
          repo: { kind: "string", description: "Sternsystem repository URL." },
          mirrors: {
            kind: "string",
            description: "Comma-separated mirror specs read via flagString (RFC-1141).",
          },
        },
        writes: ["../systems-cache/{site}/**", "../systems-cache/{site}/system-config.yaml"],
        reads: ["../systems-cache/*/system-config.yaml", "missions/*/workpiece/**"],
        cacheable: false,
        execute: runSternsystemExtract,
      },
      {
        name: "sternsystem.sync",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "Push a Sternsystem's local bare repo to an external mirror (RFC-0472, RFC-0480). Push-only — pull and both are removed. Flags: --id, [--all-branches].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        idempotency: "rerun-safe",
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          direction: {
            kind: "string",
            description: "Sync direction: push (default, only allowed value).",
          },
          "all-branches": {
            kind: "boolean",
            description: "Sync all branches + tags instead of current branch only.",
          },
        },
        writes: ["../systems-cache/{id}/bordbuch/events.ndjson"],
        reads: ["../systems-cache/{id}/system-config.yaml"],
        cacheable: false,
        execute: runSternsystemSync,
      },
      {
        name: "sternsystem.status",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        description:
          "Read-only synchronization state inspection for a Sternsystem (RFC-0477). Flags: --id, [--all].",
        scope: "workspace",
        acceptsAllFlag: true,
        mutatesState: false,
        execOnReadOnly: true,
        flags: {
          id: { kind: "string", description: "Sternsystem id (required unless --all is set)." },
          all: { kind: "boolean", description: "Show status for all registered systems." },
        },
        reads: [
          "../systems-cache/*/system-config.yaml",
          "../systems-cache/{id}/system-state.yaml",
          "../systems-cache/{id}/bordbuch/events.ndjson",
          "missions/*/mission.yaml",
        ],
        execute: runSternsystemStatus,
      },
      {
        name: "sternsystem.passport.generate",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "Build, sign, and write the site passport for a Sternsystem (RFC-0966). Reads system-config.yaml, pin, .env.example, bordbuch. Signs with SIGNING_PRIVATE_KEY. Flags: --id, [--actor].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          actor: {
            kind: "string",
            description: "Creator identity handle (e.g. human:andrii-syrokomskyi).",
          },
        },
        writes: ["../systems-cache/{id}/passport.json", "../systems-cache/{id}/system-state.yaml"],
        reads: [
          "../systems-cache/{id}/system-config.yaml",
          "../systems-cache/{id}/system.pin.json",
          "../systems-cache/{id}/.env.example",
          "../systems-cache/{id}/bordbuch/events.ndjson",
        ],
        cacheable: false,
        execute: runSternsystemPassportGenerate,
      },
      {
        name: "sternsystem.passport.verify",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        description:
          "Verify the signature and content-freshness of a Sternsystem's passport.json (RFC-0966). Flags: --id, [--offline].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: false,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          offline: {
            kind: "boolean",
            description: "Check structure + signature only (skip resource drift check).",
          },
        },
        reads: [
          "../systems-cache/{id}/passport.json",
          "../systems-cache/{id}/system-config.yaml",
          "../systems-cache/{id}/system.pin.json",
          "../systems-cache/{id}/.env.example",
          "../systems-cache/{id}/bordbuch/events.ndjson",
        ],
        execute: runSternsystemPassportVerify,
      },
      {
        name: "surface.contract.validate",
        contract: "surface",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        description:
          "Validate generated C-surfaces (URL schema, JSON-LD types, sitemap shape) against declarative contract (RFC-0480). Flags: --app.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: false,
        flags: {
          app: {
            kind: "string",
            description: "Sternsystem id to validate (defaults to workspace root).",
          },
        },
        reads: [
          "../systems-cache/{id}/src/surface.generated.json",
          "../systems-cache/{id}/src/content/**",
          "../systems-cache/{id}/dist/sitemap.xml",
        ],
        execute: runSurfaceContractValidate,
        gate: {
          severity: "error",
          phase: "postbuild",
          surfaces: ["url-schema", "jsonld-types", "sitemap-shape"],
          blocks: ["release.prepare"],
        },
      },
      {
        name: "sternsystem.handover.prepare",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "RFC-0968/0988: Generate a signed handover authorization to transfer a Sternsystem to a recipient identity. Flags: --id, --recipient-identity, --recipient-public-key, --dry-run.",
        scope: "workspace",
        acceptsAllFlag: false,
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
          "dry-run": {
            kind: "boolean",
            description:
              "Execute in memory without writing handover-authorization.json. Returns SignedHandoverAuthorization in result.",
          },
        },
        writes: ["../systems-cache/{id}/handover-authorization.json"],
        cacheable: false,
        execute: runSternsystemHandoverPrepare,
      },
      {
        name: "sternsystem.handover.complete",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "RFC-0968/0988: Complete a handover — verify authorization, regenerate passport, append bordbuch event, update ownership registry. Flags: --id, --source-locator, --dry-run, --authorization-data.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
          "source-locator": {
            kind: "string",
            description: "Git remote or bundle path to fetch authorization from (optional).",
          },
          "dry-run": {
            kind: "boolean",
            description:
              "Execute in memory without writing bordbuch, passport, or registry. Requires --authorization-data. Incompatible with --source-locator.",
          },
          "authorization-data": {
            kind: "string",
            description:
              "JSON string containing the full SignedHandoverAuthorization object from prepare. Required when --dry-run is set.",
          },
        },
        writes: [
          "../systems-cache/{id}/passport.json",
          "../systems-cache/{id}/bordbuch/events.ndjson",
        ],
        cacheable: false,
        execute: runSternsystemHandoverComplete,
      },
      {
        name: "sternsystem.handover.cancel",
        modulePath: "packages/werkstatt-engine/src/sternsystem/sternsystem.module.ts",
        generates: [],
        description:
          "RFC-0968: Cancel a pending handover by removing the authorization file. Flags: --id.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem id." },
        },
        writes: ["../systems-cache/{id}/handover-authorization.json"],
        cacheable: false,
        execute: runSternsystemHandoverCancel,
      },
    ],
    pipelines: [],
  };
}
