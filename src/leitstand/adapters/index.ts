/*
<MODULE_CONTRACT>
<purpose>RFC-0379: adapter re-exports for the leitstand deployment adapter registry, grouping all available adapters in one barrel.</purpose>
<non-goals>
  <item>Do not implement adapter logic here — each adapter lives in its own file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0379: initial adapter registry re-export.</item>
  <item>RFC-1091: re-export shared health-check helpers from health-helpers.ts.</item>
</CHANGE_SUMMARY>
*/

export {
  createCloudflareWorkersAdapter,
  filterEnv,
  sourceDotenv,
  readBehaviorSnapshot,
  verifyRedirectRoute,
} from "./cloudflare-workers.ts";

export { createGitHubPagesAdapter } from "./github-pages.ts";

export { selectProbeRoutes, fetchWithRetry, createDefaultCommandRunner } from "./health-helpers.ts";
