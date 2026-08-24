/*
<MODULE_CONTRACT>
<purpose>Maintains packages/os/site-kernel-observability/src/index.ts as an authored site-kernel-observability authored module so agents can evolve it without rediscovering local boundaries.</purpose>
<non-goals>
  <item>Do not introduce app-specific runtime composition or deployment behavior into this reusable package source file.</item>
</non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-0337: initial implementation.</item>
</CHANGE_SUMMARY>
*/

export { observabilityModule } from "./module.ts";
export { runObservabilityConventionsValidate } from "./commands/conventions-validate.ts";
export { runObservabilityStackValidate } from "./commands/stack-validate.ts";
export { runObservabilityStackHealth } from "./commands/stack-health.ts";
export { runObservabilityWorkersValidate } from "./commands/workers-validate.ts";
export { runObservabilityFactorySmoke } from "./commands/factory-smoke.ts";
export { runFleetProbeTargetsGenerate } from "./commands/probe-targets-generate.ts";
export { runFleetProbeValidate } from "./commands/probe-validate.ts";
export { runObservabilityAlertsGenerate } from "./commands/alerts-generate.ts";
export { runObservabilityAlertsValidate } from "./commands/alerts-validate.ts";
export { runObservabilityAlertsApply } from "./commands/alerts-apply.ts";
export { runObservabilityDeliveryValidate } from "./commands/delivery-validate.ts";
export { runObservabilityMcpValidate } from "./commands/mcp-validate.ts";
export { ALERT_RULES, NOTIFICATION_CHANNELS } from "./alert-rules.ts";
