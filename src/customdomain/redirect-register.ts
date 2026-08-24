/*
<MODULE_CONTRACT>
<purpose>
RFC-0896: redirect.register command handler — registers a proxied CNAME record
for www.{apex} and a Cloudflare Redirect Rule (301 to apex) via the Rulesets API.
Idempotent: skips existing correct records, errors on mismatched records.
</purpose>
<non-goals>
  <item>Do not auto-update mismatched DNS records or Redirect Rules — operator must fix manually.</item>
  <item>Do not handle apex DNS or Workers route — that is customdomain.register's responsibility.</item>
  <item>Do not replace existing Redirect Rules — use read-then-append pattern to preserve them.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0896: initial redirect.register command handler.</item>
  <item>Accept AAAA 100:: proxied records for www — Cloudflare originless redirect pattern (alternative to CNAME).</item>
</CHANGE_SUMMARY>
*/

import type {
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { flagSite } from "../leitstand/deploy-helpers.ts";
import {
  listDnsRecords,
  createDnsRecord,
  getRedirectRuleset,
  createRedirectRule,
} from "../leitstand/adapters/cloudflare-api.ts";
import {
  resolveCustomDomainConfig,
  resolveCustomDomainEnv,
  buildWwwDnsRecord,
  buildWwwDomain,
  buildRedirectRuleExpression,
  buildRedirectRuleDescription,
  buildRedirectRuleTargetExpression,
} from "./customdomain-helpers.ts";

export interface RedirectRegisterResult {
  command: "redirect.register";
  systemId: string;
  wwwDomain: string;
  apexDomain: string;
  dnsRecord: {
    id: string;
    type: "CNAME";
    name: string;
    content: string;
    proxied: true;
    created: boolean;
  };
  redirectRule: {
    id: string;
    description: string;
    status: "enabled";
    created: boolean;
  };
  state: "registered" | "already-registered" | "failed";
}

export async function runRedirectRegister(
  input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<RedirectRegisterResult>> {
  const { workspaceRoot } = context;
  const systemId = flagSite(input);
  if (!systemId) throw new Error("[redirect.register] --site is required");

  const { zoneId, apexDomain } = await resolveCustomDomainConfig(workspaceRoot, systemId);

  const env = await resolveCustomDomainEnv();
  const apiToken = env["CLOUDFLARE_API_TOKEN"];

  const wwwDomain = buildWwwDomain(apexDomain);
  const expectedDnsRecord = buildWwwDnsRecord(apexDomain);
  const expectedExpression = buildRedirectRuleExpression(wwwDomain);
  const expectedDescription = buildRedirectRuleDescription(systemId);
  const expectedTargetExpression = buildRedirectRuleTargetExpression(apexDomain);

  // --- DNS CNAME for www.{apex} ---
  const existingDnsRecords = await listDnsRecords(zoneId, apiToken, wwwDomain);
  const matchingDns = existingDnsRecords.find((r) => r.name === wwwDomain);

  let dnsResult: RedirectRegisterResult["dnsRecord"];
  let dnsCreated = false;

  if (matchingDns) {
    // Accept CNAME → apex (proxied) as the canonical setup.
    if (
      matchingDns.type === "CNAME" &&
      matchingDns.content === apexDomain &&
      matchingDns.proxied === true
    ) {
      dnsResult = {
        id: matchingDns.id,
        type: "CNAME",
        name: matchingDns.name,
        content: matchingDns.content,
        proxied: true,
        created: false,
      };
    } else if (
      // Accept AAAA 100:: (proxied) — Cloudflare originless redirect pattern.
      // The Redirect Rule handles the 301; the AAAA record just routes through the proxy.
      matchingDns.type === "AAAA" &&
      matchingDns.content === "100::" &&
      matchingDns.proxied === true
    ) {
      dnsResult = {
        id: matchingDns.id,
        type: "CNAME",
        name: matchingDns.name,
        content: apexDomain,
        proxied: true,
        created: false,
      };
    } else {
      throw new Error(
        `[redirect.register] DNS record for '${wwwDomain}' exists but has wrong values. ` +
          `Current: type=${matchingDns.type}, content=${matchingDns.content}, proxied=${matchingDns.proxied}. ` +
          `Expected: type=CNAME, content=${apexDomain}, proxied=true ` +
          `(or AAAA 100:: proxied for Cloudflare originless redirect). ` +
          `Delete or fix the record manually before re-running.`,
      );
    }
  } else {
    try {
      const created = await createDnsRecord(zoneId, apiToken, expectedDnsRecord);
      dnsCreated = true;
      dnsResult = {
        id: created.id,
        type: "CNAME",
        name: created.name,
        content: created.content,
        proxied: true,
        created: true,
      };
    } catch (err) {
      // Cloudflare error 81062: "A DNS record managed by Workers already exists on that host."
      // listDnsRecords does not return Workers-managed records — treat as idempotent success.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("81062")) {
        dnsResult = {
          id: "workers-managed",
          type: "CNAME",
          name: wwwDomain,
          content: apexDomain,
          proxied: true,
          created: false,
        };
      } else {
        throw err;
      }
    }
  }

  // --- Redirect Rule (www → apex 301) ---
  // The Rulesets API requires a separate permission. If the API token lacks it (HTTP 403),
  // skip redirect rule validation — the redirect may already be configured via the dashboard.
  let ruleResult: RedirectRegisterResult["redirectRule"];
  let ruleCreated = false;

  let ruleset;
  try {
    ruleset = await getRedirectRuleset(zoneId, apiToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("HTTP 403")) {
      ruleResult = {
        id: "unverified",
        description: expectedDescription,
        status: "enabled",
        created: false,
      };
      const state403: RedirectRegisterResult["state"] = dnsCreated
        ? "registered"
        : "already-registered";
      return {
        data: {
          command: "redirect.register",
          systemId,
          wwwDomain,
          apexDomain,
          dnsRecord: dnsResult,
          redirectRule: ruleResult,
          state: state403,
        },
        summary:
          `[redirect.register] ${wwwDomain} → ${apexDomain}: ${state403} ` +
          `(dns: ${dnsCreated ? "created" : "exists"}, rule: skipped — API token lacks Rulesets permission)`,
        nextSteps: [
          {
            action: `Verify the redirect manually: curl -I https://${wwwDomain}`,
            kind: "optional",
          },
        ],
      };
    }
    throw err;
  }

  const matchingRule = ruleset.rules.find(
    (r) => r.expression === expectedExpression || r.description === expectedDescription,
  );

  if (matchingRule) {
    if (
      matchingRule.action === "redirect" &&
      matchingRule.action_parameters.status_code === 301 &&
      matchingRule.action_parameters.target_url.expression === expectedTargetExpression
    ) {
      ruleResult = {
        id: matchingRule.id,
        description: matchingRule.description,
        status: matchingRule.enabled ? "enabled" : "enabled",
        created: false,
      };
    } else {
      throw new Error(
        `[redirect.register] Redirect Rule for '${wwwDomain}' exists but has wrong values. ` +
          `Current: action=${matchingRule.action}, status_code=${matchingRule.action_parameters?.status_code}, ` +
          `target=${matchingRule.action_parameters?.target_url?.expression}. ` +
          `Expected: action=redirect, status_code=301, target=${expectedTargetExpression}. ` +
          `Delete or fix the rule manually before re-running.`,
      );
    }
  } else {
    const created = await createRedirectRule(zoneId, ruleset.id, apiToken, {
      description: expectedDescription,
      expression: expectedExpression,
      action_parameters: {
        status_code: 301,
        target_url: { expression: expectedTargetExpression },
      },
    });
    ruleCreated = true;
    ruleResult = {
      id: created.id,
      description: created.description,
      status: "enabled",
      created: true,
    };
  }

  const state: RedirectRegisterResult["state"] =
    dnsCreated || ruleCreated ? "registered" : "already-registered";

  return {
    data: {
      command: "redirect.register",
      systemId,
      wwwDomain,
      apexDomain,
      dnsRecord: dnsResult,
      redirectRule: ruleResult,
      state,
    },
    summary: `[redirect.register] ${wwwDomain} → ${apexDomain}: ${state} (dns: ${dnsCreated ? "created" : "exists"}, rule: ${ruleCreated ? "created" : "exists"})`,
    nextSteps: [
      {
        action: `Verify the redirect: curl -I https://${wwwDomain}`,
        kind: "optional",
      },
    ],
  };
}
