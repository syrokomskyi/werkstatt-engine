/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0358/0379/0608 Leitstand fleet propagation commands: propagate, promote, status, rollback, and health.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel leitstand/index.ts remains the public API surface.</item>
    <item>Do not register release or notausgang commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1190: restore mission context + evidence archival in release-mode deploys

RFC-1190: precedence-ordered resolveMissionContext (--mission → release build-identity → currentMission), MISSION_CONTEXT_UNRESOLVED/MISMATCH blocking, fail-closed EVIDENCE_SYNC_FAILED with --skip-evidence-sync as sole escape hatch, journaled evidence-sync-* ship steps after each certify-*, evidence.sync --site/--system flag.

2026-10-04 handoff fixes: shared 25min mission.check timeout (inner 5min race + 300s orchestrator raced cold ~7-11min captures), sweep excludeOpIds so mission.close no longer self-abandons the live ship journal (broke --resume), name-keyed journal resume state so closed-mission plan shifts can't skip unexecuted steps, wrangler dev documented as the required --base-url preview server.</item>
  <item>RFC-1207: candidate-preview certify — wrangler dev on releases/<id>/dist/server measures the candidate artifact</item>
  <item>RFC-1231: step 1 — rename supportsAllSites to acceptsAllFlag

Mechanical sweep: the field only ever gated --all argv acceptance; fan-out
follows the parsed selector. Guard renamed assertAllSitesAllowed ->
assertAllFlagAccepted, message updated. 417 declaration sites + type
surfaces (KernelCommandMetadata, ForgeCommandMetadata) in one atomic pass.</item>
  <item>RFC-1248: VITE-CLIENT-DEP-02 lazy-import gate + SCAN-02 validator reads-root existence check (RFC-1248)</item>
  <item>RFC-1248: suppress transient releases/.werkstatt/ validator reads + complete PIPELINE-LOG rules declaration (RFC-1248 review r2)</item>
  <history>RFC-0627, RFC-0628, RFC-0700, RFC-0842, RFC-0866, RFC-0899, RFC-0927, RFC-0930, RFC-0962, RFC-1097, RFC-1136, RFC-1141, RFC-1168, RFC-1173, RFC-1190, RFC-1203</history>
</CHANGE_SUMMARY>
*/

