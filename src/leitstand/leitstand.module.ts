/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0358/0379/0608 Leitstand fleet propagation commands: propagate, promote, status, rollback, and health.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel leitstand/index.ts remains the public API surface.</item>
    <item>Do not register release or notausgang commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>Lazy loading refactor: extracted from leitstand/index.ts to use dynamic imports inside async register().</item>
  <item>RFC-0627: add leitstand.deploy; update rollback (auto-detect channel); update status/health for dev channel.</item>
  <item>RFC-0628: replace leitstand.deploy with workpiece-based leitstand.dev-deploy; propagate gate checks published + commitSha + missionId; rollback auto-step removes dev-deployed.</item>
  <item>RFC-0700: add --release flag to leitstand.dev-deploy for deploying existing releases to dev without open mission; update reads to include releases/{release}/**.</item>
  <item>RFC-0842: add leitstand.pipeline.check command for release pipeline state inspection.</item>
  <item>RFC-0866: add leitstand.certify command; add --gate-decision, --candidate-id, --artifact-hash flags to dev-deploy, propagate, promote.</item>
  <item>Fix description flags for dev-deploy, propagate, promote to include --site (KERNEL-FLAG-06).</item>
  <item>RFC-0899: add leitstand.access.protect, unprotect, status commands for dev/alt subdomain PIN access protection.</item>
  <item>RFC-0927: add leitstand.hotfix.dev-deploy composite command chaining commit → validate.postbuild → reconcile → close → release → certify → deploy.</item>
  <item>RFC-0930: add leitstand.verify command for live deployment verification across channels.</item>
  <item>RFC-0962: add leitstand.ship composite command — resumable full-pipeline deployment via RFC-0958 operation journal.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createLeitstandModule(): KernelModule {
  return {
    name: "leitstand",
    version: "0.1.0",
    async register(registry) {
      const {
        runLeitstandDevDeploy,
        runLeitstandPropagate,
        runLeitstandPromote,
        runLeitstandStatus,
        runLeitstandRollback,
        runLeitstandHealth,
        runLeitstandPipelineCheck,
        runLeitstandHotfixDevDeploy,
        runLeitstandVerify,
      } = await import("./leitstand-commands.ts");
      const { runLeitstandCertify } = await import("./certify.ts");
      const { runLeitstandShip } = await import("./ship.ts");
      registry.registerCommand({
        name: "leitstand.dev-deploy",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Deploy workpiece to dev channel with Axiom verification gate (RFC-0628). Flags: --site, [--release].",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
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
          "skip-evidence-sync": {
            kind: "boolean",
            description: "RFC-0652: Skip best-effort evidence.sync to R2 after axiom.report.",
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
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
          "missions/{mission}/workpiece/**",
          "releases/{release}/**",
        ],
        cacheable: false,
        execute: runLeitstandDevDeploy,
      });
      registry.registerCommand({
        name: "leitstand.propagate",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Deploy a published release with verified Axiom evidence to the alt channel (RFC-0628). Flags: --site, --release.",
        scope: "workspace",
        supportsAllSites: false,
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
          "systems-cache/{system}/system-state.yaml",
          "systems-cache/{system}/bordbuch/events.ndjson",
          "releases/{release}/release.yaml",
        ],
        reads: [
          "releases/{release}/**",
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runLeitstandPropagate,
      });
      registry.registerCommand({
        name: "leitstand.promote",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Promote a verified alt-deployed release to the main channel with live build-identity verification (RFC-0608). Flags: --site, --release.",
        scope: "workspace",
        supportsAllSites: false,
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
          "systems-cache/{system}/system-state.yaml",
          "systems-cache/{system}/bordbuch/events.ndjson",
          "releases/{release}/release.yaml",
        ],
        reads: [
          "releases/{release}/**",
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runLeitstandPromote,
      });
      registry.registerCommand({
        name: "leitstand.status",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        description:
          "Print deployment state for all channels (RFC-0627). Flags: --site, [--channel dev|alt|main].",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          site: { kind: "string", required: true, description: "Sternsystem id." },
          system: { kind: "string", description: "Alias for --site." },
          channel: {
            kind: "string",
            description: "Filter to a single channel: dev, alt, or main.",
          },
        },
        reads: [
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
          "systems-cache/{system}/system.pin.json",
        ],
        cacheable: false,
        execute: runLeitstandStatus,
      });
      registry.registerCommand({
        name: "leitstand.rollback",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Rollback a site or service to a previous Cloudflare Worker deployment via native wrangler rollback (RFC-0895, RFC-0926). Flags: --site OR --service (mutually exclusive), [--channel dev|alt|main], [--to-release <releaseId>].",
        scope: "workspace",
        supportsAllSites: false,
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
        },
        writes: [
          "systems-cache/{system}/system-state.yaml",
          "systems-cache/{system}/bordbuch/events.ndjson",
          "systems-cache/{system}/deployment-operations/",
          "services/registry.yaml",
        ],
        reads: [
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
          "systems-cache/{system}/deployment-operations/",
          "services/registry.yaml",
          "services/{service}/**",
        ],
        cacheable: false,
        execute: runLeitstandRollback,
      });
      registry.registerCommand({
        name: "leitstand.health",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        description:
          "Run health checks against a deployed channel (RFC-0379). Flags: --site, [--channel dev|alt|main].",
        scope: "workspace",
        supportsAllSites: false,
        flags: {
          site: { kind: "string", required: true, description: "Sternsystem id." },
          system: { kind: "string", description: "Alias for --site." },
          channel: {
            kind: "string",
            description: "Deployment channel: dev, alt (default), or main.",
          },
        },
        cacheable: false,
        execute: runLeitstandHealth,
      });
      registry.registerCommand({
        name: "leitstand.verify",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        description:
          "Verify live deployment across channels by fetching build-identity.json (RFC-0930, RFC-0931). Flags: --site, [--channel dev|alt|main], [--no-compare-local], [--timeout-ms N], [--verify-signature].",
        scope: "workspace",
        supportsAllSites: false,
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
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runLeitstandVerify,
      });
      registry.registerCommand({
        name: "leitstand.pipeline.check",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        description:
          "Inspect deployment pipeline state for a release (RFC-0842). Flags: --release.",
        scope: "workspace",
        supportsAllSites: false,
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
          "releases/{release}/**",
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
        ],
        cacheable: false,
        execute: runLeitstandPipelineCheck,
      });
      registry.registerCommand({
        name: "leitstand.certify",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Produce a GateDecisionV1 JSON file via certification orchestration (RFC-0866). Flags: --site, --gate, --release, --artifact-hash.",
        scope: "workspace",
        supportsAllSites: false,
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
              "RFC-0866: Dev deployment URL for mission-check producer. Defaults to latest dev effect record URL.",
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
        writes: ["systems-cache/{system}/gate-decisions/**"],
        reads: [
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
          "systems-cache/{system}/gate-decisions/**",
        ],
        cacheable: false,
        execute: runLeitstandCertify,
      });

      const { runLeitstandServiceDevDeploy } = await import("./service-dev-deploy.ts");
      const { runLeitstandServicePromote } = await import("./service-promote.ts");
      registry.registerCommand({
        name: "leitstand.service.dev-deploy",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Deploy a shared Cloudflare Worker service to the dev channel with pre-deploy gates, lock, and health check (RFC-0806). Flags: --service.",
        scope: "workspace",
        supportsAllSites: false,
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
      });
      registry.registerCommand({
        name: "leitstand.service.promote",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Promote a shared Cloudflare Worker service to production with pre-deploy gates, subdomain validation, lock, and health check (RFC-0806). Flags: --service.",
        scope: "workspace",
        supportsAllSites: false,
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
      });

      const { runLeitstandAccessProtect, runLeitstandAccessUnprotect, runLeitstandAccessStatus } =
        await import("./access-commands.ts");
      registry.registerCommand({
        name: "leitstand.access.protect",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "RFC-0899: Set ACCESS_PIN secret on dev and alt channel Workers for Basic Auth access protection. Flags: --site, [--pin].",
        scope: "workspace",
        supportsAllSites: false,
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
        writes: ["systems-cache/{system}/system-state.yaml"],
        reads: [
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
        ],
        execute: runLeitstandAccessProtect,
      });
      registry.registerCommand({
        name: "leitstand.access.unprotect",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "RFC-0899: Remove ACCESS_PIN secret from dev and alt channel Workers. Flags: --site.",
        scope: "workspace",
        supportsAllSites: false,
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
        writes: ["systems-cache/{system}/system-state.yaml"],
        reads: [
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
        ],
        execute: runLeitstandAccessUnprotect,
      });
      registry.registerCommand({
        name: "leitstand.hotfix.dev-deploy",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Hotfix dev deploy: chain commit → validate.postbuild → reconcile → close → release → certify → deploy (RFC-0927). Flags: --site, --mission, [--message], [--force-build].",
        scope: "workspace",
        supportsAllSites: false,
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
          "systems-cache/{system}/gate-decisions/**",
        ],
        reads: [
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
          "missions/{mission}/workpiece/**",
        ],
        cacheable: false,
        execute: runLeitstandHotfixDevDeploy,
      });
      registry.registerCommand({
        name: "leitstand.access.status",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        description:
          "RFC-0899: Report access protection status (PIN set or not) for a Sternsystem. Flags: --site.",
        scope: "workspace",
        supportsAllSites: false,
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
        reads: ["systems-cache/{system}/system-state.yaml"],
        execute: runLeitstandAccessStatus,
      });
      registry.registerCommand({
        name: "leitstand.ship",
        modulePath: "packages/werkstatt-engine/src/leitstand/leitstand.module.ts",
        generates: [],
        description:
          "Resumable full-pipeline deployment composite (RFC-0962). Chains preflight → validate → reconcile → close → release → certify → deploy → verify → archive with RFC-0958 operation journal. Flags: --site, --mission, [--until], [--resume].",
        scope: "workspace",
        supportsAllSites: false,
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
        },
        writes: [
          "missions/{mission}/**",
          "releases/{release}/**",
          "systems-cache/{system}/gate-decisions/**",
          "systems-cache/{system}/operations/**",
        ],
        reads: [
          "systems-cache/{system}/system-config.yaml",
          "systems-cache/{system}/system-state.yaml",
          "missions/{mission}/workpiece/**",
        ],
        cacheable: false,
        execute: runLeitstandShip,
      });
    },
  };
}
