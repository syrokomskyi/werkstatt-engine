/*
<MODULE_CONTRACT>
<purpose>
RFC-1326: cloudflare.token.check — read-only preflight that verifies the
workshop CLOUDFLARE_API_TOKEN is active and probes every permission in the
shared CLOUDFLARE_PERMISSIONS registry. Prints each permission as
ok / missing / unknown and exits non-zero when an `always` permission is
missing — so a missing grant is named before the first write, never
discovered by a failing deploy.
</purpose>
<non-goals>
  <item>Do not create, roll, or revoke tokens — operator-only (dashboard).</item>
  <item>Do not write probes — unprobeable (write-only) permissions report unknown.</item>
</non-goals>
<KEY_DECISIONS>
  <item>--zone accepts a zone id or a domain (resolved via GET /zones?name=); no zone context downgrades every zone-scope entry to unknown, never missing.</item>
</KEY_DECISIONS>
<CHANGE_SUMMARY>
  <item>RFC-1326 review-unblock: token-inactive return gains [command] summary prefix + nextSteps (CMD-OUTPUT-02/03).</item>
  <item>RFC-1326: initial — verifyToken + registry probes, ok/missing/unknown verdicts, exit 1 on missing always-permission.</item>
  <item>RFC-1326: single Cloudflare permission registry, token preflight, birth provisioning</item>
  <item>RFC-1329: legal pages by jurisdiction — legal.scaffold keys on manifest.legalJurisdiction, LEGAL-JUR-01

legal.scaffold resolves target locales from system.md legalJurisdiction: a
DE/AT/CH jurisdiction scaffolds impressum + datenschutz on every i18n.supported
locale with canonical German slugs — binding locales carry the German document
natively, others carry the same German text + RFC-0174 unofficial-translation
block + NEED_THIS_TRANSLATION unofficial prose slot. Absent jurisdiction keeps
the legacy DE_LOCALES filter byte-identical. legal.translation.validate gains
LEGAL-JUR-01 and relaxes missing-binding-lang for the jurisdiction binding
language (binding text is inline). Drive-by: cloudflare.token.check
token-inactive path gains summary prefix + nextSteps (CMD-OUTPUT-02/03).</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandDefinition,
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import {
  CLOUDFLARE_PERMISSIONS,
  cloudflarePermissionScopeLabel,
} from "@warpgogol/werkstatt-shared/cloudflare/permissions";
import type { CloudflarePermission } from "@warpgogol/werkstatt-shared/cloudflare/permissions";
import { probePermission, resolveZoneIdByName, verifyToken } from "./adapters/cloudflare-api.ts";
import { failResult } from "@warpgogol/werkstatt-shared/checks/result-helpers";

const ZONE_ID_PATTERN = /^[0-9a-f]{32}$/i;

export interface PermissionProbeResult {
  id: string;
  label: string;
  scope: "account" | "zone";
  requiredFor: "always" | "custom-domain";
  outcome: "ok" | "missing" | "unknown";
  detail?: string;
}

async function resolveZoneId(
  flag: string | undefined,
  apiToken: string,
): Promise<{ zoneId: string | null; source: string }> {
  const candidate = flag ?? process.env.CLOUDFLARE_ZONE_ID;
  if (!candidate) return { zoneId: null, source: "none" };
  if (ZONE_ID_PATTERN.test(candidate)) return { zoneId: candidate, source: "id" };
  const resolved = await resolveZoneIdByName(candidate, apiToken);
  return { zoneId: resolved, source: resolved ? "domain" : "unresolved" };
}

export async function runCloudflareTokenCheck(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult> {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) {
    return failResult("cloudflare.token.check", [
      "CLOUDFLARE_API_TOKEN is not set — the kernel resolves it from the workshop .env (RFC-1326); create a token per docs/engineering/workshop-setup.md §3",
    ]);
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    return failResult("cloudflare.token.check", [
      "CLOUDFLARE_ACCOUNT_ID is not set — account-scope probes cannot run",
    ]);
  }

  let token: { id: string; status: string };
  try {
    token = await verifyToken(apiToken);
  } catch (err) {
    return failResult("cloudflare.token.check", [
      `token verify failed: ${err instanceof Error ? err.message : String(err)}`,
    ]);
  }
  if (token.status !== "active") {
    return {
      data: {
        command: "cloudflare.token.check",
        status: "fail",
        tokenId: token.id,
        tokenStatus: token.status,
      },
      exitCode: 1,
      summary: `[cloudflare.token.check] token-inactive — Cloudflare reports status "${token.status}" for token ${token.id}; roll it in the dashboard`,
      nextSteps: [
        {
          action: `Roll token ${token.id} in Cloudflare Dashboard → My Profile → API Tokens, update CLOUDFLARE_API_TOKEN, then re-run cloudflare.token.check`,
          kind: "required" as const,
        },
      ],
    };
  }

  const zoneFlag =
    typeof input.flags.zone === "string" && input.flags.zone.length > 0
      ? input.flags.zone
      : undefined;
  const zone = await resolveZoneId(zoneFlag, apiToken);

  const noZoneReason =
    zone.zoneId !== null
      ? null
      : zone.source === "unresolved"
        ? `zone "${zoneFlag ?? process.env.CLOUDFLARE_ZONE_ID}" unresolved`
        : "no zone context — pass --zone <id|domain> or set CLOUDFLARE_ZONE_ID";

  const results: PermissionProbeResult[] = [];
  for (const permission of CLOUDFLARE_PERMISSIONS) {
    results.push(await probeOne(permission, apiToken, accountId, zone.zoneId, noZoneReason));
  }

  const missing = results.filter((r) => r.outcome === "missing");
  const unknown = results.filter((r) => r.outcome === "unknown");
  for (const r of results) {
    const pad = r.id.padEnd(38);
    context.logger.info(
      `  [cloudflare.token.check] ${r.outcome.padEnd(7)} ${pad} ${r.label} → ${r.requiredFor}` +
        (r.detail ? ` — ${r.detail}` : ""),
    );
  }
  context.logger.info(
    `  [cloudflare.token.check] token ${token.id} (${token.status}); ` +
      `${results.length - missing.length - unknown.length} ok, ` +
      `${missing.length} missing, ${unknown.length} unknown`,
  );

  const alwaysMissing = missing.filter((r) => r.requiredFor === "always");
  const status = alwaysMissing.length > 0 ? "fail" : missing.length > 0 ? "warn" : "pass";
  const summary =
    alwaysMissing.length > 0
      ? `cloudflare.token.check: missing required permission(s): ${alwaysMissing
          .map((r) => r.id)
          .join(", ")} — add them in the dashboard (docs/engineering/workshop-setup.md §3.2)`
      : missing.length > 0
        ? `cloudflare.token.check: all required permissions present; ${missing.length} custom-domain permission(s) missing — needed once a client domain is live`
        : "cloudflare.token.check: token verified, all required permissions present";

  return {
    data: {
      command: "cloudflare.token.check",
      status,
      tokenId: token.id,
      tokenStatus: token.status,
      zoneId: zone.zoneId,
      results,
      missing: missing.map((r) => r.id),
      unknown: unknown.map((r) => r.id),
    },
    exitCode: alwaysMissing.length > 0 ? 1 : 0,
    summary,
    ...(alwaysMissing.length > 0
      ? {
          nextSteps: [
            {
              action:
                `Add ${alwaysMissing.map((r) => `${r.label} → ${r.requiredFor}`).join(", ")} ` +
                `to the token ${token.id} in Cloudflare Dashboard → My Profile → API Tokens, then re-run cloudflare.token.check`,
              kind: "required" as const,
            },
          ],
        }
      : {}),
  };
}

async function probeOne(
  permission: CloudflarePermission,
  apiToken: string,
  accountId: string,
  zoneId: string | null,
  noZoneReason: string | null,
): Promise<PermissionProbeResult> {
  const base: PermissionProbeResult = {
    id: permission.id,
    label: cloudflarePermissionScopeLabel(permission),
    scope: permission.scope,
    requiredFor: permission.requiredFor,
    outcome: "unknown",
  };
  if (permission.probe === null) {
    return { ...base, detail: "unprobeable — write-only permission" };
  }
  if (permission.scope === "zone" && zoneId === null) {
    return { ...base, detail: noZoneReason ?? "no zone context" };
  }
  const path = permission.probe.path
    .replace("{accountId}", accountId)
    .replace("{zoneId}", zoneId ?? "");
  return { ...base, outcome: await probePermission(path, apiToken) };
}

export const cloudflareTokenCheckCommand: KernelCommandDefinition = {
  name: "cloudflare.token.check",
  modulePath: "packages/werkstatt-engine/src/leitstand/cloudflare-token-check.ts",
  generates: [],
  envInputs: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ZONE_ID"],
  description:
    "Verify CLOUDFLARE_API_TOKEN is active and probe every CLOUDFLARE_PERMISSIONS entry read-only; names the missing permission before any deploy fails on it (RFC-1326). Flags: [--zone <id|domain>].",
  scope: "workspace",
  flags: {
    zone: {
      kind: "string",
      description:
        "Zone id or domain for zone-scope probes; falls back to CLOUDFLARE_ZONE_ID. Without zone context, zone permissions report unknown.",
    },
  },
  mutatesState: false,
  idempotency: "rerun-safe",
  requiresNetwork: true,
  contract: "cloudflare",
  rules: [],
  writes: [],
  reads: [],
  modulePaths: ["cloudflare-token-check.ts"],
  execute: runCloudflareTokenCheck,
};
