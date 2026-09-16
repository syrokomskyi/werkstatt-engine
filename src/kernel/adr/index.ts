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
<KEY_DECISIONS>
  <item>The barrel only re-exports — ADR logic lives in the sibling modules.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-0366: expose adrModule and ADR types from the ADR domain.</item>
  <item>RFC-0521: replaced site-kernel ADR implementation with re-export from @warpgogol/forge/os/adr.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

export {
  createForgeAdrModule as createAdrModule,
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
