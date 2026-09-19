/*
<MODULE_CONTRACT>
  <purpose>Forwarding module — desired-state contract sunk to @warpgogol/werkstatt-shared/kernel per RFC-1104. Preserves the @warpgogol/werkstatt-engine/runtime/desired-state subpath for existing consumers.</purpose>
  <non-goals>
    <item>Does not declare desired-state types locally — canonical definitions live in werkstatt-shared.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1104: converted to forwarding module after desired-state sank to werkstatt-shared.</item>
</CHANGE_SUMMARY>
*/

export * from "@warpgogol/werkstatt-shared/kernel/desired-state";
