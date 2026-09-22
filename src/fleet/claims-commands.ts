/*
<MODULE_CONTRACT>
<purpose>RFC-1124: Command handlers for fleet.claims.init, publish, sync, verify,
status. Thin wrappers around claims-repo.ts pure functions.</purpose>
<non-goals>
  <item>Does not implement claims logic — that lives in claims-repo.ts.</item>
  <item>Does not call the RFC-0967 Worker — claims are the authority.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1124: initial command handlers for fleet.claims.* surface.</item>
</CHANGE_SUMMARY>
*/

import { writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-shared/kernel";
import {
  claimsStatus,
  ensureClaimsClone,
  loadSigningKeyFromEnv,
  publishClaim,
  syncClaims,
  verifyClaimOffline,
  type FleetClaimsConfig,
} from "./claims-repo.ts";

function flagString(input: KernelCommandInput, key: string): string | undefined {
  const v = input.flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagBool(input: KernelCommandInput, key: string): boolean {
  return input.flags[key] === true;
}

const DEFAULT_LOCAL_PATH = ".werkstatt/fleet-claims";

// ---------------------------------------------------------------------------
// fleet.claims.init
// ---------------------------------------------------------------------------

export async function runFleetClaimsInit(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const remote = flagString(input, "remote");
  if (!remote) {
    return {
      exitCode: 1,
      summary: "fleet.claims.init: --remote flag is required",
      data: { error: "missing --remote flag" },
    };
  }

  const remotes = remote
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const localPath = flagString(input, "local-path") ?? DEFAULT_LOCAL_PATH;
  const workerUrl = flagString(input, "worker-url");

  try {
    const config: FleetClaimsConfig = { remotes, localPath, workerUrl };
    const configPath = path.join(context.workspaceRoot, "werkstatt.fleet.json");
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");

    const clonePath = await ensureClaimsClone(context.workspaceRoot, config);

    return {
      exitCode: 0,
      summary: `[fleet.claims.init] configured ${remotes.length} remote(s), clone at ${localPath}`,
      data: {
        command: "fleet.claims.init",
        configPath,
        clonePath,
        remotes,
      },
    };
  } catch (err) {
    return {
      exitCode: 1,
      summary: `[fleet.claims.init] failed: ${err instanceof Error ? err.message : String(err)}`,
      data: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

// ---------------------------------------------------------------------------
// fleet.claims.publish
// ---------------------------------------------------------------------------

export async function runFleetClaimsPublish(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const systemId = flagString(input, "id");
  if (!systemId) {
    return {
      exitCode: 1,
      summary: "fleet.claims.publish: --id flag is required",
      data: { error: "missing --id flag" },
    };
  }

  const key = await loadSigningKeyFromEnv();
  if (!key) {
    return {
      exitCode: 1,
      summary:
        "fleet.claims.publish: no signing key — set SIGNING_PRIVATE_KEY or SIGNING_PRIVATE_KEY_PATH",
      data: { error: "no signing key configured" },
    };
  }

  try {
    const result = await publishClaim({
      systemId,
      werkstattRoot: context.workspaceRoot,
      signerPrivateKeyHex: key.privateKeyHex,
      signerPublicKey: key.publicKeyHex,
      authorizationHash: flagString(input, "authorization-hash") ?? null,
      push: !flagBool(input, "no-push"),
    });

    const warn =
      result.pushErrors.length > 0
        ? ` (push failed: ${result.pushErrors.join("; ")} — retry via fleet.claims.sync)`
        : "";
    return {
      exitCode: 0,
      summary: `[fleet.claims.publish] ${systemId} claim ${result.claim.passportHash.slice(0, 16)} committed${warn}`,
      data: {
        command: "fleet.claims.publish",
        systemId,
        passportHash: result.claim.passportHash,
        commit: result.commit,
        pushed: result.pushed,
        pushErrors: result.pushErrors,
      },
    };
  } catch (err) {
    return {
      exitCode: 1,
      summary: `[fleet.claims.publish] failed: ${err instanceof Error ? err.message : String(err)}`,
      data: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

// ---------------------------------------------------------------------------
// fleet.claims.sync
// ---------------------------------------------------------------------------

export async function runFleetClaimsSync(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  try {
    const result = await syncClaims(context.workspaceRoot);

    const divergedNote =
      result.diverged.length > 0
        ? ` DIVERGED: ${result.diverged.map((d) => `${d.remote} (${d.files.join(",")})`).join("; ")} — manual resolution required, never auto-merged`
        : "";
    const invalidNote =
      result.invalidClaims.length > 0
        ? ` invalid signatures: ${result.invalidClaims.join(",")}`
        : "";

    return {
      exitCode: result.diverged.length > 0 ? 1 : 0,
      summary:
        `[fleet.claims.sync] fetched ${result.fetched.length} remote(s), ` +
        `${result.fastForwarded ? "fast-forwarded" : "no ff"}, ` +
        `${result.pushed ? "pushed" : "not pushed"}${divergedNote}${invalidNote}`,
      data: { command: "fleet.claims.sync", ...result },
    };
  } catch (err) {
    return {
      exitCode: 1,
      summary: `[fleet.claims.sync] failed: ${err instanceof Error ? err.message : String(err)}`,
      data: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

// ---------------------------------------------------------------------------
// fleet.claims.verify
// ---------------------------------------------------------------------------

export async function runFleetClaimsVerify(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const systemId = flagString(input, "id");
  if (!systemId) {
    return {
      exitCode: 1,
      summary: "fleet.claims.verify: --id flag is required",
      data: { error: "missing --id flag" },
    };
  }

  try {
    const result = await verifyClaimOffline({
      systemId,
      werkstattRoot: context.workspaceRoot,
    });

    // invalid-signature and stale are blocking verdicts (RFC-1124 failure modes).
    const blocking = result.verdict === "invalid-signature" || result.verdict === "stale";
    return {
      exitCode: blocking ? 1 : 0,
      summary: `[fleet.claims.verify] ${systemId}: ${result.verdict}${
        result.claim ? ` (${result.claim.creatorIdentity}, ${result.claim.instanceId})` : ""
      }${result.conflicts.length > 0 ? ` — ${result.conflicts.length} conflict(s)` : ""}`,
      data: { command: "fleet.claims.verify", ...result },
    };
  } catch (err) {
    return {
      exitCode: 1,
      summary: `[fleet.claims.verify] failed: ${err instanceof Error ? err.message : String(err)}`,
      data: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

// ---------------------------------------------------------------------------
// fleet.claims.status
// ---------------------------------------------------------------------------

export async function runFleetClaimsStatus(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  try {
    const result = await claimsStatus(context.workspaceRoot);
    return {
      exitCode: 0,
      summary: result.configured
        ? `[fleet.claims.status] ${result.claims} claim(s), ${result.unpushedCommits} unpushed commit(s), last sync ${result.lastSyncAt ?? "never"}`
        : `[fleet.claims.status] not configured — run fleet.claims.init --remote <url>`,
      data: { command: "fleet.claims.status", ...result },
    };
  } catch (err) {
    return {
      exitCode: 1,
      summary: `[fleet.claims.status] failed: ${err instanceof Error ? err.message : String(err)}`,
      data: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}
