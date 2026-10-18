/*
<MODULE_CONTRACT>
  <purpose>RFC-0899/RFC-1284: Leitstand access protection commands — protect,
  unprotect, suspend, resume, status. Manages 4-digit PIN secrets for dev/alt
  subdomain Workers via wrangler secret put/delete. system-state.yaml accessPin
  is the authoritative desired declaration; accessPinSuspended marks legitimate
  transient divergence of the projection (RFC-1284, DNA-111).</purpose>


  <non-goals>
    <item>Do not set secrets on the main channel Worker — main domain is never protected.</item>
    <item>Do not store the PIN in git — system-state.yaml stores only null or the 4-digit string.</item>
    <item>Do not use wrangler.toml — use temporary wrangler.jsonc only.</item>
    <item>leitstand.access.suspend is the only writer of accessPinSuspended besides the
      normalizing clear in protect/unprotect/resume — no other command touches the marker.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1249: wire werkstatt.commands.validate into packages.check + retire CMD-OUTPUT debt</item>
  <item>RFC-1254: drop unused io-migration leftovers</item>
  <item>RFC-1284: suspend/resume commands, crash-safe marker, status tri-state

accessPin becomes desired-state authority: suspend deletes the projection
secret then writes accessPinSuspended (marker only when every channel delete
succeeds — a kill in between leaves ACCESS-01-visible drift); resume re-puts
the pin and clears the marker only on full success; protect/unprotect
normalize stale markers; status reports protected|suspended|unprotected.</item>
  <item>RFC-1284: fix review REVIEW-CODE-2026-10-15-02: RFC-1284 — single-store marker, flag=false proceed, surfaced reconcile

F1: marker store unified on the git-tracked cache clone — access commands,
certify entry check, and deploy reconcile all use non-smart
readSystemState/writeSystemState (decisions Q-6); the mission-window
blindness and the DNA-106 false-resume are gone.
F2: --auto-manage-pin=false + suspension at entry skips entry-resume and
proceeds on the open channel (decisions Q-7) — RFC/AC-8 text amended.
F3: accessReconcile surfaced in data + summary of dev-deploy/propagate.
F4: CHANGE_SUMMARY items on all touched files.
F5: sternsystem.validate declares ACCESS-01/02 + system-state.yaml reads.
F6: isProtectedLiveTarget exported and covered (AC-12 probe repointed).
F7: fresh-read ordering proven — suspension opened mid-deploy suppresses
the re-assert.</item>
  <item>RFC-1327: review r1 — lock-safe reconcile gate, residue sweep, honest idempotency classes</item>
  <history>RFC-0899, RFC-1065, RFC-1097</history>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
  WorkspaceIO,
} from "@warpgogol/werkstatt-engine/kernel";
import type { SystemConfig, SystemState } from "@warpgogol/werkstatt-engine/schemas";
import {
  readSystemConfigSmart,
  readSystemState,
  writeSystemState,
  resolveCacheClonePath,
} from "../sternsystem/registry-io.ts";
import { sourceDotenv, filterEnv } from "./adapters/index.ts";
import { runWranglerSecretPut, runWranglerSecretDelete } from "./adapters/wrangler-secrets.ts";

type ChannelName = "dev" | "alt";

type AccessProtectionStatus = "protected" | "suspended" | "unprotected";

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

function requireSite(input: KernelCommandInput, commandName: string): string {
  const systemId = flagString(input, "site") ?? flagString(input, "system");
  if (!systemId) throw new Error(`[${commandName}] --site is required`);
  return systemId;
}

// Type helper for channel iteration
type deploymentChannelSchema_t = {
  channel: ChannelName;
  workerName: string;
  url: string;
  secretsFile?: string;
};

function accessChannels(
  systemConfig: SystemConfig,
  commandName: string,
  systemId: string,
): deploymentChannelSchema_t[] {
  if (!systemConfig.deployment) {
    throw new Error(
      `[${commandName}] system '${systemId}' has no deployment config in system-config.yaml`,
    );
  }
  return [
    { channel: "dev" as const, ...systemConfig.deployment.channels.dev },
    { channel: "alt" as const, ...systemConfig.deployment.channels.alt },
  ];
}

async function buildSecretsEnv(
  workspaceRoot: string,
  systemId: string,
  io: WorkspaceIO,
): Promise<Record<string, string | undefined>> {
  const cacheCloneDir = resolveCacheClonePath(workspaceRoot, systemId);
  const envPath = join(cacheCloneDir, ".env");
  const secretsEnv = (await io.exists(envPath)) ? await sourceDotenv(envPath) : {};
  return {
    ...filterEnv(process.env as Record<string, string | undefined>),
    ...secretsEnv,
  };
}

async function putPinOnChannels(
  channels: deploymentChannelSchema_t[],
  pin: string,
  env: Record<string, string | undefined>,
  workspaceRoot: string,
): Promise<ChannelSecretResult[]> {
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
  return results;
}

async function deletePinFromChannels(
  channels: deploymentChannelSchema_t[],
  env: Record<string, string | undefined>,
  workspaceRoot: string,
): Promise<ChannelSecretResult[]> {
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
  return results;
}

export async function runLeitstandAccessProtect(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ pin: string; channels: ChannelSecretResult[] }>> {
  const systemId = requireSite(input, "leitstand.access.protect");

  const pinArg = flagString(input, "pin");
  const workspaceRoot = context.workspaceRoot;

  // RFC-1327: re-running without an explicit --pin while a PIN is already
  // recorded must not silently rotate the secret — converge to a no-op.
  if (!pinArg) {
    const existing = await readSystemState(workspaceRoot, systemId);
    if (existing.accessPin) {
      return {
        data: { pin: existing.accessPin, channels: [] },
        summary: `[leitstand.access.protect] ${systemId} already protected — no-op (pass --pin to rotate)`,
        exitCode: undefined,
      };
    }
  }

  const pin = pinArg ?? generateRandomPin();
  validatePin(pin);

  const systemConfig = await readSystemConfigSmart(workspaceRoot, systemId);
  const channels = accessChannels(systemConfig, "leitstand.access.protect", systemId);
  const env = await buildSecretsEnv(workspaceRoot, systemId, context.io);

  const results = await putPinOnChannels(channels, pin, env, workspaceRoot);

  const state = await readSystemState(workspaceRoot, systemId);
  state.accessPin = pin;
  // RFC-1284: normalize stale suspension — a freshly asserted pin is not suspended.
  state.accessPinSuspended = null;
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
  const systemId = requireSite(input, "leitstand.access.unprotect");

  const workspaceRoot = context.workspaceRoot;
  const systemConfig = await readSystemConfigSmart(workspaceRoot, systemId);
  const channels = accessChannels(systemConfig, "leitstand.access.unprotect", systemId);
  const env = await buildSecretsEnv(workspaceRoot, systemId, context.io);

  const results = await deletePinFromChannels(channels, env, workspaceRoot);

  const state = await readSystemState(workspaceRoot, systemId);
  state.accessPin = null;
  // RFC-1284: permanent unprotection dissolves any suspension marker.
  state.accessPinSuspended = null;
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

// RFC-1284: transient suspension — deletes the projection secret FIRST, then
// writes the marker only when every channel deleted. A kill in between leaves
// detectable drift (pin declared, secret absent, no marker) that ACCESS-01
// raises — the inversion errs toward alarm, not silence.
export async function runLeitstandAccessSuspend(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<
  KernelCommandResult<{
    channels: ChannelSecretResult[];
    suspended: NonNullable<SystemState["accessPinSuspended"]> | null;
  }>
> {
  const systemId = requireSite(input, "leitstand.access.suspend");

  const workspaceRoot = context.workspaceRoot;
  // Marker authority is the git-tracked cache clone — non-smart reads/writes
  // keep the contract single-store even while a mission workpiece shadows
  // system-state.yaml (REVIEW-CODE-2026-10-15-02 F1, decisions Q-6).
  const state = await readSystemState(workspaceRoot, systemId);
  if (state.accessPin === null) {
    throw new Error(
      `[leitstand.access.suspend] system '${systemId}' has accessPin: null — nothing to suspend. ` +
        `Set a pin first: pnpm exec werkstatt run leitstand.access.protect --site ${systemId}`,
    );
  }

  const systemConfig = await readSystemConfigSmart(workspaceRoot, systemId);
  const channels = accessChannels(systemConfig, "leitstand.access.suspend", systemId);

  const env = await buildSecretsEnv(workspaceRoot, systemId, context.io);
  const results = await deletePinFromChannels(channels, env, workspaceRoot);
  const allSuccess = results.every((r) => r.success);

  let suspended: NonNullable<SystemState["accessPinSuspended"]> | null = null;
  if (allSuccess) {
    // Idempotent: re-suspending refreshes the marker.
    suspended = {
      at: new Date().toISOString(),
      by: flagString(input, "by") ?? "operator",
      operationId: flagString(input, "operation-id") ?? null,
    };
    state.accessPinSuspended = suspended;
    await writeSystemState(workspaceRoot, systemId, state);
  }

  const summary = allSuccess
    ? `[leitstand.access.suspend] PIN suspended on ${results.length} channel(s) for ${systemId} (by ${suspended!.by})`
    : `[leitstand.access.suspend] suspension failed — no marker written, drift visible via ACCESS-01: ${results
        .filter((r) => !r.success)
        .map((r) => r.channel)
        .join(", ")}`;

  return {
    data: { channels: results, suspended },
    summary,
    exitCode: allSuccess ? undefined : 1,
  };
}

export async function runLeitstandAccessResume(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<{ channels: ChannelSecretResult[]; resumed: boolean }>> {
  const systemId = requireSite(input, "leitstand.access.resume");

  const workspaceRoot = context.workspaceRoot;
  const state = await readSystemState(workspaceRoot, systemId);

  if (state.accessPinSuspended === null) {
    return {
      data: { channels: [], resumed: false },
      summary: `[leitstand.access.resume] ${systemId}: not suspended — nothing to resume`,
      exitCode: 0,
    };
  }

  if (state.accessPin === null) {
    throw new Error(
      `[leitstand.access.resume] system '${systemId}' is suspended but accessPin is null — ` +
        `the desired pin is unknown and cannot be resumed. ` +
        `Run: pnpm exec werkstatt run leitstand.access.protect --site ${systemId} --pin <4-digit>`,
    );
  }

  const systemConfig = await readSystemConfigSmart(workspaceRoot, systemId);
  const channels = accessChannels(systemConfig, "leitstand.access.resume", systemId);
  const env = await buildSecretsEnv(workspaceRoot, systemId, context.io);

  const results = await putPinOnChannels(channels, state.accessPin, env, workspaceRoot);
  const allSuccess = results.every((r) => r.success);

  if (allSuccess) {
    // Clear the marker only when the projection is fully re-asserted — a
    // partial restore keeps the suspension declared so ACCESS-01 stays muted
    // and ACCESS-02 keeps aging toward a warning.
    state.accessPinSuspended = null;
    await writeSystemState(workspaceRoot, systemId, state);
  }

  const summary = allSuccess
    ? `[leitstand.access.resume] PIN restored on ${results.length} channel(s) for ${systemId}`
    : `[leitstand.access.resume] restore failed — suspension marker kept: ${results
        .filter((r) => !r.success)
        .map((r) => r.channel)
        .join(", ")}`;

  return {
    data: { channels: results, resumed: allSuccess },
    summary,
    exitCode: allSuccess ? undefined : 1,
  };
}

export async function runLeitstandAccessStatus(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<
  KernelCommandResult<{
    systemId: string;
    status: AccessProtectionStatus;
    accessPin: string | null;
    suspended: SystemState["accessPinSuspended"];
  }>
> {
  const systemId = requireSite(input, "leitstand.access.status");

  const workspaceRoot = context.workspaceRoot;
  const state = await readSystemState(workspaceRoot, systemId);

  const status: AccessProtectionStatus =
    state.accessPin === null
      ? "unprotected"
      : state.accessPinSuspended !== null
        ? "suspended"
        : "protected";

  return {
    data: {
      systemId,
      status,
      accessPin: state.accessPin,
      suspended: state.accessPinSuspended,
    },
    exitCode: 0,
    summary: `[leitstand.access.status] ${systemId}: ${status}`,
  };
}
