/*
<MODULE_CONTRACT>
<purpose>observability.alerts.validate — offline lint for the alert rule projection (RFC-0342).</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0342: initial implementation.</item>
</CHANGE_SUMMARY>
*/

import { join } from "node:path";
import type {
  CheckResult,
  Diagnostic,
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { diagnosticsResult } from "@warpgogol/werkstatt-shared/checks";
import { WARPGOGOL_METRIC_REGISTRY } from "@warpgogol/werkstatt-shared/observability";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { ALERT_RULES, NOTIFICATION_CHANNELS } from "../alert-rules.ts";

const METRIC_NAME_REGEX = /warpgogol_[a-z0-9_]+/g;

export async function runObservabilityAlertsValidate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  const diagnostics: Diagnostic[] = [];
  const root = context.workspaceRoot;
  const projectionPath = join(root, "docs", "observability", "alerts.generated.yaml");

  // OBS-ALR-01: check file exists and is fresh
  if (!(await context.io.exists(projectionPath))) {
    diagnostics.push({
      ruleId: "OBS-ALR-01",
      severity: "error",
      file: "docs/observability/alerts.generated.yaml",
      message: "alerts.generated.yaml does not exist — run observability.alerts.generate.",
      fixHint: "Run: pnpm exec werkstatt run observability.alerts.generate",
    });
    return diagnosticsResult("observability.alerts.validate", diagnostics);
  }

  // Check freshness by comparing source-sorted rules with the projection
  const expectedRules = [...ALERT_RULES].sort((a, b) => a.id.localeCompare(b.id));
  const expectedChannels = [...NOTIFICATION_CHANNELS].sort((a, b) => a.id.localeCompare(b.id));
  const expectedProjection = {
    schemaVersion: 1,
    generatedBy: "observability.alerts.generate",
    rules: expectedRules,
    channels: expectedChannels,
  };

  const rawText = await context.io.readFile(projectionPath);
  let projection: typeof expectedProjection;
  try {
    projection = yamlParse(rawText) as typeof expectedProjection;
  } catch {
    diagnostics.push({
      ruleId: "OBS-ALR-01",
      severity: "error",
      file: "docs/observability/alerts.generated.yaml",
      message: "alerts.generated.yaml is not valid YAML.",
      fixHint: "Regenerate: pnpm exec werkstatt run observability.alerts.generate",
    });
    return diagnosticsResult("observability.alerts.validate", diagnostics);
  }

  const expectedJson = yamlStringify(expectedProjection);
  const actualJson = yamlStringify({
    schemaVersion: projection.schemaVersion,
    generatedBy: projection.generatedBy,
    rules: projection.rules,
    channels: projection.channels,
  });

  if (expectedJson !== actualJson) {
    diagnostics.push({
      ruleId: "OBS-ALR-01",
      severity: "error",
      file: "docs/observability/alerts.generated.yaml",
      message: "alerts.generated.yaml is stale — source rules/channels differ from projection.",
      fixHint: "Regenerate: pnpm exec werkstatt run observability.alerts.generate",
    });
  }

  // OBS-ALR-02: duplicate rule ids and promql/builder exclusivity
  const seenIds = new Set<string>();
  const declaredMetricNames = new Set(WARPGOGOL_METRIC_REGISTRY.map((m) => m.name));
  const channelIds = new Set(NOTIFICATION_CHANNELS.map((c) => c.id));

  for (const rule of ALERT_RULES) {
    if (seenIds.has(rule.id)) {
      diagnostics.push({
        ruleId: "OBS-ALR-02",
        severity: "error",
        file: "packages/os/site-kernel-observability/src/alert-rules.ts",
        message: `Duplicate alert rule id: "${rule.id}".`,
        fixHint: "Rename one of the duplicate rule ids.",
      });
    }
    seenIds.add(rule.id);

    if (rule.promql && rule.builder) {
      diagnostics.push({
        ruleId: "OBS-ALR-02",
        severity: "error",
        file: "packages/os/site-kernel-observability/src/alert-rules.ts",
        message: `Rule "${rule.id}" has both promql and builder — exactly one is required.`,
        fixHint: "Remove either promql or builder from the rule.",
      });
    }

    if (!rule.promql && !rule.builder) {
      diagnostics.push({
        ruleId: "OBS-ALR-02",
        severity: "error",
        file: "packages/os/site-kernel-observability/src/alert-rules.ts",
        message: `Rule "${rule.id}" has neither promql nor builder — exactly one is required.`,
        fixHint: "Add a promql expression or a builder query to the rule.",
      });
    }

    // OBS-ALR-03: promql references undeclared metrics
    if (rule.promql) {
      const matches = rule.promql.matchAll(METRIC_NAME_REGEX);
      for (const match of matches) {
        const metricName = match[0];
        if (!declaredMetricNames.has(metricName)) {
          diagnostics.push({
            ruleId: "OBS-ALR-03",
            severity: "error",
            file: "packages/os/site-kernel-observability/src/alert-rules.ts",
            message: `Rule "${rule.id}" references undeclared metric "${metricName}" — not in WARPGOGOL_METRIC_REGISTRY.`,
            fixHint: "Add the metric to the registry or fix the promql expression.",
          });
        }
      }
    }

    // OBS-ALR-04: undeclared channel references
    for (const chId of rule.channels) {
      if (!channelIds.has(chId)) {
        diagnostics.push({
          ruleId: "OBS-ALR-04",
          severity: "error",
          file: "packages/os/site-kernel-observability/src/alert-rules.ts",
          message: `Rule "${rule.id}" references undeclared channel "${chId}".`,
          fixHint: "Add the channel to NOTIFICATION_CHANNELS or fix the rule.",
        });
      }
    }

    // OBS-ALR-05: description must include a runbook hint
    if (!rule.description.includes("runbook:")) {
      diagnostics.push({
        ruleId: "OBS-ALR-05",
        severity: "warning",
        file: "packages/os/site-kernel-observability/src/alert-rules.ts",
        message: `Rule "${rule.id}" description lacks a runbook hint (no "runbook:" substring).`,
        fixHint: 'Add "runbook: ..." to the description so each alert is actionable.',
      });
    }
  }

  // OBS-ALR-04: webhook channels must use env var names, not literal URLs
  for (const channel of NOTIFICATION_CHANNELS) {
    if (channel.kind === "webhook") {
      for (const target of channel.target) {
        if (target.startsWith("http://") || target.startsWith("https://")) {
          diagnostics.push({
            ruleId: "OBS-ALR-04",
            severity: "error",
            file: "packages/os/site-kernel-observability/src/alert-rules.ts",
            message: `Webhook channel "${channel.id}" embeds a literal URL — use an env var name instead.`,
            fixHint: "Replace the URL with the env var name that holds the URL at runtime.",
          });
        }
      }
    }
  }

  return diagnosticsResult("observability.alerts.validate", diagnostics);
}
