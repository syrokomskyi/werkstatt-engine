/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0355/0356/0480 mission lifecycle commands: open, status, close, abort, list, materialize, validate, preview, build, diff, reconcile, git.commit, cleanup, resume, journal.show, preflight, validation.state.inspect.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel mission/index.ts remains the public API surface.</item>
    <item>Do not register sternsystem, bordbuch, or release commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1256: a11y.contrast.lint + mission.deploy-preflight — early deploy-blocker detection</item>
  <item>RFC-1256: review fixes — manifest-derived systemId, at-statement boundary, alpha/NaN guards, resolveSiteWorkspace, execOnReadOnly drift</item>
  <item>RFC-1263</item>
  <item>RFC-1264</item>
  <item>RFC-1327: run-twice idempotency — declarations, command.idempotency.validate, rerun tests, reconcile/ship/abort convergence fixes</item>
  <history>ADR-0041, ADR-0096, RFC-0560, RFC-1028, RFC-1095, RFC-1097, RFC-1146, RFC-1173, RFC-1176, RFC-1199, RFC-1231, RFC-1248</history>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createMissionModule(): Promise<ModuleExport> {
  const { runMissionOpen } = await import("./mission-open.ts");
  const { runMissionStatus } = await import("./mission-status.ts");
  const { runMissionClose } = await import("./mission-close.ts");
  const { runMissionAbort } = await import("./mission-abort.ts");
  const { runMissionList } = await import("./mission-list.ts");
  const { runMissionMaterialize } = await import("./mission-materialize.ts");
  const { runMissionMigrate } = await import("./mission-migrate.ts");
  const { runMissionGitCommit } = await import("./mission-git-commit.ts");
  const { runMissionContentEdit } = await import("./mission-content-edit.ts");
  const { runMissionPreview } = await import("./mission-preview.ts");
  const { runMissionCleanup } = await import("./mission-cleanup.ts");
  const { runMissionValidate, runMissionBuild, runMissionDiff, runMissionReconcile } =
    await import("./mission-materialization-commands.ts");
  const { runValidatePostbuild } = await import("./validate-postbuild.ts");
  const { runMissionResume } = await import("./mission-resume.ts");
  const { runMissionJournalShow } = await import("./mission-journal-show.ts");
  const { runWorkpieceRead } = await import("../workpiece/workpiece-read.ts");
  const { runWorkpieceWrite } = await import("../workpiece/workpiece-write.ts");
  const { runMaterializeConfigValidate } = await import("./materialize-config-validate.ts");
  const { runWorkpieceConfigPresenceCheck } = await import("./workpiece-config-presence-check.ts");
  const { runMissionPreflight } = await import("./mission-preflight.ts");
  const { runMissionDeployPreflight } = await import("./mission-deploy-preflight.ts");
  const { runValidationStateInspect } = await import("./validation-state-inspect.ts");
  return {
    name: "mission",
    version: "0.2.0",
    declarations: [],
    commands: [
      {
        name: "mission.open",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Open a new mission for a Sternsystem (RFC-0355). Required flags: `--system`, `--brief`.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        idempotency: "rerun-safe",
        flags: {
          system: { kind: "string", required: true, description: "Sternsystem id." },
          brief: { kind: "string", required: true, description: "Mission brief." },
          actor: {
            kind: "string",
            default: "unknown",
            description: "Actor identity (VC subject id or free-text).",
          },
          "actor-from-auth": {
            kind: "boolean",
            description:
              "Read actor identity from WERKSTATT_ACTOR_ID env var set by Studio Gate auth.",
          },
          lane: {
            kind: "string",
            description:
              'RFC-1263: declare the mission lane on the record — "content" marks a content fast-lane mission (used by mission.content-edit); "full" is the standard lifecycle.',
          },
        },
        writes: [
          "missions/{mission}/**",
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/bordbuch/events.ndjson",
        ],
        reads: [
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system.pin.json",
        ],
        cacheable: false,
        execute: runMissionOpen,
      },
      {
        name: "mission.status",
        mutatesState: false,
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description:
          "Print mission manifest and Bordbuch entries (RFC-0355). Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
        },
        reads: ["missions/{mission}/**", "systems/{system}/bordbuch/events.ndjson"],
        execute: runMissionStatus,
      },
      {
        name: "mission.close",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description: "Close an open mission (RFC-0355). Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        idempotency: "rerun-safe",
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          actor: {
            kind: "string",
            default: "unknown",
            description: "Actor identity (VC subject id or free-text).",
          },
          "actor-from-auth": {
            kind: "boolean",
            description:
              "Read actor identity from WERKSTATT_ACTOR_ID env var set by Studio Gate auth.",
          },
          release: { kind: "string", description: "Release id produced by this mission." },
          "skip-evidence-sync": {
            kind: "boolean",
            description:
              "RFC-0652: Skip mandatory evidence.sync to R2. Escape hatch for offline close only — local evidence will be lost when mission.cleanup runs.",
          },
          "skip-auto-sync": {
            kind: "boolean",
            description: "RFC-0797: Skip pre-mirror-check sternsystem.sync inside close lock.",
          },
          "skip-content-regression": {
            kind: "boolean",
            description:
              "RFC-0734 + ADR-0050: Skip CREG-05 content regression review warning (non-blocking).",
          },
          "skip-template-sync": {
            kind: "boolean",
            description: "RFC-0800: Skip auto-sync of template dependencies from workpiece.",
          },
          "allow-no-op": {
            kind: "boolean",
            description:
              "RFC-0820: Override zero-commit guard. Allow closing a mission with no operator commits (e.g., platform-only update, config sync).",
          },
          "skip-reconcile-check": {
            kind: "boolean",
            description:
              "RFC-0913: Skip reconcile-freshness gate. Escape hatch for edge cases — writes bordbuch audit entry.",
          },
          "skip-behavior-snapshot": {
            kind: "boolean",
            description:
              "RFC-0991: Skip behavior-snapshot-refresh step (auto-generate behavior snapshot during close).",
          },
          "skip-digest": {
            kind: "boolean",
            description:
              "RFC-1264: Skip mission-digest step. Audited escape hatch — records digestSkipped in the close bordbuch event.",
          },
        },
        writes: [
          "missions/{mission}/mission.yaml",
          "missions/{mission}/evidence/close-report.json",
          "missions/{mission}/evidence/mission-digest/**",
          "missions/{mission}/workpiece/behavior.snapshot.generated.yaml",
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/bordbuch/events.ndjson",
        ],
        reads: [
          "missions/{mission}/mission.yaml",
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runMissionClose,
      },
      {
        name: "mission.abort",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Abort an open mission and discard Werkstück/Distribution (RFC-0355). Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        idempotency: "rerun-safe",
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          reason: { kind: "string", description: "Abort reason." },
          actor: {
            kind: "string",
            default: "unknown",
            description: "Actor identity (VC subject id or free-text).",
          },
          "actor-from-auth": {
            kind: "boolean",
            description:
              "Read actor identity from WERKSTATT_ACTOR_ID env var set by Studio Gate auth.",
          },
        },
        writes: [
          "missions/{mission}/mission.yaml",
          "missions/{mission}/workpiece/**",
          "missions/{mission}/distribution/**",
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/bordbuch/events.ndjson",
        ],
        reads: [
          "missions/{mission}/mission.yaml",
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runMissionAbort,
      },
      {
        name: "mission.list",
        coverage: "operator" as const,
        mutatesState: false,
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description: "List missions, optionally filtered by system (RFC-0355).",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          system: { kind: "string", description: "Filter by Sternsystem id." },
        },
        reads: ["missions/*/mission.yaml", "../systems-cache/*/system-config.yaml"],
        execute: runMissionList,
      },
      {
        name: "mission.materialize",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Populate the mission Werkstück from the pinned Sternsystem bundle (RFC-0356). Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        idempotency: "rerun-safe",
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          "report-only": {
            kind: "boolean",
            description: "Only report materialization readiness; do not write workpiece files.",
          },
          "skip-preflight": {
            kind: "boolean",
            description:
              "Bypass the preflight content quality gate (Bordbuch-audited operator override).",
          },
        },
        writes: [
          "missions/{mission}/workpiece/**",
          "missions/{mission}/evidence/materialization-report.json",
        ],
        reads: ["missions/{mission}/mission.yaml", "systems/{system}/system.pin.json"],
        cacheable: false,
        execute: runMissionMaterialize,
      },
      {
        name: "mission.migrate",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Apply pending migrators from the RFC-id-keyed registry to the workpiece (RFC-0479). Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          "report-only": {
            kind: "boolean",
            description: "Only report pending migrators; do not apply.",
          },
        },
        writes: [
          "missions/{mission}/workpiece/**",
          "missions/{mission}/evidence/migration-report.json",
          "missions/{mission}/mission.yaml",
          "systems/{system}/bordbuch/events.ndjson",
        ],
        reads: ["missions/{mission}/**", "systems/{system}/system.pin.json"],
        cacheable: false,
        execute: runMissionMigrate,
      },
      {
        name: "mission.validate",
        mutatesState: true,
        idempotency: "rerun-safe",
        generates: [],
        contract: "mission",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description: "Validate the materialized Werkstück (RFC-0356). Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          "skip-content-regression": {
            kind: "boolean",
            description: "RFC-0732: Skip content regression gate (escape hatch).",
          },
          "auto-accept-regression": {
            kind: "boolean",
            description:
              "RFC-0764: Auto-accept all content regression drift, update golden baseline directly.",
          },
          "collect-errors": {
            kind: "boolean",
            description:
              "RFC-0809: Continue executing independent steps after a failure and aggregate all errors in the final report.",
          },
          force: {
            kind: "boolean",
            description: "RFC-0973: Clear all caches and stale artifacts before validation.",
          },
          fast: {
            kind: "boolean",
            description:
              "RFC-1086: Incremental validation — read previous validation-report.json, skip passed phases, cascade re-run of downstream phases.",
          },
          "skip-auto-commit": {
            kind: "boolean",
            description:
              "RFC-0976: Skip auto-commit of generated artifacts after successful validation.",
          },
        },
        writes: ["missions/{mission}/evidence/**", "missions/{mission}/distribution/**"],
        reads: ["missions/{mission}/**"], // scan-coverage: transient workpiece root — missions/ is gitignored, absent on clean checkouts
        cacheable: false,
        execute: runMissionValidate,
        gate: {
          severity: "error",
          phase: "mission",
          blocks: ["mission.close", "release.prepare"],
        },
      },
      {
        name: "mission.preview",
        mutatesState: true,
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Start a blocking dev server for the mission workpiece (RFC-0480). Works for open, closed, and aborted missions. Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          port: { kind: "string", description: "Port number (default: 4321)." },
          production: { kind: "boolean", description: "Use astro preview instead of astro dev." },
          "skip-prepare": {
            kind: "boolean",
            description: "Skip critical file generation check (fast restart).",
          },
        },
        writes: ["missions/{mission}/workpiece/src/content-ref-index.generated.yaml"],
        reads: ["missions/{mission}/workpiece/**", "missions/{mission}/mission.yaml"],
        cacheable: false,
        execute: runMissionPreview,
      },
      {
        name: "mission.build",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Build the Werkstück into a local Distribution (RFC-0356). Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
        },
        writes: [
          "missions/{mission}/distribution/**",
          "missions/{mission}/evidence/build-report.json",
        ],
        reads: ["missions/{mission}/workpiece/**"],
        cacheable: false,
        execute: runMissionBuild,
      },
      {
        name: "mission.diff",
        coverage: "operator" as const,
        mutatesState: true,
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description:
          "Compute the data-set diff between Werkstück and pinned state (RFC-0356). Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
        },
        writes: ["missions/{mission}/evidence/authored-diff.json"],
        generates: [],
        reads: ["missions/{mission}/workpiece/**", "systems/{system}/system.pin.json"],
        execute: runMissionDiff,
      },
      {
        name: "mission.reconcile",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Reconcile validated Werkstück data changes to the Sternsystem repo (RFC-0356). Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        idempotency: "rerun-safe",
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          message: { kind: "string", description: "Reconciliation message." },
          actor: {
            kind: "string",
            default: "unknown",
            description: "Actor identity (VC subject id or free-text).",
          },
          "actor-from-auth": {
            kind: "boolean",
            description:
              "Read actor identity from WERKSTATT_ACTOR_ID env var set by Studio Gate auth.",
          },
        },
        writes: [
          "missions/{mission}/mission.yaml",
          "missions/{mission}/evidence/reconciliation-report.json",
        ],
        reads: ["missions/{mission}/**", "systems/{system}/system.pin.json"],
        cacheable: false,
        execute: runMissionReconcile,
      },
      {
        name: "mission.git.commit",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Commit operator edits to the mission workpiece git repository (RFC-0480). Fails closed with MATERIALIZATION_IN_PROGRESS while the workpiece is still being materialized (RFC-1199). Required flags: `--mission`, `--message`.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          message: { kind: "string", required: true, description: "Commit message." },
          rfc: {
            kind: "string",
            description:
              "RFC id to reference — records CHANGE_SUMMARY items and writes X-RFC trailer (RFC-1095).",
          },
          adr: {
            kind: "string",
            description:
              "ADR id to reference — records CHANGE_SUMMARY items and writes X-ADR trailer (RFC-1095).",
          },
          "scope-files": {
            kind: "string",
            description:
              "Comma-separated workpiece-relative paths — restrict staging and pre-commit validation to these files (ADR-0096 bookkeeping commits).",
          },
        },
        writes: ["missions/{mission}/workpiece/**"],
        reads: ["missions/{mission}/workpiece/**", "missions/{mission}/mission.yaml"],
        cacheable: false,
        execute: runMissionGitCommit,
      },
      {
        name: "mission.content-edit",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          'RFC-1263: content fast-lane composite — for a mission whose touched set resolves inside the editable content surface, runs the scoped gate set (content.patch, author validators, content.regression.check, advisory deploy-preflight), commits via mission.git.commit, records the gate set on the mission, reconciles, and closes when the site\'s contentEditLane is "active". Required flags: `--site` + `--brief`, or `--mission`; `--ops-file` to apply ops. `--dry-run` reports eligibility without writes.',
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          site: {
            kind: "string",
            description: "Sternsystem id — opens a new content-lane mission.",
          },
          mission: {
            kind: "string",
            description: "Reuse an already-open mission instead of opening one.",
          },
          brief: { kind: "string", description: "Mission brief (required with --site)." },
          "ops-file": {
            kind: "string",
            description: "YAML ops file for content.patch (list of {op, selector, value|slots}).",
          },
          message: {
            kind: "string",
            description: "Commit message override (defaults to --brief).",
          },
          actor: {
            kind: "string",
            default: "unknown",
            description: "Actor identity propagated to open/commit/reconcile/close.",
          },
          "actor-from-auth": {
            kind: "boolean",
            description:
              "Read actor identity from WERKSTATT_ACTOR_ID env var set by Studio Gate auth.",
          },
          "dry-run": {
            kind: "boolean",
            description: "Report eligibility + read-only gate results; no writes.",
          },
        },
        writes: [
          "missions/{mission}/mission.yaml",
          "missions/{mission}/workpiece/**",
          "../systems-cache/{system}/**",
        ],
        reads: [
          "missions/{mission}/**",
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/src/content/**",
          "../systems-cache/{system}/.werkstatt/generated-paths.generated.yaml",
        ],
        cacheable: false,
        execute: runMissionContentEdit,
      },
      {
        name: "mission.cleanup",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Remove workpiece/distribution for a closed or aborted mission, or clean old missions by age (RFC-0480). --stale-dirs archives aborted missions and removes stub dirs (RFC-0985).",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          mission: { kind: "string", description: "Mission id (for single-mission cleanup)." },
          "older-than": {
            kind: "string",
            description: "Age threshold (e.g. '30d') for batch cleanup.",
          },
          "evidence-retention-days": {
            kind: "string",
            description:
              "RFC-0652: Retention period in days for local Axiom evidence cleanup (default: 30). Set to 0 to preserve all evidence.",
          },
          "stale-dirs": {
            kind: "boolean",
            description:
              "RFC-0985: Archive aborted missions to missions/archive/aborted/ and remove stub directories (no mission.yaml).",
          },
        },
        writes: [
          "missions/{mission}/workpiece/**",
          "missions/{mission}/distribution/**",
          "missions/{mission}/evidence/axiom/**",
          "missions/archive/aborted/{mission}/**",
        ],
        reads: ["missions/*/mission.yaml"],
        cacheable: false,
        execute: runMissionCleanup,
      },
      {
        name: "workpiece.read",
        coverage: "operator" as const,
        mutatesState: false,
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description:
          "Read a file from a mission workpiece with DNA-22 path validation (RFC-0555). Required flags: `--mission`, `--path`.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          path: { kind: "string", required: true, description: "Relative path within workpiece." },
        },
        reads: ["missions/{mission}/workpiece/**"],
        cacheable: false,
        execute: runWorkpieceRead,
      },
      {
        name: "workpiece.write",
        coverage: "operator" as const,
        coverageNote: "requires --mission + --stdin — workpiece write tool",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Write a file to a mission workpiece with DNA-22 path validation. Content via stdin. No auto-commit (RFC-0555). Required flags: `--mission`, `--path`, `--stdin`.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          path: { kind: "string", required: true, description: "Relative path within workpiece." },
          stdin: { kind: "boolean", required: true, description: "Read content from stdin." },
        },
        writes: ["missions/{mission}/workpiece/**"],
        reads: ["missions/{mission}/workpiece/src/content/system.md"],
        cacheable: false,
        execute: runWorkpieceWrite,
      },
      {
        name: "materialize.config.validate",
        mutatesState: false,
        contract: "materialize",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description:
          "Validate OPERATOR_CONFIG_FILES list is in sync with actual workpiece/cache clone files (RFC-0840).",
        scope: "workspace",
        acceptsAllFlag: true,
        flags: {},
        reads: ["missions/*/workpiece/*", "missions/*/workpiece/src/*", "../systems-cache/*/"], // scan-coverage: transient workpiece root — missions/ is gitignored, absent on clean checkouts
        cacheable: false,
        execute: runMaterializeConfigValidate,
      },
      {
        name: "workpiece.config.presence.check",
        mutatesState: false,
        contract: "workpiece",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description:
          "Verify OPERATOR_CONFIG_FILES are present in the active workpiece before build (RFC-0844). Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
        },
        reads: ["missions/{mission}/workpiece/*", "missions/{mission}/workpiece/src/*"], // scan-coverage: transient workpiece root — missions/ is gitignored, absent on clean checkouts
        cacheable: false,
        execute: runWorkpieceConfigPresenceCheck,
      },
      {
        name: "validate.postbuild",
        coverage: "operator" as const,
        coverageNote: "requires --mission or --site",
        mutatesState: false,
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description:
          "Run post-build validators on existing dist/ without a full rebuild (RFC-0883).",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          mission: { kind: "string", description: "Mission id." },
          site: { kind: "string", description: "Site id." },
          "skip-slow": {
            kind: "boolean",
            description: "Skip slow Playwright/Lighthouse steps.",
          },
        },
        reads: ["missions/{mission}/**", "apps/{site}/**"],
        cacheable: false,
        execute: runValidatePostbuild,
      },
      {
        name: "mission.resume",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Resume the last incomplete lifecycle operation for a mission (RFC-0958). Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          abandon: {
            kind: "boolean",
            description: "Abandon the incomplete operation (destructive — requires --force).",
          },
          force: {
            kind: "boolean",
            description: "Confirm destructive --abandon action.",
          },
        },
        writes: ["missions/{mission}/journal.jsonl"],
        reads: ["missions/{mission}/journal.jsonl", "missions/{mission}/mission.yaml"],
        cacheable: false,
        execute: runMissionResume,
      },
      {
        name: "mission.journal.show",
        coverage: "operator" as const,
        mutatesState: false,
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description:
          "Show the operation journal for a mission (RFC-0958). Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          op: { kind: "string", description: "Filter by operation id." },
          json: { kind: "boolean", description: "Output as JSON." },
        },
        reads: ["missions/{mission}/journal.jsonl"],
        cacheable: false,
        execute: runMissionJournalShow,
      },
      {
        name: "mission.preflight",
        coverage: "operator" as const,
        coverageNote: "requires --system",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Run ownership.sync.validate and generated.stale.validate against the cache clone before opening a mission (RFC-0971). Required flags: `--system`.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: false,
        execOnReadOnly: true,
        flags: {
          system: { kind: "string", required: true, description: "Sternsystem id." },
        },
        writes: [],
        reads: ["../systems-cache/{system}/public/**"],
        cacheable: false,
        execute: runMissionPreflight,
      },
      {
        name: "mission.deploy-preflight",
        coverage: "operator" as const,
        coverageNote: "requires --mission",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Deploy-readiness probe (RFC-1256): runs the historically fragile non-build validators against the mission workpiece in one aggregated pass before mission.reconcile. Advisory — mission.validate remains the gate. Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: false,
        execOnReadOnly: true,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          json: { kind: "boolean", description: "Output as JSON." },
        },
        writes: [],
        reads: ["missions/{mission}/workpiece/**"],
        cacheable: false,
        expectedDurationMs: 120_000,
        timeoutMs: 300_000,
        execute: runMissionDeployPreflight,
      },
      {
        name: "validation.state.inspect",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Inspect validation cache state for a mission (RFC-1028). Read-only. Required flags: `--mission`.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          json: { kind: "boolean", description: "Output as JSON." },
        },
        reads: ["missions/{mission}/.validation-state.json"],
        cacheable: false,
        execute: runValidationStateInspect,
      },
    ],
    pipelines: [],
  };
}
