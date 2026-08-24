/*
<MODULE_CONTRACT>
<purpose>observability.alerts.generate — render authored alert rules to a deterministic generated projection (RFC-0342).</purpose>
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
  KernelCommandInput,
  KernelCommandResult,
  KernelRuntimeContext,
} from "@warpgogol/werkstatt-engine/kernel";
import { buildGeneratedHeader } from "@warpgogol/werkstatt-engine/kernel";
import { diagnosticsResult } from "@warpgogol/werkstatt-shared/checks";
import { stringify as yamlStringify } from "yaml";
import { ALERT_RULES, NOTIFICATION_CHANNELS } from "../alert-rules.ts";

interface AlertProjection {
  schemaVersion: number;
  generatedBy: string;
  rules: typeof ALERT_RULES;
  channels: typeof NOTIFICATION_CHANNELS;
}

export async function runObservabilityAlertsGenerate(
  _input: KernelCommandInput,
  context: KernelRuntimeContext,
): Promise<KernelCommandResult<CheckResult>> {
  const rules = [...ALERT_RULES].sort((a, b) => a.id.localeCompare(b.id));
  const channels = [...NOTIFICATION_CHANNELS].sort((a, b) => a.id.localeCompare(b.id));

  const projection: AlertProjection = {
    schemaVersion: 1,
    generatedBy: "observability.alerts.generate",
    rules,
    channels,
  };

  const outputPath = join(context.workspaceRoot, "docs", "observability", "alerts.generated.yaml");
  const header = buildGeneratedHeader({
    ownerCommand: "observability.alerts.generate",
    filePath: "docs/observability/alerts.generated.yaml",
  });
  const body = header + yamlStringify(projection) + "\n";
  await context.io.writeFile(outputPath, body);

  return diagnosticsResult("observability.alerts.generate", [
    {
      ruleId: "OBS-ALR-GEN",
      severity: "info",
      file: "docs/observability/alerts.generated.yaml",
      message: `Generated ${rules.length} alert rule(s) and ${channels.length} channel(s).`,
      fixHint: "",
    },
  ]);
}
