/*
<MODULE_CONTRACT>
<purpose>sichtpass index — re-export the sichtpass public surface for consumers.</purpose>
<non-goals>
  <item>Do not implement sichtpass logic here — it lives in sibling modules.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export { runSichtpassGenerate } from "./sichtpass-generate.ts";
export type {
  SichtpassSiteSnapshot,
  SichtpassBordbuchMetadata,
  SichtpassChannelState,
  SichtpassPseoModule,
} from "./sichtpass-snapshot.ts";
