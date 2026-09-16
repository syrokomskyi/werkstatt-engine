/*
<MODULE_CONTRACT>
  <purpose>e2e index — barrel exports for the e2e cold run command family (RFC-0965).</purpose>
  <non-goals>
    <item>Do not re-export Node-only modules — this barrel may be imported by client-side code.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0965: initial barrel exporting ColdRunReport, ColdRunStep, ColdRunPhase, and runColdE2e.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export { runColdE2e } from "./cold.ts";
export type { ColdRunReport, ColdRunStep, ColdRunPhase } from "./cold.ts";
