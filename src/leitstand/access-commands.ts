/*
<MODULE_CONTRACT>
  <purpose>RFC-0899: Leitstand access protection commands — protect, unprotect, status. Manages 4-digit PIN secrets for dev/alt subdomain Workers via wrangler secret put/delete.</purpose>
  <keywords>leitstand, access, protect, unprotect, pin, wrangler, secret, RFC-0899</keywords>
  <responsibilities>
    <item>leitstand.access.protect: set ACCESS_PIN secret on dev and alt channel Workers, update system-state.yaml.</item>
    <item>leitstand.access.unprotect: delete ACCESS_PIN secret from dev and alt channel Workers, clear system-state.yaml.</item>
    <item>leitstand.access.status: report PIN protection status from system-state.yaml.</item>
    <item>Use spawn("npx", ["--yes", "wrangler", "secret", "put/delete", ...]) pattern matching service-deploy-helpers.ts.</item>
    <item>Create temporary wrangler.jsonc in temp directory for worker name context.</item>
    <item>Pipe PIN to stdin for wrangler secret put.</item>
    <item>Best-effort: dev failure does not block alt; per-channel status reported.</item>
  </responsibilities>
  <non-goals>
    <item>Do not set secrets on the main channel Worker — main domain is never protected.</item>
    <item>Do not store the PIN in git — system-state.yaml stores only null or the 4-digit string.</item>
    <item>Do not use wrangler.toml — use temporary wrangler.jsonc only.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0899: Initial access protection commands.</item>
</CHANGE_SUMMARY>
*/

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  readSystemConfigSmart,
  readSystemStateSmart,
  writeSystemState,
  resolveCacheClonePath,
} from "../sternsystem/registry-io.ts";
import { sourceDotenv, filterEnv } from "./adapters/index.ts";

type ChannelName = "dev" | "alt";

interface ChannelSecretResult {
  channel: ChannelName;
  workerName: string;
  success: boolean;
  error?: string;
}

function validatePin(pin: string): void {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error(`[leitstand.access] PIN must be exactly 4 digits, got: "${pin}"`);
  }
}

function generateRandomPin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

async function runWranglerSecretPut(
  workerName: string,
  pin: string,
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["--yes", "wrangler", "secret", "put", "ACCESS_PIN", "--name", workerName],
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
    child.stdin.write(pin + "\n");
    child.stdin.end();
  });
}

