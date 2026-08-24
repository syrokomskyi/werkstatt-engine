/*
<MODULE_CONTRACT>
<purpose>RFC-0479: re-exports for the migrator subsystem.</purpose>
<non-goals>
  <item>Do not re-export registry internals — only the public API.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0479: initial migrator barrel.</item>
</CHANGE_SUMMARY>
*/

export type { Migrator, SternsystemData, MigrationContext, MigrationViolation } from "./types.ts";
export { MigrationError } from "./types.ts";
export { migratorRegistry, migratorsToApply, numericRfcId } from "./registry.ts";
