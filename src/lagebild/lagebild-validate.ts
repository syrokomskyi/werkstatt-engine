/*
<MODULE_CONTRACT>
  <purpose>RFC-1065: lagebild.validate command — check 4 LAGEBILD_* secrets via wrangler secret list, verify .env key presence, best-effort GET /health.</purpose>


  <non-goals>
    <item>Do not use the API key for authenticated requests — GET /health only.</item>
    <item>Do not block on health check failure — best-effort, non-blocking.</item>
    <item>Do not modify system-state.yaml.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1065: initial lagebild.validate command handler.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into <history>, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
</CHANGE_SUMMARY>
*/

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  readSystemConfigSmart,
  readSystemStateSmart,
  resolveCacheClonePath,
} from "../sternsystem/registry-io.ts";
import { filterEnv, sourceDotenv } from "../leitstand/adapters/index.ts";
import { LAGEBILD_SECRET_NAMES, resolveWorkerName } from "./lagebild-helpers.ts";

function flagString(input: KernelCommandInput, name: string): string | undefined {
  const v = input.flags[name];
  return typeof v === "string" ? v : undefined;
}

interface SecretCheckResult {
  name: string;
  present: boolean;
}

interface HealthCheckResult {
  reachable: boolean;
  statusCode?: number;
  error?: string;
}

async function runWranglerSecretList(
  workerName: string,
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["--yes", "wrangler", "secret", "list", "--name", workerName],
      {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", () => {
      resolve({ exitCode: 1, stdout, stderr: "Failed to spawn wrangler" });
    });
    child.on("exit", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    child.stdin.end();
  });
}

export async function runLagebildValidate(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<
  KernelCommandResult<{
    site: string;
    channel: string;
    workerName: string;
    secrets: SecretCheckResult[];
    allSecretsPresent: boolean;
    apiKeyInEnv: boolean;
    apiReachable: HealthCheckResult;
    state: { connected: boolean; apiUrl?: string; channel?: string };
  }>
> {
  const systemId = flagString(input, "site");
  if (!systemId) throw new Error("[lagebild.validate] --site is required");

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

  // Spawn wrangler secret list
  const listResult = await runWranglerSecretList(workerName, env, workspaceRoot);

  // Parse secret names from wrangler output
  // wrangler secret list outputs lines like: "SECRET_NAME  2024-01-01T00:00:00Z"
  const presentSecrets = new Set<string>();
  if (listResult.exitCode === 0) {
    for (const line of listResult.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // First column is the secret name
      const name = trimmed.split(/\s+/)[0];
      if (name) presentSecrets.add(name);
    }
  }

  const secretChecks: SecretCheckResult[] = LAGEBILD_SECRET_NAMES.map((name) => ({
    name,
    present: presentSecrets.has(name),
  }));

  const allSecretsPresent = secretChecks.every((s) => s.present);

  // Check .env for LAGEBILD_API_KEY presence
  let apiKeyInEnv = false;
  if (existsSync(envPath)) {
    const rawEnv = await readFile(envPath, "utf8");
    for (const line of rawEnv.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("LAGEBILD_API_KEY=") && trimmed.length > "LAGEBILD_API_KEY=".length) {
        apiKeyInEnv = true;
        break;
      }
    }
  }

  // Read state for API URL
  const state = await readSystemStateSmart(workspaceRoot, systemId);
  const lagebildState = state.lagebild;

  // Best-effort GET /health (non-blocking)
  let apiReachable: HealthCheckResult = { reachable: false };
  if (lagebildState?.apiUrl) {
    try {
      const healthUrl = lagebildState.apiUrl.endsWith("/")
        ? `${lagebildState.apiUrl}health`
        : `${lagebildState.apiUrl}/health`;
      const response = await fetch(healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      apiReachable = {
        reachable: response.ok,
        statusCode: response.status,
      };
    } catch (err) {
      apiReachable = {
        reachable: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (!allSecretsPresent) {
    return {
      data: {
        site: systemId,
        channel,
        workerName,
        secrets: secretChecks,
        allSecretsPresent: false,
        apiKeyInEnv,
        apiReachable,
        state: {
          connected: lagebildState?.connected ?? false,
          apiUrl: lagebildState?.apiUrl,
          channel: lagebildState?.channel,
        },
      },
      exitCode: 1,
      summary: `Missing secrets: ${secretChecks.filter((s) => !s.present).map((s) => s.name).join(", ")}`,
    };
  }

  return {
    data: {
      site: systemId,
      channel,
      workerName,
      secrets: secretChecks,
      allSecretsPresent: true,
      apiKeyInEnv,
      apiReachable,
      state: {
        connected: lagebildState?.connected ?? false,
        apiUrl: lagebildState?.apiUrl,
        channel: lagebildState?.channel,
      },
    },
  };
}
