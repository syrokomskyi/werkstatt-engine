/*
<MODULE_CONTRACT>
<purpose>Adapter registry resolution — maps the `deployment.adapter` name from system config to a concrete DeploymentAdapter instance. Throws adapter-not-implemented for names with no concrete implementation.</purpose>
<non-goals>
  <item>Do not implement adapter logic here — adapters live in their own files.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>REVIEW-CODE-2026-10-01-01: extracted from leitstand-commands.ts so non-command consumers (release-commands boot-smoke gate) resolve adapters through the registry barrel instead of name-string predicates.</item>
</CHANGE_SUMMARY>
*/

import type { DeploymentAdapter } from "../adapter.ts";
import { nullAdapter } from "./null-adapter.ts";
import { createCloudflareWorkersAdapter } from "./cloudflare-workers.ts";
import { createGitHubPagesAdapter } from "./github-pages.ts";

export function resolveAdapter(name: string | undefined): DeploymentAdapter {
  if (!name || name === "null") return nullAdapter;
  if (name === "cloudflare-workers") return createCloudflareWorkersAdapter();
  if (name === "github-pages") return createGitHubPagesAdapter();
  throw new Error(`[leitstand] adapter-not-implemented: '${name}' has no concrete implementation`);
}
