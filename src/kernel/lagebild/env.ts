/*
<MODULE_CONTRACT>
<purpose>RFC-0186/RFC-0388: Load Lagebild registry credentials from .env or process.env
for CLI commands that need to talk to Supabase sync_tenants.</purpose>
<non-goals>
  <item>Do not store or log secret values.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0186: Initial env helper for loading registry credentials from .dev.vars.</item>
  <item>RFC-0388: Migrate from .dev.vars to .env for consistency with unified env-file standard.</item>
</CHANGE_SUMMARY>
*/

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RegistryClient } from "@warpgogol/werkstatt-shared/integration-adapter-supabase-crm/tenant-registry";

/** Parse a .env file (KEY=VALUE lines, # comments) into a record. */
function parseEnvFile(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/** RFC-0186/RFC-0388: Resolve registry client from process.env or .env file. */
export async function resolveRegistryClient(workspaceRoot: string): Promise<RegistryClient> {
  const envPath = join(workspaceRoot, "services", "lagebild-sync", ".env");

  let env: Record<string, string | undefined> = { ...process.env };

  try {
    const raw = await readFile(envPath, "utf8");
    const parsed = parseEnvFile(raw);
    env = { ...parsed, ...process.env };
  } catch {
    // .env not found — rely on process.env only
  }

  const url = env.LAGEBILD_REGISTRY_URL;
  const apiKey = env.LAGEBILD_REGISTRY_API_KEY;

  if (!url || !apiKey) {
    throw new Error(
      `Lagebild registry credentials not found. Set LAGEBILD_REGISTRY_URL and LAGEBILD_REGISTRY_API_KEY in process.env or services/lagebild-sync/.env`,
    );
  }

  return { url, apiKey };
}

/** RFC-0186: Extract Supabase project ref from a project URL. */
export function extractProjectRef(url: string): string {
  const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  return match?.[1] ?? "";
}
