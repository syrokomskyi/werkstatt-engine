/*
<MODULE_CONTRACT>
  <purpose>RFC-1191: lagebild.referral.issue / lagebild.referral.list — operator commands
  over the Lagebild referral-registry transport (POST/GET /v1/referrals). Issue creates a
  recommender code and returns the shareable <site-origin>/?ref=<code> link; list renders
  the registry rows. Reads LAGEBILD_API_URL/LAGEBILD_TENANT_ID from system-state and the
  LAGEBILD_API_KEY from the cache-clone .env — never logs the key.</purpose>
  <non-goals>
    <item>Do not store codes locally — Lagebild owns the registry; this is a thin client.</item>
    <item>Do not log or echo the API key.</item>
    <item>Do not resolve codes against contacts — resolution is Lagebild-internal.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1191: initial referral.issue / referral.list command handlers.</item>
</CHANGE_SUMMARY>
*/

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
import { sourceDotenv, filterEnv } from "../leitstand/adapters/index.ts";
import type { ChannelName } from "./lagebild-helpers.ts";

function flagString(input: KernelCommandInput, name: string): string | undefined {
  const v = input.flags[name];
  return typeof v === "string" ? v : undefined;
}

interface ReferralCredentials {
  apiUrl: string;
  apiKey: string;
  tenantId: string;
}

async function resolveReferralCredentials(
  workspaceRoot: string,
  systemId: string,
): Promise<ReferralCredentials> {
  const state = await readSystemStateSmart(workspaceRoot, systemId);
  const lagebild = state.lagebild;
  if (!lagebild?.connected || !lagebild.apiUrl || !lagebild.tenantId) {
    throw new Error(
      `[lagebild.referral] Site '${systemId}' is not connected to Lagebild — run lagebild.connect first.`,
    );
  }
  const envPath = join(resolveCacheClonePath(workspaceRoot, systemId), ".env");
  const secretsEnv = (await sourceDotenv(envPath).catch(() => ({}))) as Record<
    string,
    string | undefined
  >;
  const env: Record<string, string | undefined> = {
    ...filterEnv(process.env as Record<string, string | undefined>),
    ...secretsEnv,
  };
  const apiKey = env.LAGEBILD_API_KEY;
  if (!apiKey) {
    throw new Error("[lagebild.referral] LAGEBILD_API_KEY not found in .env or environment.");
  }
  return { apiUrl: lagebild.apiUrl, apiKey, tenantId: lagebild.tenantId };
}

export interface ReferralIssueResult {
  site: string;
  refCode: string;
  url: string;
}

export interface ReferralListResult {
  site: string;
  rows: unknown[];
}

export async function runLagebildReferralIssue(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ReferralIssueResult>> {
  const systemId = flagString(input, "site");
  if (!systemId) throw new Error("[lagebild.referral.issue] --site is required");
  const contact = flagString(input, "contact");
  if (!contact) throw new Error("[lagebild.referral.issue] --contact is required");
  const channel = (flagString(input, "channel") ?? "main") as ChannelName;

  const { apiUrl, apiKey } = await resolveReferralCredentials(context.workspaceRoot, systemId);

  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/referrals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ contact_email: contact }),
  });
  if (!response.ok) {
    throw new Error(`[lagebild.referral.issue] POST /v1/referrals failed: ${response.status}`);
  }
  const body = (await response.json().catch(() => ({}))) as { ref_code?: string };
  const refCode = body.ref_code;
  if (!refCode) {
    throw new Error("[lagebild.referral.issue] POST /v1/referrals returned no ref_code");
  }

  const config = await readSystemConfigSmart(context.workspaceRoot, systemId);
  const origin = config.deployment?.channels[channel]?.url?.replace(/\/$/, "");
  if (!origin) {
    throw new Error(
      `[lagebild.referral.issue] No deployment.channels.${channel}.url in system-config.yaml.`,
    );
  }

  return { data: { site: systemId, refCode, url: `${origin}/?ref=${refCode}` } };
}

export async function runLagebildReferralList(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<ReferralListResult>> {
  const systemId = flagString(input, "site");
  if (!systemId) throw new Error("[lagebild.referral.list] --site is required");

  const { apiUrl, apiKey } = await resolveReferralCredentials(context.workspaceRoot, systemId);

  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/referrals`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`[lagebild.referral.list] GET /v1/referrals failed: ${response.status}`);
  }
  const body = (await response.json().catch(() => ({}))) as { rows?: unknown[] };
  return { data: { site: systemId, rows: body.rows ?? [] } };
}
