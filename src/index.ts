/*
<MODULE_CONTRACT>
<purpose>index barrel exports for @warpgogol/werkstatt-engine — the public engine entrypoint surface.</purpose>
<non-goals>
  <item>Do not re-export Node-only modules — this barrel may be imported by client-side code.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0770: initial barrel exporting plugin contract types and registry.</item>
  <item>RFC-0942: remove legacy plugin contract re-exports.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/
