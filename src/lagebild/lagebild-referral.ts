/*
<MODULE_CONTRACT>
  <purpose>RFC-1191→1198: lagebild.referral.issue / lagebild.referral.list — operator commands
  over the Lagebild referral-partner transport (POST/GET /v1/referrals). Issue registers a
  human-readable partner slug and returns the shareable <site-origin>/r/<slug> link; list
  renders the registry rows. Reads LAGEBILD_API_URL/LAGEBILD_TENANT_ID from system-state and
  the LAGEBILD_API_KEY from the cache-clone .env — never logs the key.</purpose>
  <non-goals>
    <item>Do not store partner data locally — Lagebild owns the registry; this is a thin client.</item>
    <item>Do not log or echo the API key.</item>
    <item>The slug here registers the CRM-side partner identity only — the public /r/<slug> page still requires the site-side partners.yaml entry (mission workpiece) per RFC-1198.</item>
  </non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1191: initial referral.issue / referral.list command handlers.</item>
  <item>RFC-1198: issue takes --slug/--name, returns /r/<slug> link; opaque-code pattern replaced by REFERRAL_SLUG_PATTERN.</item>
  <item>RFC-1198: cookie-free referral attribution — /r/<slug> partner landings + voluntary referrer field

Replace the RFC-1191 wg_ref cookie capture with URL+form attribution:
static /r/<slug> and /<lang>/r/<slug> partner landings (noindex, zero JS,
consent-gated via publicNameConsentRef), ?ref prefill on the existing
referrerField rail, server-side slug resolution against the bundled
partners.yaml, referral_partner_slug/name on the Lagebild ingress contract,
legacy /?ref -> /r/<slug> 302 in the generated worker, and full removal of
the cookie capture module (wg_ref, referral.attribution entitlement,
payload.attribution).</item>
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
import { REFERRAL_SLUG_PATTERN } from "@warpgogol/werkstatt-shared/referral";
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
  slug: string;
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
  const slug = flagString(input, "slug");
  if (!slug || !REFERRAL_SLUG_PATTERN.test(slug)) {
    throw new Error(
      "[lagebild.referral.issue] --slug is required and must match the referral slug pattern (kebab-case, 3–32 chars).",
    );
  }
  const displayName = flagString(input, "name");
  if (!displayName) throw new Error("[lagebild.referral.issue] --name is required");
  const contact = flagString(input, "contact");
  const channel = (flagString(input, "channel") ?? "main") as ChannelName;

  const { apiUrl, apiKey } = await resolveReferralCredentials(context.workspaceRoot, systemId);

  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/referrals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      slug,
      display_name: displayName,
      ...(contact ? { contact_email: contact } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`[lagebild.referral.issue] POST /v1/referrals failed: ${response.status}`);
  }
  const body = (await response.json().catch(() => ({}))) as { slug?: string };
  if (!body.slug || !REFERRAL_SLUG_PATTERN.test(body.slug)) {
    throw new Error("[lagebild.referral.issue] POST /v1/referrals returned a missing/invalid slug");
  }

  const config = await readSystemConfigSmart(context.workspaceRoot, systemId);
  const origin = config.deployment?.channels[channel]?.url?.replace(/\/$/, "");
  if (!origin) {
    throw new Error(
      `[lagebild.referral.issue] No deployment.channels.${channel}.url in system-config.yaml.`,
    );
  }

  return { data: { site: systemId, slug: body.slug, url: `${origin}/r/${body.slug}` } };
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
