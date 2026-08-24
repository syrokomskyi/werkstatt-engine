/*
<MODULE_CONTRACT>
<purpose>
  RFC-0345: idempotent file-write primitive. Canonical implementation now lives
  in @warpgogol/forge/src/utils/fs-idempotent.ts (RFC-0556 dependency inversion).
  This file re-exports it for imports from @warpgogol/werkstatt-engine/kernel.
</purpose>
<non-goals>
  <item>Do not duplicate the implementation — always re-export from forge.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0345: initial idempotent write primitive.</item>
  <item>RFC-0556: moved canonical implementation to @warpgogol/forge, this file is now a re-export.</item>
</CHANGE_SUMMARY>
*/

export { writeFileIfChanged } from "@warpgogol/forge/utils";
