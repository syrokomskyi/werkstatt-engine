/*
<MODULE_CONTRACT>
<purpose>
Re-export barrel for the ADR domain. The ADR module has migrated to
@warpgogol/forge/os/adr (RFC-0521). This file preserves the
@warpgogol/werkstatt-engine/kernel/adr import path for backward compatibility.
</purpose>
<non-goals>
  <item>Do not re-implement ADR logic here — all logic lives in @warpgogol/forge/os/adr.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0366: expose adrModule and ADR types from the ADR domain.</item>
  <item>RFC-0521: replaced site-kernel ADR implementation with re-export from @warpgogol/forge/os/adr.</item>
</CHANGE_SUMMARY>
*/

export {
  forgeAdrModule as adrModule,
  runAdrList,
  runAdrCreate,
  runAdrValidate,
  runAdrArchive,
} from "@warpgogol/forge/os/adr";
export type {
  AdrArchiveResult,
  AdrArchiveMove,
  AdrArchiveSkip,
  AdrStatus,
  AdrScope,
  AdrFrontmatter,
  AdrListEntry,
  AdrListResult,
  AdrCreateResult,
  AdrValidationViolation,
  AdrValidationResult,
} from "@warpgogol/forge/os/adr";
export {
  ADR_STATUSES,
  ADR_SCOPES,
  ADR_DIR,
  ADR_TEMPLATE_FILE,
  ADR_ID_PATTERN,
} from "@warpgogol/forge/os/adr";