async function runWranglerSecretDelete(
  workerName: string,
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["--yes", "wrangler", "secret", "delete", "ACCESS_PIN", "--name", workerName],
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

function flagString(input: KernelCommandInput, name: string): string | undefined {
  const v = input.flags[name];
  return typeof v === "string" ? v : undefined;
}

export async function runLeitstandAccessProtect(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ pin: string; channels: ChannelSecretResult[] }>> {
  const systemId = flagString(input, "site") ?? flagString(input, "system");
  if (!systemId) throw new Error("[leitstand.access.protect] --site is required");

  const pinArg = flagString(input, "pin");
  const pin = pinArg ?? generateRandomPin();
  validatePin(pin);

  const workspaceRoot = context.workspaceRoot;
  const systemConfig = await readSystemConfigSmart(workspaceRoot, systemId);
  if (!systemConfig.deployment) {
    throw new Error(
      `[leitstand.access.protect] system '${systemId}' has no deployment config in system-config.yaml`,
    );
  }

  const channels: deploymentChannelSchema_t[] = [
    { channel: "dev" as const, ...systemConfig.deployment.channels.dev },
    { channel: "alt" as const, ...systemConfig.deployment.channels.alt },
  ];

  const cacheCloneDir = resolveCacheClonePath(workspaceRoot, systemId);
  const envPath = join(cacheCloneDir, ".env");
  const secretsEnv = existsSync(envPath) ? await sourceDotenv(envPath) : {};
  const env: Record<string, string | undefined> = {
    ...filterEnv(process.env as Record<string, string | undefined>),
    ...secretsEnv,
  };

  const results: ChannelSecretResult[] = [];

  for (const ch of channels) {
    const result = await runWranglerSecretPut(ch.workerName, pin, env, workspaceRoot);
    const channelResult: ChannelSecretResult = {
      channel: ch.channel,
      workerName: ch.workerName,
      success: result.exitCode === 0,
    };
    if (result.exitCode !== 0) {
      channelResult.error =
        result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
    }
    results.push(channelResult);
  }

  const state = await readSystemStateSmart(workspaceRoot, systemId);
  state.accessPin = pin;
  await writeSystemState(workspaceRoot, systemId, state);

  const allSuccess = results.every((r) => r.success);
  const summary = allSuccess
    ? `[leitstand.access.protect] PIN set on ${results.length} channel(s) for ${systemId}`
    : `[leitstand.access.protect] PIN set with failures: ${results
        .filter((r) => !r.success)
        .map((r) => r.channel)
        .join(", ")}`;

  return {
    data: { pin, channels: results },
    summary,
    exitCode: allSuccess ? undefined : 1,
  };
}

export async function runLeitstandAccessUnprotect(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ channels: ChannelSecretResult[] }>> {
  const systemId = flagString(input, "site") ?? flagString(input, "system");
  if (!systemId) throw new Error("[leitstand.access.unprotect] --site is required");

  const workspaceRoot = context.workspaceRoot;
  const systemConfig = await readSystemConfigSmart(workspaceRoot, systemId);
  if (!systemConfig.deployment) {
    throw new Error(
      `[leitstand.access.unprotect] system '${systemId}' has no deployment config in system-config.yaml`,
    );
  }

  const channels: deploymentChannelSchema_t[] = [
    { channel: "dev" as const, ...systemConfig.deployment.channels.dev },
    { channel: "alt" as const, ...systemConfig.deployment.channels.alt },
  ];

  const cacheCloneDir = resolveCacheClonePath(workspaceRoot, systemId);
  const envPath = join(cacheCloneDir, ".env");
  const secretsEnv = existsSync(envPath) ? await sourceDotenv(envPath) : {};
  const env: Record<string, string | undefined> = {
    ...filterEnv(process.env as Record<string, string | undefined>),
    ...secretsEnv,
  };

  const results: ChannelSecretResult[] = [];

  for (const ch of channels) {
    const result = await runWranglerSecretDelete(ch.workerName, env, workspaceRoot);
    const channelResult: ChannelSecretResult = {
      channel: ch.channel,
      workerName: ch.workerName,
      // wrangler secret delete returns non-zero if secret doesn't exist — treat as success (idempotent)
      success:
        result.exitCode === 0 ||
        result.stderr.includes("not found") ||
        result.stdout.includes("not found"),
    };
    if (!channelResult.success && result.exitCode !== 0) {
      channelResult.error =
        result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
    }
    results.push(channelResult);
  }

  const state = await readSystemStateSmart(workspaceRoot, systemId);
  state.accessPin = null;
  await writeSystemState(workspaceRoot, systemId, state);

  const allSuccess = results.every((r) => r.success);
  const summary = allSuccess
    ? `[leitstand.access.unprotect] PIN removed from ${results.length} channel(s) for ${systemId}`
    : `[leitstand.access.unprotect] PIN removal with failures: ${results
        .filter((r) => !r.success)
        .map((r) => r.channel)
        .join(", ")}`;

  return {
    data: { channels: results },
    summary,
    exitCode: allSuccess ? undefined : 1,
  };
}

export async function runLeitstandAccessStatus(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<
  KernelCommandResult<{ systemId: string; accessPin: string | null; protected: boolean }>
> {
  const systemId = flagString(input, "site") ?? flagString(input, "system");
  if (!systemId) throw new Error("[leitstand.access.status] --site is required");

  const workspaceRoot = context.workspaceRoot;
  const state = await readSystemStateSmart(workspaceRoot, systemId);

  return {
    data: {
      systemId,
      accessPin: state.accessPin,
      protected: state.accessPin !== null,
    },
    summary: `[leitstand.access.status] ${systemId}: ${state.accessPin !== null ? "protected" : "unprotected"}`,
  };
}

// Type helper for channel iteration
type deploymentChannelSchema_t = {
  channel: ChannelName;
  workerName: string;
  url: string;
  secretsFile?: string;
};
