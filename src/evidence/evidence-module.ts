/*
<MODULE_CONTRACT>
<purpose>Lazy-loading kernel module for RFC-0651 evidence commands: evidence.sync and evidence.fetch.</purpose>
<keywords>evidence, sync, fetch, r2, module</keywords>
<responsibilities>
  <item>Registers evidence.sync and evidence.fetch kernel commands.</item>
  <item>Uses dynamic imports inside async register() for lazy loading.</item>
</responsibilities>
<non-goals>
  <item>Does not re-export types or utilities — the barrel index.ts remains the public API surface.</item>
  <item>Does not integrate with mission.close or leitstand.dev-deploy — that is RFC-0652.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0651: initial evidence module with evidence.sync and evidence.fetch commands.</item>
</CHANGE_SUMMARY>
*/

import type { KernelModule } from "@warpgogol/werkstatt-engine/kernel";

export function createEvidenceModule(): KernelModule {
  return {
    name: "evidence",
    version: "0.1.0",
    async register(registry) {
      const { runEvidenceSync } = await import("./evidence-sync.ts");
      const { runEvidenceFetch } = await import("./evidence-fetch.ts");

      registry.registerCommand({
        name: "evidence.sync",
        description:
          "RFC-0651: upload all evidence artifacts from missions/{mission}/evidence/axiom/ to R2 " +
          "under {systemId}/{missionId}/{runTimestamp}/ key prefix. Reads runTimestamp from " +
          "evidence-metadata.json (or --run-timestamp flag). Supports --dry-run. " +
          "Failure modes: MISSING_ENV, NOT_FOUND, INVALID_EVIDENCE, R2_UPLOAD_ERROR.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        cacheable: false,
        flags: {
          mission: {
            kind: "string",
            required: true,
            description: "Mission id (e.g. warpgogol-com-m000025).",
          },
          "run-timestamp": {
            kind: "string",
            description:
              "Explicit run timestamp (YYYY-MM-DDTHH-MM-SS-mmmZ). Defaults to evidence-metadata.json runTimestamp.",
          },
          "dry-run": {
            kind: "boolean",
            description: "Report what would be uploaded without making R2 API calls.",
          },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: [
          "missions/{mission}/evidence/axiom/**",
          "systems-cache/*/system-config.yaml",
          "systems-cache/*/system-state.yaml",
        ],
        writes: [],
        execute: runEvidenceSync,
      });

      registry.registerCommand({
        name: "evidence.fetch",
        description:
          "RFC-0651: download a historical evidence run from R2 to a local directory, " +
          "or list available runs via ListObjectsV2. Uses --run-timestamp to select a run, " +
          "--output-dir to specify the download location, --no-raw to skip raw/ artifacts, " +
          "--list to list available runs. Failure modes: MISSING_ENV, NOT_FOUND, R2_LIST_ERROR.",
        scope: "workspace",
        supportsAllSites: false,
        mutatesState: false,
        cacheable: false,
        flags: {
          mission: {
            kind: "string",
            required: true,
            description: "Mission id (e.g. warpgogol-com-m000025).",
          },
          "run-timestamp": {
            kind: "string",
            description:
              "Run timestamp to fetch (YYYY-MM-DDTHH-MM-SS-mmmZ). Required unless --list.",
          },
          "output-dir": {
            kind: "string",
            description: "Local directory to download evidence to. Required unless --list.",
          },
          "no-raw": {
            kind: "boolean",
            description: "Skip raw/ artifacts — download only structured JSON and report.html.",
          },
          list: {
            kind: "boolean",
            description: "List available runs for the mission instead of fetching.",
          },
          json: { kind: "boolean", description: "Output JSON result." },
        },
        reads: ["systems-cache/*/system-config.yaml", "systems-cache/*/system-state.yaml"],
        writes: ["{--output-dir}/**"],
        execute: runEvidenceFetch,
      });
    },
  };
}
