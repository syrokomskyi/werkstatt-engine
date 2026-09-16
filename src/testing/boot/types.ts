/*
<MODULE_CONTRACT>
<purpose>RFC-1041: Shared TypeScript types for the service boot testing system.
Lives in the engine package so both engine and site plugin can import without
cross-package violations (DNA-64).</purpose>


<non-goals>
  <item>Do not implement boot runner logic — that lives in @warpgogol/werkstatt-site.</item>
  <item>Do not import stack-specific dependencies.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1041: initial boot testing type contracts.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

export interface ServiceBootTestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface ServiceBootTestEntry {
  serviceId: string;
  status: "pass" | "fail" | "skipped";
  booted: boolean;
  healthOk: boolean;
  bindingsValid: boolean;
  durationMs: number;
  error?: string;
  unusedBindings?: string[];
}

export interface ServiceBootTestResult {
  command: "service.boot.test";
  status: "pass" | "fail" | "skipped";
  entries: ServiceBootTestEntry[];
  summary: ServiceBootTestSummary;
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface BootTestEvidence {
  bootResult: ServiceBootTestResult;
  recordedAt: string;
}