import type { KernelFlagSpec, ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

// RFC-1203: declaration surface shared by leitstand.status and its
// leitstand.channels alias — flag/read additions propagate to both.
const leitstandStatusFlags: Record<string, KernelFlagSpec> = {
  site: { kind: "string", required: true, description: "Sternsystem id." },
  system: { kind: "string", description: "Alias for --site." },
  channel: {
    kind: "string",
    description: "Filter to a single channel: dev, alt, or main.",
  },
};

const leitstandStatusReads: string[] = [
  "../systems-cache/{system}/system-config.yaml",
  "../systems-cache/{system}/system-state.yaml",
  "../systems-cache/{system}/system.pin.json",
];

export async function createLeitstandModule(): Promise<ModuleExport> {
  const {
    runLeitstandDevDeploy,
    runLeitstandPropagate,
    runLeitstandPromote,
    runLeitstandStatus,
    runLeitstandChannels,
    runLeitstandRollback,
    runLeitstandHealth,
    runLeitstandPipelineCheck,
    runLeitstandHotfixDevDeploy,
    runLeitstandVerify,
  } = await import("./leitstand-commands.ts");
  const { runLeitstandCertify } = await import("./certify.ts");
  const { runLeitstandShip } = await import("./ship.ts");
  const { runLeitstandShipStatus } = await import("./ship-status.ts");
  const { runLeitstandServiceDevDeploy } = await import("./service-dev-deploy.ts");
  const { runLeitstandServicePromote } = await import("./service-promote.ts");
  const { runLeitstandAccessProtect, runLeitstandAccessUnprotect, runLeitstandAccessStatus } =
    await import("./access-commands.ts");
  return {
    name: "leitstand",
    version: "0.1.0",
    declarations: [],
    commands: [
      {
        name: "leitstand.dev-deploy",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Deploy workpiece to dev channel with Axiom verification gate (RFC-0628). Flags: --site, [--release].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          site: {
            kind: "string",
            required: true,
            description: "Sternsystem id with an active mission.",
          },
          system: {
            kind: "string",
            description: "Alias for --site.",
          },
          release: {
            kind: "string",
            description:
              "RFC-0700: Deploy an existing release to dev without open mission. When set, deploys from releases/<id>/dist/.",
          },
          mission: {
            kind: "string",
            description:
              "RFC-1190: Explicit mission id for evidence archival + mission.check. Falls back to releases/<id>/dist build-identity.json, then system-state.currentMission.",
          },
          "skip-evidence-sync": {
            kind: "boolean",
            description:
              "RFC-0652/1190: Skip evidence.sync to R2 after deploy. Also the explicit escape hatch when no mission context can be resolved.",
          },
          "force-build": {
            kind: "boolean",
            description: "RFC-0653: Force pnpm build even when build-skip cache matches.",
          },
          "gate-decision": {
            kind: "string",
            description:
              "RFC-0866: Path to GateDecisionV1 JSON file. Defaults to systems-cache/{system}/gate-decisions/{release}-dev.json.",
          },
          "candidate-id": {
            kind: "string",
            description: "RFC-0866: Release candidate id (defaults to --site).",
          },
          "artifact-hash": {
            kind: "string",
            description:
              "Artifact hash (sha256:... format). Auto-resolved from releases/{release}/artifact.tar.gz or release.yaml distTreeHash if omitted.",
          },
        },
        writes: ["missions/{mission}/evidence/axiom/**"],
        reads: [
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
          "missions/{mission}/workpiece/**",
          "releases/{release}/**",
        ],
        cacheable: false,
        execute: runLeitstandDevDeploy,
      },
      {
        name: "leitstand.propagate",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Deploy a published release with verified Axiom evidence to the alt channel (RFC-0628). Flags: --site, --release.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          release: {
            kind: "string",
            required: true,
            description:
              "Published release id with verified Axiom evidence (commitSha + missionId match).",
          },
          site: {
            kind: "string",
            required: true,
            description: "Sternsystem id.",
          },
          system: {
            kind: "string",
            description: "Alias for --site.",
          },
          mission: {
            kind: "string",
            description:
              "RFC-1190: Explicit mission id for the RFC-0628 evidence gate + evidence.sync. Falls back to releases/<id>/dist build-identity.json, then system-state.currentMission.",
          },
          "skip-evidence-sync": {
            kind: "boolean",
            description:
              "RFC-1190: Skip evidence.sync to R2 after deploy; explicit escape hatch when no mission context can be resolved.",
          },
          "gate-decision": {
            kind: "string",
            description:
              "RFC-0866: Path to GateDecisionV1 JSON file. Defaults to systems-cache/{system}/gate-decisions/{release}-alt.json.",
          },
          "candidate-id": {
            kind: "string",
            description: "RFC-0866: Release candidate id (defaults to --site).",
          },
          "artifact-hash": {
            kind: "string",
            description:
              "Artifact hash (sha256:... format). Auto-resolved from releases/{release}/artifact.tar.gz or release.yaml distTreeHash if omitted.",
          },
        },
        writes: [
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/bordbuch/events.ndjson",
          "releases/{release}/release.yaml",
        ],
        reads: [
          "releases/{release}/**",
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runLeitstandPropagate,
      },
      {
        name: "leitstand.promote",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Promote a verified alt-deployed release to the main channel with live build-identity verification (RFC-0608). Flags: --site, --release.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          release: {
            kind: "string",
            required: true,
            description: "Alt-deployed release id to promote.",
          },
          site: {
            kind: "string",
            required: true,
            description: "Sternsystem id.",
          },
          system: {
            kind: "string",
            description: "Alias for --site.",
          },
          mission: {
            kind: "string",
            description:
              "RFC-1190: Explicit mission id for evidence.sync. Falls back to releases/<id>/dist build-identity.json, then system-state.currentMission.",
          },
          "skip-evidence-sync": {
            kind: "boolean",
            description:
              "RFC-1190: Skip evidence.sync to R2 after deploy; explicit escape hatch when no mission context can be resolved.",
          },
          "gate-decision": {
            kind: "string",
            description:
              "RFC-0866: Path to GateDecisionV1 JSON file. Defaults to systems-cache/{system}/gate-decisions/{release}-main.json.",
          },
          "main-verification-decision": {
            kind: "string",
            description:
              "RFC-0866: Path to MainVerificationDecisionV1 JSON file. Auto-resolved from systems-cache/{system}/gate-decisions/{release}-main-verification.json if omitted.",
          },
          "candidate-id": {
            kind: "string",
            description: "RFC-0866: Release candidate id (defaults to --site).",
          },
          "artifact-hash": {
            kind: "string",
            description:
              "Artifact hash (sha256:... format). Auto-resolved from releases/{release}/artifact.tar.gz or release.yaml distTreeHash if omitted.",
          },
        },
        writes: [
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/bordbuch/events.ndjson",
          "releases/{release}/release.yaml",
        ],
        reads: [
          "releases/{release}/**",
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runLeitstandPromote,
      },
      {
        name: "leitstand.status",
        mutatesState: false,
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        description:
          "Print deployment state for all channels (RFC-0627). Flags: --site, [--channel dev|alt|main].",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: leitstandStatusFlags,
        reads: leitstandStatusReads,
        cacheable: false,
        execute: runLeitstandStatus,
      },
      {
        name: "leitstand.channels",
        coverage: "operator" as const,
        mutatesState: false,
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        description:
          "Alias of leitstand.status (RFC-1203): prints per-channel deployment state and names the canonical command in every response. Flags: --site, [--channel dev|alt|main].",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: leitstandStatusFlags,
        reads: leitstandStatusReads,
        cacheable: false,
        execute: runLeitstandChannels,
      },
      {
        name: "leitstand.rollback",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Rollback a site or service to a previous Cloudflare Worker deployment via native wrangler rollback (RFC-0895, RFC-0926). Flags: --site OR --service (mutually exclusive), [--channel dev|alt|main], [--to-release <releaseId>].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          site: { kind: "string", description: "Sternsystem id." },
          system: { kind: "string", description: "Alias for --site." },
          service: { kind: "string", description: "Service id from services/registry.yaml." },
          channel: {
            kind: "string",
            description: "Deployment channel for site rollback: dev, alt, or main (default).",
          },
          "to-release": {
            kind: "string",
            description:
              "Target release ID for rollback (RFC-0926). Resolves Worker Version ID from deployment-effect-records.",
          },
          "gate-decision": {
            kind: "string",
            description: "Gate decision override read via flagString (RFC-1141).",
          },
        },
        writes: [
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/bordbuch/events.ndjson",
          "../systems-cache/{system}/deployment-operations/",
          "services/registry.yaml",
        ],
        reads: [
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/deployment-operations/",
          "services/registry.yaml",
          "services/{service}/**",
        ],
        cacheable: false,
        execute: runLeitstandRollback,
      },
      {
        name: "leitstand.health",
        coverage: "operator" as const,
        mutatesState: false,
        execOnReadOnly: true,
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        description:
          "Run health checks against a deployed channel (RFC-0379, RFC-1136). Flags: --site, [--channel dev|alt|main], [--release <id>].",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          site: { kind: "string", required: true, description: "Sternsystem id." },
          system: { kind: "string", description: "Alias for --site." },
          channel: {
            kind: "string",
            description: "Deployment channel: dev, alt (default), or main.",
          },
          release: {
            kind: "string",
            description:
              "Override the deployed releaseId resolved from system-state.yaml (ad-hoc checks).",
          },
        },
        cacheable: false,
        execute: runLeitstandHealth,
      },
      {
        name: "leitstand.verify",
        coverage: "operator" as const,
        coverageNote: "post-deploy verification — requires --site",
        mutatesState: false,
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        description:
          "Verify live deployment across channels by fetching build-identity.json (RFC-0930, RFC-0931). Flags: --site, [--channel dev|alt|main], [--no-compare-local], [--timeout-ms N], [--verify-signature].",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          site: { kind: "string", required: true, description: "Sternsystem id." },
          system: { kind: "string", description: "Alias for --site." },
          channel: {
            kind: "string",
            description:
              "Filter to a single channel: dev, alt, or main. Default: all configured channels.",
          },
          "compare-local": {
            kind: "boolean",
            description:
              "Compare live build-identity.json against system-state.yaml records. Default: true.",
          },
          "timeout-ms": {
            kind: "string",
            description: "Per-channel fetch timeout in milliseconds. Default: 10000.",
          },
          "verify-signature": {
            kind: "boolean",
            description:
              "Verify Ed25519 signature on build-identity.json by fetching release-pubkey.json from each channel (RFC-0931). Default: false.",
          },
        },
        reads: [
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runLeitstandVerify,
      },
      {
        name: "leitstand.pipeline.check",
        mutatesState: false,
        contract: "leitstand",
        rules: [],
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        description:
          "Inspect deployment pipeline state for a release (RFC-0842). Flags: --release.",
        scope: "workspace",
        acceptsAllFlag: false,
        flags: {
          release: {
            kind: "string",
            required: true,
            description: "Release id to inspect.",
          },
          site: { kind: "string", description: "Sternsystem id." },
          system: { kind: "string", description: "Alias for --site." },
        },
        reads: [
          "releases/{release}/**", // scan-coverage: transient release root — releases/ is gitignored, absent on clean checkouts
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runLeitstandPipelineCheck,
      },
      {
        name: "leitstand.certify",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Produce a GateDecisionV1 JSON file via certification orchestration (RFC-0866). Gates measure the candidate artifact through a local wrangler-dev preview by default (RFC-1207). Flags: --site, --gate, --release, --artifact-hash, --target, --base-url.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          site: {
            kind: "string",
            required: true,
            description: "Sternsystem id.",
          },
          system: {
            kind: "string",
            description: "Alias for --site.",
          },
          gate: {
            kind: "string",
            required: true,
            description: "Certification gate: dev, alt, or main.",
          },
          release: {
            kind: "string",
            required: true,
            description: "Release id.",
          },
          "candidate-id": {
            kind: "string",
            description: "Release candidate id (defaults to --site).",
          },
          "artifact-hash": {
            kind: "string",
            description:
              "Artifact hash (sha256:... format). Auto-resolved from releases/{release}/artifact.tar.gz or release.yaml distTreeHash if omitted.",
          },
          "base-url": {
            kind: "string",
            description:
              "RFC-0866: Dev deployment URL for mission-check producer. Explicit override — disables candidate preview.",
          },
          target: {
            kind: "string",
            description:
              "RFC-1207: measurement target — candidate (default: boots wrangler dev on releases/<id>/dist/server) or channel (audit-only: latest succeeded dev deployment record). --base-url overrides both.",
          },
          force: {
            kind: "boolean",
            description: "RFC-0867: Bypass evidence cache and re-execute producers.",
          },
          "auto-manage-pin": {
            kind: "boolean",
            description:
              "RFC-0938: Auto-remove access PIN before certification and restore after. Default: true. Set to false to preserve RFC-0929 fail-early behavior.",
          },
        },
        writes: ["../systems-cache/{system}/gate-decisions/**"],
        reads: [
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
          "../systems-cache/{system}/gate-decisions/**",
        ],
        cacheable: false,
        execute: runLeitstandCertify,
      },
      {
        name: "leitstand.service.dev-deploy",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Deploy a shared Cloudflare Worker service to the dev channel with pre-deploy gates, lock, and health check (RFC-0806). Flags: --service.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          service: {
            kind: "string",
            required: true,
            description: "Service id from the services: key in services/registry.yaml.",
          },
          "skip-health-check": {
            kind: "boolean",
            description: "Skip post-deploy health check.",
          },
        },
        writes: ["services/registry.yaml"],
        reads: ["services/registry.yaml", "services/{service}/**"],
        execute: runLeitstandServiceDevDeploy,
      },
      {
        name: "leitstand.service.promote",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Promote a shared Cloudflare Worker service to production with pre-deploy gates, subdomain validation, lock, and health check (RFC-0806). Flags: --service.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          service: {
            kind: "string",
            required: true,
            description: "Service id from the services: key in services/registry.yaml.",
          },
          "skip-health-check": {
            kind: "boolean",
            description: "Skip post-deploy health check.",
          },
        },
        writes: ["services/registry.yaml"],
        reads: ["services/registry.yaml", "services/{service}/**"],
        execute: runLeitstandServicePromote,
      },
      {
        name: "leitstand.access.protect",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "RFC-0899: Set ACCESS_PIN secret on dev and alt channel Workers for Basic Auth access protection. Flags: --site, [--pin].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          site: {
            kind: "string",
            required: true,
            description: "Sternsystem id.",
          },
          system: {
            kind: "string",
            description: "Alias for --site.",
          },
          pin: {
            kind: "string",
            description: "4-digit PIN. Auto-generated if omitted.",
          },
        },
        writes: ["../systems-cache/{system}/system-state.yaml"],
        reads: [
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
        ],
        execute: runLeitstandAccessProtect,
      },
      {
        name: "leitstand.access.unprotect",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "RFC-0899: Remove ACCESS_PIN secret from dev and alt channel Workers. Flags: --site.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          site: {
            kind: "string",
            required: true,
            description: "Sternsystem id.",
          },
          system: {
            kind: "string",
            description: "Alias for --site.",
          },
        },
        writes: ["../systems-cache/{system}/system-state.yaml"],
        reads: [
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
        ],
        execute: runLeitstandAccessUnprotect,
      },
      {
        name: "leitstand.hotfix.dev-deploy",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Hotfix dev deploy: chain commit → validate.postbuild → reconcile → close → release → certify → deploy (RFC-0927). Flags: --site, --mission, [--message], [--force-build].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          site: {
            kind: "string",
            required: true,
            description: "Sternsystem id with an active mission.",
          },
          system: {
            kind: "string",
            description: "Alias for --site.",
          },
          mission: {
            kind: "string",
            required: true,
            description: "Open mission id with workpiece.",
          },
          message: {
            kind: "string",
            description: "Commit message for mission.git.commit. Auto-generated if omitted.",
          },
          "force-build": {
            kind: "boolean",
            description: "Force rebuild even if dist exists in release dir.",
          },
        },
        writes: [
          "missions/{mission}/**",
          "releases/{release}/**",
          "../systems-cache/{system}/gate-decisions/**",
        ],
        reads: [
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
          "missions/{mission}/workpiece/**",
        ],
        cacheable: false,
        execute: runLeitstandHotfixDevDeploy,
      },
      {
        name: "leitstand.access.status",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        description:
          "RFC-0899: Report access protection status (PIN set or not) for a Sternsystem. Flags: --site.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: false,
        flags: {
          site: {
            kind: "string",
            required: true,
            description: "Sternsystem id.",
          },
          system: {
            kind: "string",
            description: "Alias for --site.",
          },
        },
        reads: ["../systems-cache/{system}/system-state.yaml"],
        execute: runLeitstandAccessStatus,
      },
      {
        name: "leitstand.ship",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Resumable full-pipeline deployment composite (RFC-0962). Chains preflight → validate → reconcile → close → release → certify → deploy → verify → archive with RFC-0958 operation journal. Flags: --site, --mission, [--until], [--resume], [--force], [--allow-unreconciled].",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: true,
        flags: {
          site: {
            kind: "string",
            required: true,
            description: "Sternsystem id with an active mission.",
          },
          system: {
            kind: "string",
            description: "Alias for --site.",
          },
          mission: {
            kind: "string",
            required: true,
            description: "Open mission id with workpiece.",
          },
          until: {
            kind: "string",
            description:
              "Stop after reaching this phase: validated, closed, dev, alt, main, archived (default: archived).",
          },
          resume: {
            kind: "boolean",
            description: "Resume from the last incomplete ship operation.",
          },
          force: {
            kind: "boolean",
            description:
              "Delete stale ship journal and start a fresh operation instead of resuming.",
          },
          "allow-unreconciled": {
            kind: "boolean",
            description:
              "Downgrade the workpiece-ahead-of-cache-clone preflight gate (RFC-1217) to a warning — manual-merge escape hatch.",
          },
        },
        writes: [
          "missions/{mission}/**",
          "releases/{release}/**",
          "../systems-cache/{system}/gate-decisions/**",
          "../systems-cache/{system}/operations/**",
        ],
        reads: [
          "../systems-cache/{system}/system-config.yaml",
          "../systems-cache/{system}/system-state.yaml",
          "missions/{mission}/workpiece/**",
        ],
        cacheable: false,
        execute: runLeitstandShip,
      },
      {
        name: "leitstand.ship.status",
        coverage: "operator" as const,
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Read-only renderer for ship operation journals (RFC-1168). Resolves systems-cache/<site>/operations/ship-<mission>.jsonl — or the site's newest ship journal — and prints the step table with durations and running state. Flags: --site, --mission, [--follow] (mtime poll, exits on op-done/op-abandoned or journal loss), --json. Emits nothing without a journal — missing journal is informational, not an error.",
        scope: "workspace",
        acceptsAllFlag: false,
        mutatesState: false,
        flags: {
          site: {
            kind: "string",
            description:
              "Sternsystem id — resolves systems-cache/<site>/operations/. Optional when --mission is given (all cache clones scanned).",
          },
          system: {
            kind: "string",
            description: "Alias for --site.",
          },
          mission: {
            kind: "string",
            description:
              "Mission id — resolves ship-<mission>.jsonl. Optional when --site is given (newest journal by mtime wins).",
          },
          follow: {
            kind: "boolean",
            description:
              "Tail the journal (~1s mtime poll) printing step transitions until a terminal event or journal loss.",
          },
        },
        writes: [],
        reads: ["../systems-cache/{system}/operations/ship-*.jsonl"],
        cacheable: true,
        execute: runLeitstandShipStatus,
      },
    ],
    pipelines: [],
  };
}
