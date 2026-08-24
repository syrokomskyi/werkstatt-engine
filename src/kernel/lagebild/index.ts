/*
<MODULE_CONTRACT>
<purpose>Barrel export for the Lagebild tenant and sync-worker command domain.</purpose>
<non-goals>
  <item>Do not implement tenant registry mutations or worker deployment logic here.</item>
  <item>Do not read secrets; handlers receive all runtime context from kernel execution.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0264 cleanup: introduce a Lagebild subpath barrel so the root site-kernel entrypoint can delegate the domain as one unit.</item>
</CHANGE_SUMMARY>
*/

export { lagebildModule } from "./lagebild.module.ts";
export * from "./handlers.ts";
export type * from "./types.ts";
