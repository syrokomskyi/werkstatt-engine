/*
<MODULE_CONTRACT>
<purpose>
RFC-1326: allow-listed workshop .env resolution. Replaces the blanket
`import "dotenv/config"` at the CLI entry — the kernel parses the
workshop-root .env with dotenv.parse and copies ONLY the
WORKSHOP_ENV_ALLOWLIST keys into process.env. A key already exported in
the real environment always wins; unlisted keys (LANGUAGETOOL_URL,
LAGEBILD_*, GH_TOKEN, …) never reach process.env, so they cannot leak
into site pipelines (the GRAM-03 fix). Site-level keys come from the site
.env via context.workpieceEnv (RFC-1126).
</purpose>
<non-goals>
  <item>Does not read the site .env — workpieceEnv owns that channel.</item>
  <item>Does not override process.env — an exported variable always wins (RFC-1126 precedence parity).</item>
</non-goals>
<KEY_DECISIONS>
  <item>loadWorkshopEnvAllowlisted is io-injected and targetEnv-injected so tests never mutate the real process.env.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1326: initial — loadWorkshopEnvAllowlisted + cli/index.ts swap.</item>
  <item>RFC-1326: single Cloudflare permission registry, token preflight, birth provisioning</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import { parse as dotenvParse } from "dotenv";
import {
  createDefaultIO,
  type WorkspaceIO,
} from "@warpgogol/werkstatt-shared/kernel/workspace-io";
import { workshopEnvAllowed } from "@warpgogol/werkstatt-shared/cloudflare/permissions";

export interface WorkshopEnvLoadResult {
  /** Allow-listed keys copied from .env into the target environment. */
  loaded: string[];
  /** Keys present in .env but excluded — non-allow-listed or already exported. */
  skipped: string[];
  /** False when the workshop carries no .env file. */
  envFileFound: boolean;
}

/**
 * Parse `<workspaceRoot>/.env` and copy allow-listed, not-already-exported
 * keys into `targetEnv`. Never throws — a missing or unreadable .env yields
 * `envFileFound: false` and no copies.
 */
export async function loadWorkshopEnvAllowlisted(
  workspaceRoot: string,
  io: WorkspaceIO = createDefaultIO().io,
  targetEnv: Record<string, string | undefined> = process.env,
): Promise<WorkshopEnvLoadResult> {
  let raw: string;
  try {
    raw = await io.readFile(join(workspaceRoot, ".env"));
  } catch {
    return { loaded: [], skipped: [], envFileFound: false };
  }

  const parsed = dotenvParse(raw);
  const loaded: string[] = [];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!workshopEnvAllowed(key) || targetEnv[key] !== undefined) {
      skipped.push(key);
      continue;
    }
    targetEnv[key] = value;
    loaded.push(key);
  }
  return { loaded, skipped, envFileFound: true };
}
