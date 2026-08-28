/*
<MODULE_CONTRACT>
  <purpose>Lazy-loading kernel module for RFC-0964 fleet commands: fleet.sites.generate, fleet.apply.
  RFC-0967: fleet.ownership.register, fleet.ownership.verify, fleet.ownership.transfer.</purpose>
  <non-goals>
    <item>Do not re-export types or utilities — the barrel fleet/index.ts remains the public API surface.</item>
    <item>Do not register sternsystem, mission, or leitstand commands here.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0964: initial fleet module — fleet.sites.generate (moved from werkstatt-site), fleet.apply (wave orchestration).</item>
  <item>RFC-0967: add fleet.ownership.register, fleet.ownership.verify, fleet.ownership.transfer commands.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "../kernel/types.ts";

export function createFleetModule(): KernelModule {
  return {
    name: "fleet",
    version: "0.1.0",
    async register(registry) {
      const { runFleetSitesGenerate } = await import("./fleet-sites-generate.ts");
      registry.registerCommand({
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
      });

      const { runFleetApply } = await import("./apply.ts");
      registry.registerCommand({
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
      });

      const { runFleetOwnershipRegister, runFleetOwnershipVerify, runFleetOwnershipTransfer } =
        await import("./ownership-commands.ts");
      registry.registerCommand({
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
      });

      registry.registerCommand({
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
      });

      registry.registerCommand({
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
      });
    },
  };
}
