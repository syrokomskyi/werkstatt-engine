/*
<MODULE_CONTRACT>
<purpose>Check runtime type placeholder — ensures kernel types are available in app tooling.</purpose>
<non-goals>
  <item>Do not implement logic here — this file is a type placeholder.</item>
</non-goals>
</MODULE_CONTRACT>
<KEY_DECISIONS>
  <item>TODO: record current design decisions</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/
import type { KernelCommandInput, KernelCommandResult, KernelRuntimeContext } from "@warpgogol/werkstatt-engine/kernel";
void ({} as { input?: KernelCommandInput; result?: KernelCommandResult; context?: KernelRuntimeContext });
