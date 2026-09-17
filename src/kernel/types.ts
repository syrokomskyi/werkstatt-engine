/*
<MODULE_CONTRACT>
  <purpose>Forwarding module — kernel contract types sunk to @warpgogol/werkstatt-shared/kernel per RFC-1104. Preserves the @warpgogol/werkstatt-engine/kernel/types subpath for existing consumers.</purpose>
  <non-goals>Does not declare kernel types locally — canonical definitions live in werkstatt-shared.</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1104: converted to forwarding module after kernel contract cluster sank to werkstatt-shared.</item>
</CHANGE_SUMMARY>
*/

export * from "@warpgogol/werkstatt-shared/kernel";
