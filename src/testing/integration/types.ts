/*
<MODULE_CONTRACT>
<purpose>RFC-0826: Shared TypeScript types for service integration testing.
Lives in the engine package so both engine and site plugin can import without
cross-package violations (DNA-64).</purpose>
<keywords>integration, testing, types, contracts</keywords>
<responsibilities>
  <item>Defines IntegrationRunResult and IntegrationTestSummary interfaces.</item>
  <item>Shared by engine (leitstand pipeline integration) and site plugin (integration runner, kernel commands).</item>
</responsibilities>
<non-goals>
  <item>Do not implement integration runner logic — that lives in @warpgogol/werkstatt-site.</item>
  <item>Do not import stack-specific dependencies.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0826: initial integration testing type contracts.</item>
</CHANGE_SUMMARY>
*/

export interface IntegrationTestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface IntegrationRunResult {
  command: "service.integration.run";
  serviceId: string;
  status: "pass" | "fail" | "skipped";
  summary: IntegrationTestSummary;
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface IntegrationEvidence {
  integrationResult: IntegrationRunResult;
  recordedAt: string;
}
