/*
<MODULE_CONTRACT>
<purpose>Lazy-loading kernel module for RFC-0651 evidence commands: evidence.sync and evidence.fetch.</purpose>


<non-goals>
  <item>Does not re-export types or utilities — the barrel index.ts remains the public API surface.</item>
  <item>Does not integrate with mission.close or leitstand.dev-deploy — that is RFC-0652.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0651: initial evidence module with evidence.sync and evidence.fetch commands.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { ModuleExport } from "@warpgogol/werkstatt-shared/kernel";

export async function createEvidenceModule(): Promise<ModuleExport> {
  const { runEvidenceSync } = await import("./evidence-sync.ts");
      const { runEvidenceFetch } = await import("./evidence-fetch.ts");
  return {
    name: "evidence",
    version: "0.1.0",
      declarations: [],
  commands: [
    {
        name: "evidence.sync",
        modulePath: "packages/werkstatt-engine/src/evidence/evidence-module.ts",
        generates: [],
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
      },
    {
        name: "evidence.fetch",
        modulePath: "packages/werkstatt-engine/src/evidence/evidence-module.ts",
        generates: [],
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
      }
  ],
  pipelines: [

  ]};
}
