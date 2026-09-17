/*
<MODULE_CONTRACT>
  <purpose>signing index — forwarding barrel for the Ed25519 signing core sunk to @warpgogol/werkstatt-shared/signing per RFC-1104. Preserves the engine/signing package specifier for existing consumers.</purpose>
  <non-goals>
    <item>Does not implement logic — canonical signing core lives in werkstatt-shared.</item>
    <item>Does not re-export signing-commands.ts — that engine module is reachable via its own subpath.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1104: converted to forwarding barrel — signing core re-exported from werkstatt-shared/signing.</item>
</CHANGE_SUMMARY>
*/

export * from "@warpgogol/werkstatt-shared/signing";
