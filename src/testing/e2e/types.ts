/*
<MODULE_CONTRACT>
<purpose>RFC-0828: Shared TypeScript types for site E2E testing with Playwright.
Lives in the engine package so both engine and site plugin can import without
cross-package violations (DNA-64).</purpose>
<keywords>e2e, testing, types, contracts, playwright</keywords>
<responsibilities>
  <item>Defines SiteE2eRunResult and E2eTestFailure interfaces.</item>
  <item>Shared by engine (leitstand pipeline integration) and site plugin (e2e runner, kernel commands).</item>
</responsibilities>
<non-goals>
  <item>Do not implement e2e runner logic — that lives in @warpgogol/werkstatt-site.</item>
  <item>Do not import stack-specific dependencies.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0828: initial E2E testing type contracts.</item>
</CHANGE_SUMMARY>
*/

export interface E2eTestFailure {
  testName: string;
  message: string;
  file: string;
}

export interface SiteE2eRunResult {
  command: "site.e2e.run";
  status: "pass" | "fail" | "skipped";
  site: string;
  url: string;
  testFiles: number;
  testsPassed: number;
  testsFailed: number;
  durationMs: number;
  failures?: E2eTestFailure[];
}

export interface E2eTestEvidence {
  e2eResult: SiteE2eRunResult;
  recordedAt: string;
}
