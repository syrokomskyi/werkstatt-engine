/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0355/0356/0480 mission lifecycle commands: open, status, close, abort, list, materialize, validate, preview, build, diff, reconcile, git.commit, cleanup, resume, journal.show.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel mission/index.ts remains the public API surface.</item>
    <item>Do not register sternsystem, bordbuch, or release commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Lazy loading refactor: extracted from mission/index.ts to use dynamic imports inside async register().</item>
  <item>RFC-0560: add --actor-from-auth flag to mission.open, mission.close, mission.abort, mission.reconcile; change actor default from 'agent' to 'unknown'.</item>
  <item>ADR-0041: mission.module.ts is the single source of truth for command flag registration. mission/index.ts is now a pure re-export barrel with no command registrations.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createMissionModule(): KernelModule {
  return {
    name: "mission",
    version: "0.2.0",
    async register(registry) {
      const { runMissionOpen } = await import("./mission-open.ts");
      const { runMissionStatus } = await import("./mission-status.ts");
      const { runMissionClose } = await import("./mission-close.ts");
      const { runMissionAbort } = await import("./mission-abort.ts");
      const { runMissionList } = await import("./mission-list.ts");
      const { runMissionMaterialize } = await import("./mission-materialize.ts");
      const { runMissionMigrate } = await import("./mission-migrate.ts");
      const { runMissionGitCommit } = await import("./mission-git-commit.ts");
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
      const { runWorkpieceConfigPresenceCheck } =
        await import("./workpiece-config-presence-check.ts");
      const { runMissionPreflight } = await import("./mission-preflight.ts");
      registry.registerCommand({
        name: "mission.open",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description: "Open a new mission for a Sternsystem (RFC-0355).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
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
        },
        writes: [
          "missions/{mission}/**",
          "systems-cache/{system}/system-state.yaml",
          "systems-cache/{system}/bordbuch/events.ndjson",
        ],
        reads: [
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system.pin.json",
        ],
        cacheable: false,
        execute: runMissionOpen,
      });
      registry.registerCommand({
        name: "mission.status",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description: "Print mission manifest and Bordbuch entries (RFC-0355).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
        },
        reads: ["missions/{mission}/**", "systems/{system}/bordbuch/events.ndjson"],
        execute: runMissionStatus,
      });
      registry.registerCommand({
        name: "mission.close",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description: "Close an open mission (RFC-0355).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
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
        },
        writes: [
          "missions/{mission}/mission.yaml",
          "missions/{mission}/evidence/close-report.json",
          "systems-cache/{system}/system-state.yaml",
          "systems-cache/{system}/bordbuch/events.ndjson",
        ],
        reads: [
          "missions/{mission}/mission.yaml",
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runMissionClose,
      });
      registry.registerCommand({
        name: "mission.abort",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description: "Abort an open mission and discard Werkstück/Distribution (RFC-0355).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
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
          "systems-cache/{system}/system-state.yaml",
          "systems-cache/{system}/bordbuch/events.ndjson",
        ],
        reads: [
          "missions/{mission}/mission.yaml",
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runMissionAbort,
      });
      registry.registerCommand({
        name: "mission.list",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description: "List missions, optionally filtered by system (RFC-0355).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          system: { kind: "string", description: "Filter by Sternsystem id." },
        },
        reads: ["missions/*/mission.yaml", "systems-cache/*/system-config.yaml"],
        execute: runMissionList,
      });
      registry.registerCommand({
        name: "mission.materialize",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Populate the mission Werkstück from the pinned Sternsystem bundle (RFC-0356).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          "report-only": {
            kind: "boolean",
            description: "Only report materialization readiness; do not write workpiece files.",
          },
        },
        writes: [
          "missions/{mission}/workpiece/**",
          "missions/{mission}/evidence/materialization-report.json",
        ],
        reads: ["missions/{mission}/mission.yaml", "systems/{system}/system.pin.json"],
        cacheable: false,
        execute: runMissionMaterialize,
      });
      registry.registerCommand({
        name: "mission.migrate",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Apply pending migrators from the RFC-id-keyed registry to the workpiece (RFC-0479).",
        scope: "workspace",
        supportsAllSites: false,
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
      });
      registry.registerCommand({
        name: "mission.validate",
        contract: "mission",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description: "Validate the materialized Werkstück (RFC-0356).",
        scope: "workspace",
        supportsAllSites: false,
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
        },
        reads: ["missions/{mission}/**"],
        cacheable: false,
        execute: runMissionValidate,
        gate: {
          severity: "error",
          phase: "mission",
          blocks: ["mission.close", "release.prepare"],
        },
      });
      registry.registerCommand({
        name: "mission.preview",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Start a blocking dev server for the mission workpiece (RFC-0480). Works for open, closed, and aborted missions.",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          port: { kind: "string", description: "Port number (default: 4321)." },
          production: { kind: "boolean", description: "Use astro preview instead of astro dev." },
        },
        writes: ["missions/{mission}/workpiece/src/content-ref-index.generated.yaml"],
        reads: ["missions/{mission}/workpiece/**", "missions/{mission}/mission.yaml"],
        cacheable: false,
        execute: runMissionPreview,
      });
      registry.registerCommand({
        name: "mission.build",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description: "Build the Werkstück into a local Distribution (RFC-0356).",
        scope: "workspace",
        supportsAllSites: false,
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
      });
      registry.registerCommand({
        name: "mission.diff",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description: "Compute the data-set diff between Werkstück and pinned state (RFC-0356).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
        },
        reads: ["missions/{mission}/workpiece/**", "systems/{system}/system.pin.json"],
        execute: runMissionDiff,
      });
      registry.registerCommand({
        name: "mission.reconcile",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Reconcile validated Werkstück data changes to the Sternsystem repo (RFC-0356).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
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
      });
      registry.registerCommand({
        name: "mission.git.commit",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description: "Commit operator edits to the mission workpiece git repository (RFC-0480).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: true,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          message: { kind: "string", required: true, description: "Commit message." },
        },
        writes: ["missions/{mission}/workpiece/**"],
        reads: ["missions/{mission}/workpiece/**", "missions/{mission}/mission.yaml"],
        cacheable: false,
        execute: runMissionGitCommit,
      });
      registry.registerCommand({
        name: "mission.cleanup",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Remove workpiece/distribution for a closed or aborted mission, or clean old missions by age (RFC-0480).",
        scope: "workspace",
        supportsAllSites: false,
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
        },
        writes: [
          "missions/{mission}/workpiece/**",
          "missions/{mission}/distribution/**",
          "missions/{mission}/evidence/axiom/**",
        ],
        reads: ["missions/*/mission.yaml"],
        cacheable: false,
        execute: runMissionCleanup,
      });
      registry.registerCommand({
        name: "workpiece.read",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description: "Read a file from a mission workpiece with DNA-22 path validation (RFC-0555).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          path: { kind: "string", required: true, description: "Relative path within workpiece." },
        },
        reads: ["missions/{mission}/workpiece/**"],
        cacheable: false,
        execute: runWorkpieceRead,
      });
      registry.registerCommand({
        name: "workpiece.write",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Write a file to a mission workpiece with DNA-22 path validation. Content via stdin. No auto-commit (RFC-0555).",
        scope: "workspace",
        supportsAllSites: false,
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
      });
      registry.registerCommand({
        name: "materialize.config.validate",
        contract: "materialize",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description:
          "Validate OPERATOR_CONFIG_FILES list is in sync with actual workpiece/cache clone files (RFC-0840).",
        scope: "workspace",
        supportsAllSites: true,
        reads: ["missions/*/workpiece/*", "missions/*/workpiece/src/*", "systems-cache/*/"],
        cacheable: false,
        execute: runMaterializeConfigValidate,
      });
      registry.registerCommand({
        name: "workpiece.config.presence.check",
        contract: "workpiece",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description:
          "Verify OPERATOR_CONFIG_FILES are present in the active workpiece before build (RFC-0844).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
        },
        reads: ["missions/{mission}/workpiece/*", "missions/{mission}/workpiece/src/*"],
        cacheable: false,
        execute: runWorkpieceConfigPresenceCheck,
      });
      registry.registerCommand({
        name: "validate.postbuild",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description:
          "Run post-build validators on existing dist/ without a full rebuild (RFC-0883).",
        scope: "workspace",
        supportsAllSites: false,
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
      });
      registry.registerCommand({
        name: "mission.resume",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description: "Resume the last incomplete lifecycle operation for a mission (RFC-0958).",
        scope: "workspace",
        supportsAllSites: false,
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
      });
      registry.registerCommand({
        name: "mission.journal.show",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        description: "Show the operation journal for a mission (RFC-0958).",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          mission: { kind: "string", required: true, description: "Mission id." },
          op: { kind: "string", description: "Filter by operation id." },
          json: { kind: "boolean", description: "Output as JSON." },
        },
        reads: ["missions/{mission}/journal.jsonl"],
        cacheable: false,
        execute: runMissionJournalShow,
      });
      registry.registerCommand({
        name: "mission.preflight",
        modulePath: "packages/werkstatt-engine/src/mission/mission.module.ts",
        generates: [],
        description:
          "Run ownership.sync.validate and generated.stale.validate against the cache clone before opening a mission (RFC-0971).",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        flags: {
          system: { kind: "string", required: true, description: "Sternsystem id." },
        },
        writes: [],
        reads: ["systems-cache/{system}/public/**"],
        cacheable: false,
        execute: runMissionPreflight,
      });
    },
  };
}
