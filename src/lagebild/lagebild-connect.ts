/*
<MODULE_CONTRACT>
  <purpose>RFC-1065: lagebild.connect command — push 4 LAGEBILD_* secrets to a channel's Worker, health check, record state, merge into .env.</purpose>


  <non-goals>
    <item>Do not log the API key value — only the secret name appears in output.</item>
    <item>Do not write LAGEBILD_* to .env.example — that is a separate DNA-40 step.</item>
    <item>Do not block on health check failure — best-effort only.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1065: initial lagebild.connect command handler.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  readSystemConfigSmart,
  readSystemStateSmart,
  writeSystemStateSmart,
  resolveCacheClonePath,
} from "../sternsystem/registry-io.ts";
import { sourceDotenv, filterEnv } from "../leitstand/adapters/index.ts";
import { runWranglerSecretPut } from "../leitstand/adapters/wrangler-secrets.ts";
import { LAGEBILD_SECRET_NAMES, resolveWorkerName } from "./lagebild-helpers.ts";

function flagString(input: KernelCommandInput, name: string): string | undefined {
  const v = input.flags[name];
  return typeof v === "string" ? v : undefined;
}

interface SecretPushResult {
  name: string;
  pushed: boolean;
  error?: string;
}

interface HealthCheckResult {
  reachable: boolean;
  statusCode?: number;
  error?: string;
}

export async function runLagebildConnect(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<
  KernelCommandResult<{
    site: string;
    channel: string;
    workerName: string;
    secrets: SecretPushResult[];
    healthCheck: HealthCheckResult;
    stateRecorded: boolean;
  }>
> {
  const systemId = flagString(input, "site");
  if (!systemId) throw new Error("[lagebild.connect] --site is required");

  const apiUrl = flagString(input, "api-url");
  if (!apiUrl) throw new Error("[lagebild.connect] --api-url is required");

  const apiKey = flagString(input, "api-key");
  if (!apiKey) throw new Error("[lagebild.connect] --api-key is required");
  if (apiKey.length === 0) {
    throw new Error("[lagebild.connect] --api-key must not be empty");
  }

  const tenantId = flagString(input, "tenant-id");
  if (!tenantId) throw new Error("[lagebild.connect] --tenant-id is required");

  const sourceSystemId = flagString(input, "source-system-id") ?? `site_${systemId}`;
  const channel = flagString(input, "channel") ?? "main";

  const workspaceRoot = context.workspaceRoot;

  let systemConfig;
  try {
    systemConfig = await readSystemConfigSmart(workspaceRoot, systemId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT") || msg.includes("no such file")) {
      throw new Error(`Site '${systemId}' not found`);
    }
    throw err;
  }

  const workerName = resolveWorkerName(systemConfig, channel);

  const cacheCloneDir = resolveCacheClonePath(workspaceRoot, systemId);
  const envPath = join(cacheCloneDir, ".env");
  const secretsEnv = existsSync(envPath) ? await sourceDotenv(envPath) : {};
  const env: Record<string, string | undefined> = {
    ...filterEnv(process.env as Record<string, string | undefined>),
    ...secretsEnv,
  };

  const secretValues: Record<string, string> = {
    LAGEBILD_API_URL: apiUrl,
    LAGEBILD_API_KEY: apiKey,
    LAGEBILD_TENANT_ID: tenantId,
    LAGEBILD_SOURCE_SYSTEM_ID: sourceSystemId,
  };

  const secretResults: SecretPushResult[] = [];
  for (const name of LAGEBILD_SECRET_NAMES) {
    const result = await runWranglerSecretPut(
      workerName,
      name,
      secretValues[name],
      env,
      workspaceRoot,
    );
    const sr: SecretPushResult = {
      name,
      pushed: result.exitCode === 0,
    };
    if (result.exitCode !== 0) {
      sr.error = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
    }
    secretResults.push(sr);
  }

  // Best-effort health check (non-blocking)
  let healthCheck: HealthCheckResult = { reachable: false };
  try {
    const healthUrl = apiUrl.endsWith("/") ? `${apiUrl}health` : `${apiUrl}/health`;
    const response = await fetch(healthUrl, { method: "GET", signal: AbortSignal.timeout(5000) });
    healthCheck = {
      reachable: response.ok,
      statusCode: response.status,
    };
  } catch (err) {
    healthCheck = {
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Write lagebild block to system-state.yaml
  const state = await readSystemStateSmart(workspaceRoot, systemId);
  state.lagebild = {
    connected: true,
    apiUrl,
    tenantId,
    sourceSystemId,
    connectedAt: new Date().toISOString(),
    channel,
  };
  await writeSystemStateSmart(workspaceRoot, systemId, state);

  // Merge LAGEBILD_* values into .env file in cache clone
  await mergeLagebildIntoEnv(cacheCloneDir, secretValues);

  return {
    data: {
      site: systemId,
      channel,
      workerName,
      secrets: secretResults,
      healthCheck,
      stateRecorded: true,
    },
  };
}

async function mergeLagebildIntoEnv(
  cacheCloneDir: string,
  values: Record<string, string>,
): Promise<void> {
  const envPath = join(cacheCloneDir, ".env");
  let lines: string[] = [];
  if (existsSync(envPath)) {
    const raw = await readFile(envPath, "utf8");
    lines = raw.split("\n");
  }

  const lagebildKeys = new Set<string>(Object.keys(values));
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) return true;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) return true;
    const key = trimmed.substring(0, eqIdx).trim();
    return !lagebildKeys.has(key);
  });

  // Remove trailing empty lines
  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === "") {
    filtered.pop();
  }

  if (filtered.length > 0) {
    filtered.push("");
  }
  for (const name of LAGEBILD_SECRET_NAMES) {
    filtered.push(`${name}=${values[name]}`);
  }
  filtered.push("");

  await writeFile(envPath, filtered.join("\n"), "utf8");
}
