/*
<MODULE_CONTRACT>
<purpose>RFC-0825: Shared TypeScript types for the post-deploy smoke testing system.
Lives in the engine package so both engine and site plugin can import without
cross-package violations (DNA-64).</purpose>
<keywords>smoke, testing, types, contracts</keywords>
<responsibilities>
  <item>Defines SmokeEndpoint, SmokeRunInput, SmokeRunResult, SmokeCheckResult, SmokeEvidence interfaces.</item>
  <item>Shared by engine (leitstand pipeline integration) and site plugin (smoke runner, kernel commands).</item>
</responsibilities>
<non-goals>
  <item>Do not implement smoke runner logic — that lives in @warpgogol/werkstatt-site.</item>
  <item>Do not import stack-specific dependencies.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0825: initial smoke testing type contracts.</item>
</CHANGE_SUMMARY>
*/

export interface SmokeEndpoint {
  path: string;
  method?: "GET" | "POST" | "HEAD";
  body?: Record<string, unknown>;
  contentType?: string;
  expectStatus: number;
  expectBodyContains?: string;
  timeoutMs: number;
}

export interface SmokeRunInput {
  service?: string;
  site?: string;
  url?: string;
  json?: boolean;
}

export interface SmokeCheckResult {
  path: string;
  method: string;
  status: number | null;
  passed: boolean;
  error?: string;
  durationMs: number;
}

export interface SmokeRunResult {
  command: "service.smoke.run" | "site.smoke.run";
  status: "pass" | "fail";
  targetId: string;
  url: string;
  checks: SmokeCheckResult[];
  durationMs: number;
}

export interface SmokeEvidence {
  smokeResult: SmokeRunResult;
  recordedAt: string;
}
