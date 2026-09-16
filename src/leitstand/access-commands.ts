/*
<MODULE_CONTRACT>
  <purpose>RFC-0899: Leitstand access protection commands — protect, unprotect, status. Manages 4-digit PIN secrets for dev/alt subdomain Workers via wrangler secret put/delete.</purpose>


  <non-goals>
    <item>Do not set secrets on the main channel Worker — main domain is never protected.</item>
    <item>Do not store the PIN in git — system-state.yaml stores only null or the 4-digit string.</item>
    <item>Do not use wrangler.toml — use temporary wrangler.jsonc only.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0899: Initial access protection commands.</item>
  <item>RFC-1065: extracted runWranglerSecretPut/Delete to wrangler-secrets.ts shared helper.</item>
  <item>RFC-1097: step 6 — compass.migrate codemod run

Mechanical v1 to v2 header migration across the workspace: 942 files rewritten — CHANGE_SUMMARY windows collapsed into history, forbidden v1 blocks stripped, KEY_DECISIONS seeded from @ai-invariant comments (5 files) or TODO placeholders (103 files), blocks reordered to canonical order.</item>
  <item>RFC-1097: sweep — werkstatt-engine clean

Sweep batch 4: 73 Compass headers on headerless engine files (certification, component-runtime, isolation, evolution, testing), real KEY_DECISIONS on 75 files (kernel, cache, dht, swim, gitmesh, runtime), ~80 purpose expansions (CONTRACT-02/PURPOSE-02), non-goals on 13 CONTRACT-03 files, CS-07 history literal fix repo-wide (253 files). Policy: .template.ts/.template.astro excludedPaths. werkstatt-engine now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

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
import { runWranglerSecretPut, runWranglerSecretDelete } from "./adapters/wrangler-secrets.ts";

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
    const result = await runWranglerSecretPut(ch.workerName, "ACCESS_PIN", pin, env, workspaceRoot);
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
    const result = await runWranglerSecretDelete(ch.workerName, "ACCESS_PIN", env, workspaceRoot);
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
