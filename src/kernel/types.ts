/*
<MODULE_CONTRACT>
  <purpose>Forwarding module — kernel contract types sunk to @warpgogol/werkstatt-shared/kernel per RFC-1104. Preserves the @warpgogol/werkstatt-engine/kernel/types subpath for existing consumers.</purpose>
  <non-goals>
    <item>Does not declare kernel types locally — canonical definitions live in werkstatt-shared.</item>
  </non-goals>
  <!-- @ai-invariant Forwarding shim — re-export only; do not add local declarations (canonical types live in werkstatt-shared). -->
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>Forwarding shim re-exports the canonical werkstatt-shared contract verbatim — no local type declarations.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1104: converted to forwarding module after kernel contract cluster sank to werkstatt-shared.</item>
</CHANGE_SUMMARY>
*/

export * from "@warpgogol/werkstatt-shared/kernel/types";
