/*
<MODULE_CONTRACT>
  <purpose>Forwarding module — workspace IO contract sunk to @warpgogol/werkstatt-shared/kernel per RFC-1104. Preserves the @warpgogol/werkstatt-engine/kernel/workspace-io subpath for existing consumers.</purpose>
  <non-goals>
    <item>Does not implement workspace IO locally — canonical implementation lives in werkstatt-shared.</item>
  </non-goals>
  <!-- @ai-invariant Forwarding shim — re-export only; do not add local declarations (canonical IO lives in werkstatt-shared). -->
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Forwarding shim re-exports the canonical werkstatt-shared workspace-io contract verbatim — no local implementation.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1104: converted to forwarding module after workspace-io sank to werkstatt-shared.</item>
</CHANGE_SUMMARY>
*/

export * from "@warpgogol/werkstatt-shared/kernel/workspace-io";
