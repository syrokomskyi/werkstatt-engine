/*
<MODULE_CONTRACT>
<purpose>migrators index — re-exports for the migrator subsystem public surface (RFC-0479).</purpose>
<non-goals>
  <item>Do not re-export registry internals — only the public API.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0479: initial migrator barrel.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export type { Migrator, SternsystemData, MigrationContext, MigrationViolation } from "./types.ts";
export { MigrationError } from "./types.ts";
export { migratorRegistry, migratorsToApply, numericRfcId } from "./registry.ts";
