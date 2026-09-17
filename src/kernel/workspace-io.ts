/*
<MODULE_CONTRACT>
  <purpose>Forwarding module — workspace IO contract sunk to @warpgogol/werkstatt-shared/kernel per RFC-1104. Preserves the @warpgogol/werkstatt-engine/kernel/workspace-io subpath for existing consumers.</purpose>
  <non-goals>Does not implement workspace IO locally — canonical implementation lives in werkstatt-shared.</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1104: converted to forwarding module after workspace-io sank to werkstatt-shared.</item>
</CHANGE_SUMMARY>
*/

export * from "@warpgogol/werkstatt-shared/kernel/workspace-io";
