/*
<MODULE_CONTRACT>
<purpose>observability.alerts.apply — converge SigNoz backend to the declared alert rules (RFC-0342).</purpose>
<non-goals>
  <item>Never touch unmanaged objects.</item>
  <item>Never run in pipelines — ops-only.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0342: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import type {
  CheckResult,
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { diagnosticsResult } from "@warpgogol/werkstatt-shared/checks";
import {
  createSignozApiClient,
  type SignozAlertRule,
  type SignozApplyPlan,
  type SignozChannel,
} from "../signoz-api-client.ts";
import { ALERT_RULES, NOTIFICATION_CHANNELS } from "../alert-rules.ts";

function _stripGeneratedHeader(text: string): string {
  return text.replace(/^\/\/ GENERATED.*\n/, "");
}

function buildPlan(
  currentRules: SignozAlertRule[],
  currentChannels: SignozChannel[],
): SignozApplyPlan {
  const desiredRules = new Map<string, SignozAlertRule>();
  for (const rule of ALERT_RULES) {
    desiredRules.set(rule.id, {
      ...rule,
      labels: { ...rule.labels, managed_by: "warpgogol" },
    });
  }

  const desiredChannels = new Map<string, SignozChannel>();
  for (const ch of NOTIFICATION_CHANNELS) {
    desiredChannels.set(ch.id, { ...ch });
  }

  const currentRuleIds = new Set(currentRules.map((r) => r.id));
  const currentChannelIds = new Set(currentChannels.map((c) => c.id));

  const rulesToCreate: SignozAlertRule[] = [];
  const rulesToUpdate: SignozAlertRule[] = [];
  const rulesToDelete: string[] = [];

  for (const [id, rule] of desiredRules) {
    if (!currentRuleIds.has(id)) {
      rulesToCreate.push(rule);
    } else {
      rulesToUpdate.push(rule);
    }
  }
  for (const id of currentRuleIds) {
    if (!desiredRules.has(id)) rulesToDelete.push(id);
  }

  const channelsToCreate: SignozChannel[] = [];
  const channelsToUpdate: SignozChannel[] = [];
  const channelsToDelete: string[] = [];

  for (const [id, ch] of desiredChannels) {
    if (!currentChannelIds.has(id)) {
      channelsToCreate.push(ch);
    } else {
      channelsToUpdate.push(ch);
    }
  }
  for (const id of currentChannelIds) {
    if (!desiredChannels.has(id)) channelsToDelete.push(id);
  }

  return {
    rules: { create: rulesToCreate, update: rulesToUpdate, delete: rulesToDelete },
    channels: { create: channelsToCreate, update: channelsToUpdate, delete: channelsToDelete },
  };
}

export async function runObservabilityAlertsApply(
  input: KernelCommandInput,
  _context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  const dryRun = input.argv.includes("--dry-run");

  const apiUrl = process.env["WARPGOGOL_SIGNOZ_API_URL"];
  const apiToken = process.env["WARPGOGOL_SIGNOZ_API_TOKEN"];

  if (!apiUrl || !apiToken) {
    return diagnosticsResult("observability.alerts.apply", [
      {
        ruleId: "OBS-ALR-APPLY-ENV",
        severity: "error",
        file: "",
        message:
          "WARPGOGOL_SIGNOZ_API_URL and WARPGOGOL_SIGNOZ_API_TOKEN must be set to apply alerts.",
        fixHint:
          "Set both env vars: WARPGOGOL_SIGNOZ_API_URL=https://observe.warpgogol.com WARPGOGOL_SIGNOZ_API_TOKEN=<key>",
      },
    ]);
  }

  const client = createSignozApiClient({ apiUrl, apiToken });

  const currentRules = await client.listManagedRules();
  const currentChannels = await client.listManagedChannels();

  const plan = buildPlan(currentRules, currentChannels);

  const planSummary =
    `Rules: ${plan.rules.create.length} create, ${plan.rules.update.length} update, ${plan.rules.delete.length} delete. ` +
    `Channels: ${plan.channels.create.length} create, ${plan.channels.update.length} update, ${plan.channels.delete.length} delete.`;

  if (dryRun) {
    return diagnosticsResult("observability.alerts.apply", [
      {
        ruleId: "OBS-ALR-APPLY-DRY-RUN",
        severity: "info",
        file: "",
        message: `Dry-run plan: ${planSummary}`,
        fixHint: "Run without --dry-run to apply.",
      },
    ]);
  }

  // Apply
  for (const ch of plan.channels.create) await client.createChannel(ch);
  for (const ch of plan.channels.update) await client.updateChannel(ch);
  for (const id of plan.channels.delete) await client.deleteChannel(id);

  for (const rule of plan.rules.create) await client.createRule(rule);
  for (const rule of plan.rules.update) await client.updateRule(rule);
  for (const id of plan.rules.delete) await client.deleteRule(id);

  // Verify convergence
  const postRules = await client.listManagedRules();
  const postChannels = await client.listManagedChannels();
  const postPlan = buildPlan(postRules, postChannels);
  const converged =
    postPlan.rules.create.length === 0 &&
    postPlan.rules.update.length === 0 &&
    postPlan.rules.delete.length === 0 &&
    postPlan.channels.create.length === 0 &&
    postPlan.channels.update.length === 0 &&
    postPlan.channels.delete.length === 0;

  return diagnosticsResult("observability.alerts.apply", [
    {
      ruleId: converged ? "OBS-ALR-APPLY-OK" : "OBS-ALR-APPLY-NOT-CONVERGED",
      severity: converged ? "info" : "error",
      file: "",
      message: converged
        ? `Applied successfully: ${planSummary}`
        : `Apply did not converge. Remaining: ${JSON.stringify(postPlan)}`,
      fixHint: converged ? "" : "Check the SigNoz API for errors and re-run.",
    },
  ]);
}
