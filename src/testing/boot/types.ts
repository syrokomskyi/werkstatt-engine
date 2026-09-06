/*
<MODULE_CONTRACT>
<purpose>RFC-1041: Shared TypeScript types for the service boot testing system.
Lives in the engine package so both engine and site plugin can import without
cross-package violations (DNA-64).</purpose>
<keywords>boot, testing, types, contracts, services</keywords>
<responsibilities>
  <item>Defines ServiceBootTestSummary, ServiceBootTestEntry, ServiceBootTestResult interfaces.</item>
  <item>Shared by engine (pipeline integration) and site plugin (boot runner, kernel commands).</item>
</responsibilities>
<non-goals>
  <item>Do not implement boot runner logic — that lives in @warpgogol/werkstatt-site.</item>
  <item>Do not import stack-specific dependencies.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1041: initial boot testing type contracts.</item>
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
