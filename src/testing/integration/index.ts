/*
<MODULE_CONTRACT>
<purpose>testing integration index — re-export the integration test helpers surface.</purpose>
<non-goals>
  <item>Do not implement integration tests here — helpers live in sibling modules.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export type {
  IntegrationRunResult,
  IntegrationTestSummary,
  IntegrationEvidence,
} from "./types.ts";
