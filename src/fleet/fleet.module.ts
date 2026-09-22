/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0964 fleet commands: fleet.sites.generate, fleet.apply.
  RFC-0967: fleet.ownership.register, fleet.ownership.verify, fleet.ownership.transfer.
  RFC-1124: fleet.claims.init, fleet.claims.publish, fleet.claims.sync, fleet.claims.verify, fleet.claims.status.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel fleet/index.ts remains the public API surface.</item>
    <item>Do not register sternsystem, mission, or leitstand commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0964: initial fleet module — fleet.sites.generate (moved from werkstatt-site), fleet.apply (wave orchestration).</item>
  <item>RFC-0967: add fleet.ownership.register, fleet.ownership.verify, fleet.ownership.transfer commands.</item>
  <item>RFC-1124: add fleet.claims.* commands — git-native claims registry as permissioned-era ownership authority.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createFleetModule(): Promise<ModuleExport> {
  const { runFleetSitesGenerate } = await import("./fleet-sites-generate.ts");
  const { runFleetApply } = await import("./apply.ts");
  const { runFleetOwnershipRegister, runFleetOwnershipVerify, runFleetOwnershipTransfer } =
    await import("./ownership-commands.ts");
  const {
    runFleetClaimsInit,
    runFleetClaimsPublish,
    runFleetClaimsSync,
    runFleetClaimsVerify,
    runFleetClaimsStatus,
  } = await import("./claims-commands.ts");
  return {
    name: "fleet",
    version: "0.1.0",
    declarations: [],
    commands: [
      {
        name: "fleet.sites.generate",
        modulePath: "packages/werkstatt-engine/src/fleet/fleet.module.ts",
        description:
          "Generate fleet/fleet.sites.yaml from RFC-0790 convention-based discovery (systems-cache). Enriched with platformVersion, channels, mirrors, activeMission, canary fields (RFC-0964).",
        scope: "workspace",
        flags: {},
        mutatesState: true,
        writes: ["fleet/fleet.sites.yaml"],
        generates: [],
        reads: [
          "../systems-cache/*/system-config.yaml",
          "../systems-cache/*/system.pin.json",
          "../systems-cache/*/system-state.yaml",
        ],
        execute: runFleetSitesGenerate,
      },
      {
        name: "fleet.apply",
        modulePath: "packages/werkstatt-engine/src/fleet/fleet.module.ts",
        description:
          "Cross-site wave orchestration: run a command or pipeline across fleet sites with canary-first waves, concurrency, stop-threshold, and journal-backed resume (RFC-0964).",
        scope: "workspace",
        flags: {
          run: {
            kind: "string",
            required: true,
            description:
              "Command or pipeline to run per site. Prefix with 'pipeline ' for pipelines.",
          },
          sites: {
            kind: "string",
            description: "Comma-separated site ids to target. Mutually exclusive with --all-sites.",
          },
          "all-sites": { kind: "boolean", description: "Target all discovered sites." },
          wave: {
            kind: "string",
            description: "Wave selection: canary, rest, or all (default: all).",
          },
          concurrency: {
            kind: "string",
            description: "Max parallel site invocations per wave (default: 1).",
          },
          "stop-after-failures": {
            kind: "string",
            description: "Abort after N failures across all waves (default: 1).",
          },
          resume: { kind: "string", description: "Resume a previous operation by opId." },
          json: { kind: "boolean", description: "Output as JSON." },
        },
        mutatesState: true,
        writes: ["fleet/operations/{opId}.jsonl", "fleet/reports/{opId}.json"],
        generates: [],
        reads: [
          "fleet/fleet.sites.yaml",
          "../systems-cache/*/system-config.yaml",
          "../systems-cache/*/system-state.yaml",
        ],
        execute: runFleetApply,
      },
      {
        name: "fleet.ownership.register",
        modulePath: "packages/werkstatt-engine/src/fleet/fleet.module.ts",
        description:
          "Register a site's ownership claim in the fleet ownership registry (RFC-0967). Reads passport from cache clone and sends it to the registry Worker.",
        scope: "workspace",
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem ID to register." },
          json: { kind: "boolean", description: "Output as JSON." },
        },
        mutatesState: false,
        writes: [],
        generates: [],
        reads: ["../systems-cache/*/passport.json"],
        requiresNetwork: true,
        execute: runFleetOwnershipRegister,
      },
      {
        name: "fleet.ownership.verify",
        modulePath: "packages/werkstatt-engine/src/fleet/fleet.module.ts",
        description:
          "Verify a site's ownership claim in the fleet ownership registry (RFC-0967). Returns the current claim or not-registered status.",
        scope: "workspace",
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem ID to verify." },
          json: { kind: "boolean", description: "Output as JSON." },
        },
        mutatesState: false,
        writes: [],
        generates: [],
        reads: ["../systems-cache/*/passport.json"],
        requiresNetwork: true,
        execute: runFleetOwnershipVerify,
      },
      {
        name: "fleet.ownership.transfer",
        modulePath: "packages/werkstatt-engine/src/fleet/fleet.module.ts",
        description:
          "Transfer ownership of a site to a new instance after a handover (RFC-0967, RFC-0968). Requires a signed handover authorization file.",
        scope: "workspace",
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem ID to transfer." },
          authorization: {
            kind: "string",
            required: true,
            description: "Path to the signed handover authorization JSON file.",
          },
          json: { kind: "boolean", description: "Output as JSON." },
        },
        mutatesState: false,
        writes: [],
        generates: [],
        reads: ["../systems-cache/*/passport.json"],
        requiresNetwork: true,
        execute: runFleetOwnershipTransfer,
      },
      {
        name: "fleet.claims.init",
        modulePath: "packages/werkstatt-engine/src/fleet/fleet.module.ts",
        description:
          "Point this workshop at the per-fleet claims repository (RFC-1124). Writes werkstatt.fleet.json and clones/inits the local claims repo. Idempotent.",
        scope: "workspace",
        flags: {
          remote: {
            kind: "string",
            required: true,
            description: "Remote URL(s) of the claims repo, comma-separated for multiple.",
          },
          "local-path": {
            kind: "string",
            description: "Local clone path (default: .werkstatt/fleet-claims).",
          },
          "worker-url": {
            kind: "string",
            description: "Optional RFC-0967 Worker URL — accelerator only, never required.",
          },
          json: { kind: "boolean", description: "Output as JSON." },
        },
        mutatesState: true,
        writes: ["werkstatt.fleet.json", ".werkstatt/fleet-claims/"],
        generates: [],
        reads: [],
        execute: runFleetClaimsInit,
      },
      {
        name: "fleet.claims.publish",
        modulePath: "packages/werkstatt-engine/src/fleet/fleet.module.ts",
        description:
          "Publish or refresh the signed ownership claim for a system into the fleet claims repo (RFC-1124). Called automatically by mission.close / sternsystem.register / sternsystem.handover.complete; manual use for repair.",
        scope: "workspace",
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem ID to claim." },
          "no-push": {
            kind: "boolean",
            description: "Commit locally without pushing (offline; pushed on next sync).",
          },
          "authorization-hash": {
            kind: "string",
            description: "Transfer claims only: sha256 of handover-authorization.json.",
          },
          json: { kind: "boolean", description: "Output as JSON." },
        },
        mutatesState: true,
        writes: [".werkstatt/fleet-claims/claims/{id}.json"],
        generates: [],
        reads: [
          "werkstatt.fleet.json",
          "../systems-cache/*/passport.json",
          "../systems-cache/*/bordbuch/",
        ],
        execute: runFleetClaimsPublish,
      },
      {
        name: "fleet.claims.sync",
        modulePath: "packages/werkstatt-engine/src/fleet/fleet.module.ts",
        description:
          "Fetch all claims remotes, fast-forward the local clone, verify all claim signatures, and push pending claims (RFC-1124). Non-fast-forward divergence is a manual-resolution diagnostic — never auto-merged.",
        scope: "workspace",
        flags: {
          json: { kind: "boolean", description: "Output as JSON." },
        },
        mutatesState: true,
        writes: [".werkstatt/fleet-claims/", ".werkstatt/fleet-claims-state.json"],
        generates: [],
        reads: ["werkstatt.fleet.json"],
        requiresNetwork: true,
        execute: runFleetClaimsSync,
      },
      {
        name: "fleet.claims.verify",
        modulePath: "packages/werkstatt-engine/src/fleet/fleet.module.ts",
        description:
          "Resolve the current ownership claim for a system entirely offline (RFC-1124): signature + legitimacy (self-claim vs transfer claim via bordbuch handover event) + LWW. Exits 1 on invalid-signature or stale; no-claim is informational.",
        scope: "workspace",
        flags: {
          id: { kind: "string", required: true, description: "Sternsystem ID to verify." },
          json: { kind: "boolean", description: "Output as JSON." },
        },
        mutatesState: false,
        writes: [],
        generates: [],
        reads: [
          "werkstatt.fleet.json",
          ".werkstatt/fleet-claims/",
          "../systems-cache/*/passport.json",
          "../systems-cache/*/bordbuch/",
        ],
        execute: runFleetClaimsVerify,
      },
      {
        name: "fleet.claims.status",
        modulePath: "packages/werkstatt-engine/src/fleet/fleet.module.ts",
        description:
          "Show local claims clone vs remote state, pending unpushed claims, and last sync time (RFC-1124). Fully offline.",
        scope: "workspace",
        flags: {
          json: { kind: "boolean", description: "Output as JSON." },
        },
        mutatesState: false,
        writes: [],
        generates: [],
        reads: ["werkstatt.fleet.json", ".werkstatt/fleet-claims/"],
        execute: runFleetClaimsStatus,
      },
    ],
    pipelines: [],
  };
}
